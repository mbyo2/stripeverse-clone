import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { requireAuth } from '../_shared/auth.ts';
import { getProvider, calculateFee } from '../_shared/momo-providers.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

/**
 * Submit a draft payout batch. Validates ownership and available wallet
 * balance, debits nothing until the provider confirms, and dispatches each
 * payout to its rail. Batch/payout money columns are service-role only.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const auth = await requireAuth(req, corsHeaders);
    if ('response' in auth && !auth.user) return auth.response!;
    const { user, supabase } = auth as { user: { id: string }; supabase: any };

    const body = await req.json().catch(() => null);
    const batchId = body?.batch_id ? String(body.batch_id) : '';
    if (!batchId) return json({ error: 'batch_id is required' }, 400);

    const { data: batch, error: batchError } = await supabase
      .from('payout_batches')
      .select('id, user_id, status, currency, provider')
      .eq('id', batchId)
      .maybeSingle();

    if (batchError || !batch) return json({ error: 'Batch not found' }, 404);
    if (batch.user_id !== user.id) return json({ error: 'Forbidden' }, 403);
    if (batch.status !== 'draft') return json({ error: 'Batch is not in draft state' }, 409);

    const { data: items, error: itemsError } = await supabase
      .from('payouts')
      .select('id, provider, amount, recipient_phone, recipient_name, currency, status')
      .eq('batch_id', batchId)
      .eq('status', 'pending');

    if (itemsError) {
      console.error('payout-submit items query failed', itemsError);
      return json({ error: 'Operation failed' }, 500);
    }
    if (!items?.length) return json({ error: 'Batch has no pending payouts' }, 400);

    // Server-authoritative totals and fees.
    let totalAmount = 0;
    let totalFee = 0;
    for (const item of items) {
      const amount = Number(item.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return json({ error: `Invalid amount on payout ${item.id}` }, 400);
      }
      totalAmount += amount;
      totalFee += calculateFee(amount);
    }

    const { data: balance, error: balanceError } = await supabase.rpc('get_user_wallet_balance', {
      p_user_id: user.id,
    });
    if (balanceError) {
      console.error('payout-submit balance lookup failed', balanceError);
      return json({ error: 'Operation failed' }, 500);
    }
    if (Number(balance ?? 0) < totalAmount + totalFee) {
      return json({ error: 'Insufficient wallet balance for this batch' }, 402);
    }

    await supabase
      .from('payout_batches')
      .update({
        status: 'processing',
        submitted_at: new Date().toISOString(),
        item_count: items.length,
        total_amount: totalAmount,
        total_fee: totalFee,
      })
      .eq('id', batchId);

    const callbackBase = `${Deno.env.get('SUPABASE_URL')}/functions/v1/payout-callback`;
    const results: Array<Record<string, unknown>> = [];

    for (const item of items) {
      const providerId = String(item.provider || batch.provider);
      const adapter = getProvider(providerId);
      const amount = Number(item.amount);
      const fee = calculateFee(amount);

      if (!adapter || !item.recipient_phone) {
        await supabase
          .from('payouts')
          .update({
            status: 'failed',
            fee_amount: fee,
            failure_reason: adapter ? 'missing_recipient_phone' : 'unsupported_provider',
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id);
        results.push({ payout_id: item.id, status: 'failed' });
        continue;
      }

      const result = await adapter.disburse({
        amount,
        currency: item.currency || batch.currency,
        phone: item.recipient_phone,
        reference: item.id,
        narration: item.recipient_name ? `Payout to ${item.recipient_name}` : 'BMaGlass Pay payout',
        callbackUrl: `${callbackBase}?provider=${providerId}&ref=${item.id}`,
      });

      await supabase
        .from('payouts')
        .update({
          status: result.status === 'failed' ? 'failed' : 'processing',
          fee_amount: fee,
          provider_reference: result.providerReference,
          failure_reason: result.failureReason ?? null,
        })
        .eq('id', item.id);

      results.push({
        payout_id: item.id,
        status: result.status === 'failed' ? 'failed' : 'processing',
        provider_reference: result.providerReference,
        mode: result.sandbox ? 'sandbox' : 'live',
      });
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    await supabase
      .from('payout_batches')
      .update({ failed_count: failed, status: failed === results.length ? 'failed' : 'processing' })
      .eq('id', batchId);

    return json({
      batch_id: batchId,
      submitted: results.length,
      failed,
      total_amount: totalAmount,
      total_fee: totalFee,
      results,
    });
  } catch (error) {
    console.error('payout-submit error', error);
    return json({ error: 'Operation failed' }, 500);
  }
});