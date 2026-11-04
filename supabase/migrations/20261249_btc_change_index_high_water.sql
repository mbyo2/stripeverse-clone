-- 20261249: btc_change_index_high_water() — the custodial change-address
-- allocator's high-water mark, read by btc-onchain's gatherUtxos.
--
-- WHY: gatherUtxos bounded its chain-1 (change) scan by ROW COUNTS —
-- COUNT(btc_withdrawals) + COUNT(btc_withdrawal_batches). But
-- btc_withdrawal_batches also holds one audit row per run_batch
-- invocation, and the batcher cron (btc-batch-withdrawals, */5 * * * *)
-- writes a 'skipped_empty' row whenever the queue is empty. By
-- 2026-11-04 there were 2,588 such never-broadcast rows and ZERO
-- batches had ever been formed, so the count-based bound computed
-- 2,586+ scan targets > MAX_SCAN_ADDRESSES (2,000) and EVERY on-chain
-- send failed with "Wallet UTXO scan limit reached" before any money
-- logic ran. Change outputs can only live at indices the allocator —
-- the public.btc_change_index_seq sequence behind
-- btc_next_change_index() — has actually handed out (one per solo send,
-- one per FORMED batch). The sequence's own state is the exact bound;
-- this function exposes it read-only to the service role.
--
-- Returns the highest change index ever allocated, or -1 when the
-- sequence has never been called (no change output can exist).
--
-- Grants follow the 20261020 pattern for btc_next_change_index: a fresh
-- function's default EXECUTE grant to PUBLIC is revoked explicitly and
-- EXECUTE is granted to service_role only (the edge function calls this
-- with its service-role client; no end user ever needs it).

CREATE OR REPLACE FUNCTION public.btc_change_index_high_water()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN s.is_called THEN s.last_value ELSE -1 END
  FROM public.btc_change_index_seq AS s;
$$;

REVOKE ALL ON FUNCTION public.btc_change_index_high_water() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_change_index_high_water() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_change_index_high_water() TO service_role;
