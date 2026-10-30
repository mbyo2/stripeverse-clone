import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-signature',
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let out = 0
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return out === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const secret = Deno.env.get('CHECKOUT_WEBHOOK_SECRET')
    if (!secret) {
      console.error('checkout-webhook missing CHECKOUT_WEBHOOK_SECRET')
      return new Response(JSON.stringify({ error: 'Operation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const rawBody = await req.text()
    const providedSig = req.headers.get('x-signature') ?? ''
    const expectedSig = await hmacHex(secret, rawBody)
    if (!providedSig || !timingSafeEqual(providedSig, expectedSig)) {
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const eventId: string | undefined = event?.id
    const eventType: string | undefined = event?.type
    const intentId: string | undefined = event?.data?.intent_id
    const providerRef: string | undefined = event?.data?.provider_reference
    if (!eventId || !eventType || !intentId) {
      return new Response(JSON.stringify({ error: 'Malformed event' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    // Idempotency: unique (provider, key). If already stored, ack silently.
    const { error: idemErr } = await supabase
      .from('webhook_idempotency_keys')
      .insert({ provider: 'checkout', key: eventId })
    if (idemErr && !`${idemErr.message}`.toLowerCase().includes('duplicate')) {
      console.error('checkout-webhook idempotency error:', idemErr)
    }
    if (idemErr && `${idemErr.message}`.toLowerCase().includes('duplicate')) {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Locate the pending transaction by external_reference (intent_id).
    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .select('id, uuid_id, status, amount, metadata, user_id')
      .eq('external_reference', intentId)
      .maybeSingle()
    if (txnErr || !txn) {
      return new Response(JSON.stringify({ error: 'Unknown intent' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (eventType === 'payment.succeeded') {
      // Only transition from pending -> completed; never re-complete.
      if (txn.status !== 'pending') {
        return new Response(JSON.stringify({ received: true, noop: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await supabase
        .from('transactions')
        .update({
          status: 'completed',
          external_reference: providerRef ?? intentId,
        })
        .eq('id', txn.id)

      const paymentLinkId = (txn.metadata as any)?.payment_link_id
      if (paymentLinkId) {
        const { error: incErr } = await supabase.rpc('increment_payment_link_stats', {
          p_link_id: paymentLinkId,
          p_amount: txn.amount,
        })
        if (incErr) console.error('increment_payment_link_stats error:', incErr)
      }

      const payerEmail = (txn.metadata as any)?.payer_email
      if (payerEmail) {
        await supabase.functions.invoke('send-receipt', {
          body: {
            transaction_id: txn.uuid_id ?? txn.id,
            recipient_email: payerEmail,
            type: 'payment',
          },
        }).catch((e) => console.error('send-receipt invoke error:', e))
      }
    } else if (eventType === 'payment.failed') {
      if (txn.status === 'pending') {
        await supabase.from('transactions').update({ status: 'failed' }).eq('id', txn.id)
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('checkout-webhook error:', error)
    return new Response(JSON.stringify({ error: 'Operation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})