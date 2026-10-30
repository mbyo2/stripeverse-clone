import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    let intentId = url.searchParams.get('intent_id')
    if (!intentId && req.method === 'POST') {
      try {
        const body = await req.json()
        intentId = body?.intent_id ?? null
      } catch { /* ignore */ }
    }
    if (!intentId || typeof intentId !== 'string' || intentId.length > 128) {
      return new Response(JSON.stringify({ error: 'Invalid intent_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const { data: txn, error } = await supabase
      .from('transactions')
      .select('status, transaction_id, external_reference')
      .eq('external_reference', intentId)
      .maybeSingle()

    if (error) {
      console.error('verify-checkout-status query error:', error)
      return new Response(JSON.stringify({ error: 'Operation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!txn) {
      // Might also match a completed txn whose external_reference was rewritten
      // to the provider reference — in that case check by metadata->>intent_id.
      const { data: txnByMeta } = await supabase
        .from('transactions')
        .select('status, transaction_id')
        .filter('metadata->>intent_id', 'eq', intentId)
        .maybeSingle()

      if (!txnByMeta) {
        return new Response(JSON.stringify({ status: 'unknown' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          status: txnByMeta.status,
          reference: `RCP-${(txnByMeta.transaction_id ?? '').toString().slice(0, 8).toUpperCase()}`,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({
        status: txn.status,
        reference: `RCP-${(txn.transaction_id ?? '').toString().slice(0, 8).toUpperCase()}`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('verify-checkout-status error:', error)
    return new Response(JSON.stringify({ error: 'Operation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})