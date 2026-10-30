import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getProvider, type SettlementStatus } from '../_shared/momo-providers.ts';
import { claimEvent, settleIntent } from '../_shared/momo-settle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-signature, x-auth-signature, x-zamtel-signature',
  'Access-Control-Allow-Methods': 'POST, PUT, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Provider callback for mobile money COLLECTIONS.
 *
 * MTN's docs are explicit that callbacks are unsigned and delivered only once
 * with no retry, and that partners should verify via the status API. So for
 * providers whose `callbackTrust` is 'refetch' this handler treats the request
 * purely as a nudge: it looks the intent up by the `ref` we put in the callback
 * URL and asks the provider for the authoritative status. The request body is
 * never trusted to move money.
 *
 * MTN may deliver as POST or PUT, so both are accepted.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const url = new URL(req.url);
    const providerId = (url.searchParams.get('provider') || '').toLowerCase();
    const adapter = getProvider(providerId);
    if (!adapter) return json({ error: 'Unknown provider' }, 400);

    const rawBody = await req.text();
    let payload: Record<string, any> = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      return json({ error: 'Invalid payload' }, 400);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Locate the intent. `ref` is our own intent id, added to the callback URL
    // when the request was dispatched, so we never depend on the body shape.
    const intentRef = url.searchParams.get('ref');
    const providerReference = String(
      payload.referenceId ?? payload.transactionId ?? payload.data?.transaction?.id ?? '',
    );

    let query = supabase
      .from('provider_intents')
      .select('id, user_id, transaction_id, amount, status, provider_reference')
      .eq('provider', providerId);
    query = intentRef
      ? query.eq('id', intentRef)
      : query.eq('provider_reference', providerReference);

    const { data: intent, error: intentError } = await query.maybeSingle();
    if (intentError || !intent) {
      console.error('momo-callback intent not found', providerId, intentRef, providerReference);
      return json({ error: 'Intent not found' }, 404);
    }
    if (intent.status !== 'pending') return json({ received: true, already_settled: true });

    // Determine the outcome according to how this provider can be trusted.
    let outcome: SettlementStatus;
    let reason: string | undefined;
    let evidence: unknown = payload;

    if (adapter.callbackTrust === 'signature') {
      const invalid = await adapter.verifyCallback(rawBody, req.headers);
      if (invalid) {
        console.error('momo-callback signature rejected', providerId, invalid);
        return json({ error: 'Invalid signature' }, 401);
      }
      const raw = String(
        payload.status ?? payload.data?.transaction?.status ?? payload.event ?? '',
      ).toUpperCase();
      outcome = ['SUCCESSFUL', 'SUCCESS', 'TS', 'COMPLETED'].includes(raw)
        ? 'completed'
        : ['FAILED', 'FAILURE', 'TF', 'REJECTED', 'EXPIRED'].includes(raw)
          ? 'failed'
          : 'pending';
      reason = raw;
    } else {
      // Unsigned provider: ignore the body, ask the provider directly.
      const status = await adapter.getStatus('collect', intent.provider_reference ?? '');
      outcome = status.status;
      reason = status.reason;
      evidence = status.raw ?? payload;
    }

    if (outcome !== 'completed' && outcome !== 'failed') {
      return json({ received: true, status: outcome });
    }

    // Dedupe on the settled state so a repeat delivery is a no-op.
    const claimed = await claimEvent(supabase, providerId, `collect:${intent.id}:${outcome}`);
    if (!claimed) return json({ received: true, duplicate: true });

    const settled = await settleIntent(supabase, intent, outcome, reason, evidence);
    return json({ received: true, status: outcome, settled });
  } catch (error) {
    console.error('momo-callback error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});