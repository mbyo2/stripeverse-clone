import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
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
  idempotency_key: z.string().min(8).max(80).optional(),
})

// Anonymous by design (guest checkout), so abuse controls live here:
// per-IP + per-link rate limits, an idempotency key, and a cap on
// pending intents per link — otherwise anyone can enumerate link
// codes and spam unbounded pending rows against a merchant's link.
const MAX_PENDING_INTENTS_PER_LINK = 50

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  const first = forwarded.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

async function withinRateLimit(
  supabase: any,
  identifier: string,
  action: string,
  maxAttempts: number,
  windowMinutes: number,
): Promise<boolean> {
  const { data } = await supabase.rpc('check_advanced_rate_limit', {
    p_identifier: identifier,
    p_action: action,
    p_max_attempts: maxAttempts,
    p_window_minutes: windowMinutes,
  })
  // Fail open on RPC error (the momo-collect pattern): a limiter
  // outage must not take checkout down; only an explicit `false`
  // refuses.
  return data !== false
}

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

    // Per-IP rate limit first: it runs before the link lookup so
    // link-code enumeration itself is throttled.
    const ip = clientIp(req)
    if (!(await withinRateLimit(supabase, `ip:${ip}`, 'create_checkout_intent', 30, 60))) {
      return new Response(JSON.stringify({ error: 'Too many checkout attempts. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const idempotencyKey = req.headers.get('idempotency-key') || body.idempotency_key || null

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

    // Idempotent replay: the same key for the same link returns the
    // original intent instead of creating a second pending row.
    if (idempotencyKey) {
      const { data: existing } = await supabase
        .from('transactions')
        .select('transaction_id, external_reference')
        .eq('idempotency_key', idempotencyKey)
        .filter('metadata->>payment_link_id', 'eq', link.id)
        .maybeSingle()
      if (existing) {
        return new Response(
          JSON.stringify({
            intent_id: existing.external_reference,
            transaction_id: existing.transaction_id,
            duplicate: true,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    // Per-link rate limit + pending cap: a single link cannot be
    // flooded with pending intents.
    if (!(await withinRateLimit(supabase, `link:${link.id}`, 'create_checkout_intent_link', 100, 60))) {
      return new Response(JSON.stringify({ error: 'Too many checkout attempts for this payment link. Please try again later.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const { count: pendingCount } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .filter('metadata->>payment_link_id', 'eq', link.id)
      .eq('provider', 'checkout')
      .eq('status', 'pending')
    if ((pendingCount ?? 0) >= MAX_PENDING_INTENTS_PER_LINK) {
      return new Response(JSON.stringify({ error: 'This payment link has too many unfinished checkouts right now. Please try again later.' }), {
        status: 429,
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
        idempotency_key: idempotencyKey,
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
      // A concurrent replay with the same idempotency key: return the
      // row the other request created instead of a 500.
      if ((txnErr as { code?: string })?.code === '23505' && idempotencyKey) {
        const { data: raced } = await supabase
          .from('transactions')
          .select('transaction_id, external_reference')
          .eq('idempotency_key', idempotencyKey)
          .filter('metadata->>payment_link_id', 'eq', link.id)
          .maybeSingle()
        if (raced) {
          return new Response(
            JSON.stringify({
              intent_id: raced.external_reference,
              transaction_id: raced.transaction_id,
              duplicate: true,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
      }
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