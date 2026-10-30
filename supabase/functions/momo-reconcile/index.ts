import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { requireCronCaller } from '../_shared/auth.ts';
import { getProvider } from '../_shared/momo-providers.ts';
import { claimEvent, settleIntent, settlePayout } from '../_shared/momo-settle.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Mandatory fallback poller.
 *
 * MTN's documentation states: "the Wallet Platform sends the callback only
 * once. There is no retry mechanism if the partner system does not respond...
 * we strongly recommend that partner systems implement a fallback mechanism by
 * polling the transaction status using the appropriate GET method."
 *
 * This function is that fallback. It sweeps anything still pending after a
 * grace period and asks each provider for the authoritative status. Run it on
 * a schedule (every 1-2 minutes) with the CRON_SECRET header.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const unauthorized = await requireCronCaller(req, corsHeaders, 'momo-reconcile', supabase);
    if (unauthorized) return unauthorized;

    // Grace period so we don't race a callback that is already in flight.
    const graceSeconds = Number(Deno.env.get('MOMO_RECONCILE_GRACE_SECONDS') || '60');
    const cutoff = new Date(Date.now() - graceSeconds * 1000).toISOString();
    // Abandon anything the provider never resolved.
    const staleHours = Number(Deno.env.get('MOMO_RECONCILE_EXPIRY_HOURS') || '24');
    const expiry = new Date(Date.now() - staleHours * 3600 * 1000).toISOString();

    const summary = { intents_checked: 0, intents_settled: 0, payouts_checked: 0, payouts_settled: 0, expired: 0 };

    // ---- Collections -----------------------------------------------------
    const { data: intents } = await supabase
      .from('provider_intents')
      .select('id, user_id, transaction_id, amount, provider, provider_reference, created_at')
      .eq('status', 'pending')
      .not('provider_reference', 'is', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(100);

    for (const intent of intents ?? []) {
      const adapter = getProvider(intent.provider);
      if (!adapter) continue;
      summary.intents_checked++;

      const result = await adapter.getStatus('collect', intent.provider_reference!);
      let outcome = result.status;
      let reason = result.reason;

      if (outcome === 'pending' || outcome === 'unknown') {
        if (intent.created_at < expiry) {
          outcome = 'failed';
          reason = 'expired_without_provider_confirmation';
          summary.expired++;
        } else {
          continue;
        }
      }

      const claimed = await claimEvent(supabase, intent.provider, `collect:${intent.id}:${outcome}`);
      if (!claimed) continue;
      if (await settleIntent(supabase, intent, outcome, reason, result.raw)) summary.intents_settled++;
    }

    // ---- Payouts ---------------------------------------------------------
    const { data: payouts } = await supabase
      .from('payouts')
      .select('id, user_id, batch_id, amount, fee_amount, provider, provider_reference, created_at')
      .eq('status', 'processing')
      .not('provider_reference', 'is', null)
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(100);

    for (const payout of payouts ?? []) {
      const adapter = getProvider(payout.provider);
      if (!adapter) continue;
      summary.payouts_checked++;

      const result = await adapter.getStatus('disburse', payout.provider_reference!);
      let outcome = result.status;
      let reason = result.reason;

      if (outcome === 'pending' || outcome === 'unknown') {
        if (payout.created_at < expiry) {
          outcome = 'failed';
          reason = 'expired_without_provider_confirmation';
          summary.expired++;
        } else {
          continue;
        }
      }

      const claimed = await claimEvent(supabase, payout.provider, `payout:${payout.id}:${outcome}`);
      if (!claimed) continue;
      if (await settlePayout(supabase, payout, outcome, reason, result.raw)) summary.payouts_settled++;
    }

    console.log('momo-reconcile summary', summary);
    return json({ success: true, ...summary });
  } catch (error) {
    console.error('momo-reconcile error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});