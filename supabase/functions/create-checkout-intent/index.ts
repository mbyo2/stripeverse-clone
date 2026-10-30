import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://esm.sh/zod@3.23.8'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BodySchema = z.object({
  payment_link_code: z.string().min(1).max(128),
  amount: z.number().positive().max(10_000_000).optional(),
  email: z.string().email().max(255),
  phone: z.string().max(32).optional(),
  payment_method: z.enum(['card', 'mobile_money', 'bank']),
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    )

    const parsed = BodySchema.safeParse(await req.json())
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const body = parsed.data

    const { data: link, error: linkErr } = await supabase
      .from('payment_links')
      .select('id, user_id, amount, currency, status, title')
      .eq('link_code', body.payment_link_code)
      .eq('status', 'active')
      .maybeSingle()

    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: 'Payment link not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const amount = link.amount ?? body.amount
    if (!amount || amount <= 0) {
      return new Response(JSON.stringify({ error: 'Invalid amount' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const intentId = crypto.randomUUID()
    const transactionId = `INT_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`

    const { data: txn, error: txnErr } = await supabase
      .from('transactions')
      .insert({
        user_id: link.user_id,
        transaction_id: transactionId,
        amount,
        currency: link.currency,
        payment_method: body.payment_method,
        direction: 'incoming',
        status: 'pending',
        description: link.title,
        provider: 'checkout',
        external_reference: intentId,
        metadata: {
          intent_id: intentId,
          payment_link_id: link.id,
          payer_email: body.email,
          payer_phone: body.phone ?? null,
        },
      })
      .select('id, transaction_id')
      .single()

    if (txnErr || !txn) {
      console.error('create-checkout-intent txn insert error:', txnErr)
      return new Response(JSON.stringify({ error: 'Operation failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // In a real integration, create a provider order here and return provider_redirect_url.
    return new Response(
      JSON.stringify({
        intent_id: intentId,
        transaction_id: txn.transaction_id,
        // provider_redirect_url: null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    console.error('create-checkout-intent error:', error)
    return new Response(JSON.stringify({ error: 'Operation failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})