import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { getProvider, type SettlementStatus } from '../_shared/momo-providers.ts';
import { claimEvent, settlePayout } from '../_shared/momo-settle.ts';

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
 * Provider callback for DISBURSEMENTS (payouts). Same trust model as the
 * collection callback: unsigned providers are re-checked against their status
 * API before a wallet is ever debited.
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

    const payoutRef = url.searchParams.get('ref');
    const providerReference = String(
      payload.referenceId ?? payload.transactionId ?? payload.data?.transaction?.id ?? '',
    );

    let query = supabase
      .from('payouts')
      .select('id, user_id, batch_id, amount, fee_amount, status, provider_reference')
      .eq('provider', providerId);
    query = payoutRef
      ? query.eq('id', payoutRef)
      : query.eq('provider_reference', providerReference);

    const { data: payout, error: payoutError } = await query.maybeSingle();
    if (payoutError || !payout) {
      console.error('payout-callback payout not found', providerId, payoutRef, providerReference);
      return json({ error: 'Payout not found' }, 404);
    }
    if (!['pending', 'processing'].includes(payout.status)) {
      return json({ received: true, already_settled: true });
    }

    let outcome: SettlementStatus;
    let reason: string | undefined;
    let evidence: unknown = payload;

    if (adapter.callbackTrust === 'signature') {
      const invalid = await adapter.verifyCallback(rawBody, req.headers);
      if (invalid) {
        console.error('payout-callback signature rejected', providerId, invalid);
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
      const status = await adapter.getStatus('disburse', payout.provider_reference ?? '');
      outcome = status.status;
      reason = status.reason;
      evidence = status.raw ?? payload;
    }

    if (outcome !== 'completed' && outcome !== 'failed') {
      return json({ received: true, status: outcome });
    }

    const claimed = await claimEvent(supabase, providerId, `payout:${payout.id}:${outcome}`);
    if (!claimed) return json({ received: true, duplicate: true });

    const settled = await settlePayout(supabase, payout, outcome, reason, evidence);
    return json({ received: true, status: outcome, settled });
  } catch (error) {
    console.error('payout-callback error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});