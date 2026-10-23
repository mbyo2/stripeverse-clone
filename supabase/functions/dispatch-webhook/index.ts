import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )

    // ── Caller gate (security audit P0-8, 2026-10-23) ──
    // This function signs dispatches with merchants' real webhook
    // secrets, so it must never answer anonymous callers. It has no
    // client callers: accept ONLY the platform's own service-role key
    // (server-to-server) or a signed-in admin's JWT. Everything else
    // gets a 401 and nothing is dispatched.
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    let authorized = serviceRoleKey.length > 0 && token === serviceRoleKey
    if (!authorized && token) {
      const { data: { user } } = await supabase.auth.getUser(token)
      if (user) {
        const { data: adminRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle()
        authorized = !!adminRole
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { merchant_id, event_type, payload } = await req.json()

    if (!merchant_id || !event_type || !payload) {
      return new Response(JSON.stringify({ error: 'merchant_id, event_type, and payload are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Get merchant webhook config
    const { data: merchant, error: mErr } = await supabase
      .from('merchant_accounts')
      .select('webhook_url, webhook_secret, business_name')
      .eq('id', merchant_id)
      .single()

    if (mErr || !merchant?.webhook_url) {
      return new Response(JSON.stringify({ error: 'No webhook URL configured for merchant' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const webhookPayload = {
      event_type,
      event_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      merchant_id,
      data: payload,
    }

    // Generate HMAC-SHA256 signature
    const payloadStr = JSON.stringify(webhookPayload)
    // Never sign with a fallback secret (security audit P0-8): a
    // merchant with no webhook_secret cannot have dispatches signed —
    // fail the dispatch loudly instead of signing with a publicly
    // known string.
    const secret = merchant.webhook_secret
    if (!secret) {
      console.error(`Webhook dispatch aborted: merchant ${merchant_id} has no webhook_secret configured`)
      return new Response(JSON.stringify({ error: 'Merchant webhook secret is not configured' }), {
        status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payloadStr))
    const signature = 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

    // Attempt delivery with retry
    let lastError = ''
    let delivered = false
    let statusCode = 0

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(merchant.webhook_url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-BMGlass-Signature': signature,
            'X-BMGlass-Event': event_type,
            'X-BMGlass-Timestamp': webhookPayload.timestamp,
            'X-BMGlass-Delivery': webhookPayload.event_id,
          },
          body: payloadStr,
          signal: controller.signal,
        })

        clearTimeout(timeout)
        statusCode = response.status
        await response.text() // consume body

        if (response.ok) {
          delivered = true
          break
        }
        lastError = `HTTP ${response.status}`
      } catch (e: any) {
        lastError = e.message || 'Network error'
        // Exponential backoff
        await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000))
      }
    }

    return new Response(JSON.stringify({
      success: delivered,
      event_id: webhookPayload.event_id,
      status_code: statusCode,
      error: delivered ? null : lastError,
      webhook_url: merchant.webhook_url,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (error: any) {
    console.error('Webhook dispatch error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
