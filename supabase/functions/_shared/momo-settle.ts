/**
 * Settlement helpers shared by the provider callbacks and the reconciliation
 * poller. Every state transition is guarded on the current status so a
 * callback and a poll landing at the same moment cannot both credit funds.
 */

export type Settlement = 'completed' | 'failed';

/** Settle a collection intent and, on success, credit the merchant wallet. */
export async function settleIntent(
  supabase: any,
  intent: { id: string; user_id: string | null; transaction_id: string | null; amount: number },
  outcome: Settlement,
  reason: string | undefined,
  payload: unknown,
): Promise<boolean> {
  const { data: settled, error } = await supabase
    .from('provider_intents')
    .update({
      status: outcome,
      failure_reason: outcome === 'failed' ? (reason ?? 'provider_reported_failure') : null,
      provider_payload: payload ?? null,
    })
    .eq('id', intent.id)
    .eq('status', 'pending')
    .select('id');

  // Lost the race to a concurrent callback/poll — the winner did the work.
  if (error || !settled?.length) return false;

  if (intent.transaction_id) {
    await supabase
      .from('transactions')
      .update({ status: outcome })
      .eq('uuid_id', intent.transaction_id)
      .eq('status', 'pending');
  }

  if (outcome === 'completed' && intent.user_id) {
    const { error: creditError } = await supabase.rpc('increment_wallet_balance', {
      p_user_id: intent.user_id,
      p_amount: Number(intent.amount),
    });
    if (creditError) console.error('wallet credit failed for intent', intent.id, creditError);
  }

  return true;
}

/** Settle a payout and, on success, debit the merchant wallet. */
export async function settlePayout(
  supabase: any,
  payout: {
    id: string;
    user_id: string | null;
    batch_id: string | null;
    amount: number;
    fee_amount: number | null;
  },
  outcome: Settlement,
  reason: string | undefined,
  payload: unknown,
): Promise<boolean> {
  const { data: settled, error } = await supabase
    .from('payouts')
    .update({
      status: outcome,
      failure_reason: outcome === 'failed' ? (reason ?? 'provider_reported_failure') : null,
      provider_payload: payload ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq('id', payout.id)
    .in('status', ['pending', 'processing'])
    .select('id');

  if (error || !settled?.length) return false;

  if (outcome === 'completed' && payout.user_id) {
    const debit = -(Number(payout.amount) + Number(payout.fee_amount ?? 0));
    const { error: debitError } = await supabase.rpc('increment_wallet_balance', {
      p_user_id: payout.user_id,
      p_amount: debit,
    });
    if (debitError) console.error('wallet debit failed for payout', payout.id, debitError);
  }

  if (payout.batch_id) await rollUpBatch(supabase, payout.batch_id);
  return true;
}

/** Recompute a batch's counters and overall status from its items. */
export async function rollUpBatch(supabase: any, batchId: string) {
  const { data: siblings } = await supabase.from('payouts').select('status').eq('batch_id', batchId);
  if (!siblings?.length) return;

  const success = siblings.filter((s: any) => s.status === 'completed').length;
  const failed = siblings.filter((s: any) => s.status === 'failed').length;
  const done = success + failed === siblings.length;

  await supabase
    .from('payout_batches')
    .update({
      success_count: success,
      failed_count: failed,
      status: done ? (failed === siblings.length ? 'failed' : 'completed') : 'processing',
      completed_at: done ? new Date().toISOString() : null,
    })
    .eq('id', batchId);
}

/**
 * Record a provider event so duplicate deliveries are ignored.
 * Returns false when this exact event has already been handled.
 */
export async function claimEvent(supabase: any, provider: string, key: string): Promise<boolean> {
  const { error } = await supabase
    .from('webhook_idempotency_keys')
    .insert({ key, provider });
  return !error;
}