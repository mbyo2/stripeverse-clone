import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/auth.ts';
import { getProvider, calculateFee, listProviderStatus } from '../_shared/momo-providers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (req.method === 'GET') return json({ providers: listProviderStatus() });

    const auth = await requireAuth(req, corsHeaders);
    if ('response' in auth && !auth.user) return auth.response!;
    const { user, supabase } = auth as { user: { id: string }; supabase: any };

    // Rate-limit collection prompts: each one buzzes a real phone, so a
    // single account must not be able to spam arbitrary numbers.
    const { data: withinLimit } = await supabase.rpc('check_advanced_rate_limit', {
      p_identifier: user.id,
      p_action: 'momo_collect',
      p_max_attempts: 10,
      p_window_minutes: 60,
    });
    if (withinLimit === false) {
      return json({ error: 'Too many payment requests. Please try again later.' }, 429);
    }

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid request body' }, 400);

    const provider = String(body.provider || '').toLowerCase();
    const amount = Number(body.amount);
    const phone = String(body.phone || '').trim();
    const currency = String(body.currency || 'ZMW').toUpperCase();
    const narration = body.narration ? String(body.narration).slice(0, 120) : undefined;

    const adapter = getProvider(provider);
    if (!adapter) return json({ error: 'Unsupported provider' }, 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
      return json({ error: 'Amount must be between 0 and 100000' }, 400);
    }
    if (!/^\+?[0-9]{9,15}$/.test(phone.replace(/\s/g, ''))) {
      return json({ error: 'Valid phone number is required' }, 400);
    }
    if (!/^[A-Z]{3}$/.test(currency)) return json({ error: 'Invalid currency' }, 400);

    const fee = calculateFee(amount);

    // 1. Pending transaction — never completed here.
    const { data: txn, error: txnError } = await supabase
      .from('transactions')
      .insert({
        user_id: user.id,
        amount,
        fee_amount: fee,
        currency,
        payment_method: 'mobile_money',
        direction: 'incoming',
        status: 'pending',
        provider,
        description: narration || `${provider.toUpperCase()} mobile money collection`,
        metadata: { rail: 'mobile_money', provider, payer_phone: phone },
      })
      .select('uuid_id, reference')
      .single();

    if (txnError || !txn) {
      console.error('momo-collect transaction insert failed', txnError);
      return json({ error: 'Operation failed' }, 500);
    }

    // 2. Provider intent
    const { data: intent, error: intentError } = await supabase
      .from('provider_intents')
      .insert({
        user_id: user.id,
        transaction_id: txn.uuid_id,
        provider,
        channel: 'mobile_money',
        amount,
        currency,
        payer_phone: phone,
        status: 'pending',
      })
      .select('id')
      .single();

    if (intentError || !intent) {
      console.error('momo-collect intent insert failed', intentError);
      return json({ error: 'Operation failed' }, 500);
    }

    // 3. Call the rail. `ref` lets the callback find this intent without
    //    trusting anything in the callback body.
    const callbackUrl =
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/momo-callback` +
      `?provider=${provider}&ref=${intent.id}`;
    const result = await adapter.collect({
      amount,
      currency,
      phone,
      reference: intent.id,
      narration,
      callbackUrl,
    });

    await supabase
      .from('provider_intents')
      .update({
        provider_reference: result.providerReference,
        status: result.status,
        failure_reason: result.failureReason ?? null,
      })
      .eq('id', intent.id);

    if (result.status === 'failed') {
      await supabase.from('transactions').update({ status: 'failed' }).eq('uuid_id', txn.uuid_id);
      return json({ error: 'Provider rejected the request', intent_id: intent.id }, 502);
    }

    return json({
      intent_id: intent.id,
      transaction_id: txn.uuid_id,
      provider,
      provider_reference: result.providerReference,
      status: 'pending',
      fee,
      mode: result.sandbox ? 'sandbox' : 'live',
      message: result.sandbox
        ? 'Sandbox intent created. Awaiting a signed provider callback to settle.'
        : 'Approve the prompt on your phone to complete the payment.',
    });
  } catch (error) {
    console.error('momo-collect error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});