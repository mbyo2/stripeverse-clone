-- ============================================================================
-- 20261225_btc_withdrawal_batching.sql — P4: low-fee-window batching for
-- custodial on-chain BTC withdrawals (CEO approved 2026-10-26; design in
-- pay-with-bitcoin-addendum-2026-10-26.md, "Three protections" → P4).
--
-- THE CONTRACT (as designed, now built): a user may queue a withdrawal
-- into the low-fee batch instead of sending instantly. Queuing reserves
-- amount + the member's SOLO fee estimate (the P3 figure — the debit is
-- never a surprise). A pg_cron batcher (btc-onchain `run_batch`, every
-- 5 minutes) forms ONE multi-output transaction when the esplora
-- halfHourFee is at/under platform_settings
-- .btc_fee_window_batch_max_sat_vb (5 sat/vB, shipped in 20261223) OR
-- the oldest queued withdrawal reaches btc_batch_max_wait_hours
-- (default 6, new below) — then it broadcasts at market. Each member
-- pays a proportional share of the ACTUAL batch fee (their solo vsize
-- share of the members' total solo vsize), CAPPED at their reserved
-- solo estimate; the unused reserve is released at settle and any
-- overage above the sum of caps is absorbed by the platform (the
-- confirm screen promises the fee never exceeds the shown estimate —
-- the caps are that promise, so the platform carries the difference).
-- Savings go to the withdrawers; the platform never marks up fees.
-- Instant send (btc_reserve_withdrawal + the solo path) is untouched
-- except ONE additive change: its in-RPC daily-cap sum now also
-- counts 'queued'/'batched' rows, closing the cross-mode cap hole the
-- batch queue would otherwise open (same advisory lock key serializes
-- both paths per user; the restated body is the live definition
-- verbatim — fetched via pg_get_functiondef before applying — P2P
-- T+1 hold included). The queue RPC carries the same P2P hold check:
-- a queued withdrawal is still an on-chain exit.
--
-- Broadcast doctrine is unchanged (classifyBroadcastOutcome): a batch
-- whose broadcast is not positively confirmed stays 'batched' with
-- its reserves HELD — never auto-refunded; ops settles it through
-- btc_settle_withdrawal_batch once the true outcome is known (the RPC
-- therefore accepts batches in 'forming' AND 'broadcast_unknown').
-- Failures proven BEFORE broadcast release the claim (members return
-- to 'queued') or, at request/cancel time, refund in full.
--
-- LIVE-SCHEMA NOTE: the live btc_withdrawals table is the legacy one
-- (no status CHECK existed live; extra legacy columns payout_id /
-- broadcast_at / confirmations / admin_note are untouched). The full
-- status vocabulary is pinned by a new CHECK — the table is empty, so
-- validation is instant.
-- ============================================================================

-- ── 1. Settings: batch kill switch + max wait ─────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS btc_batch_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS btc_batch_max_wait_hours NUMERIC NOT NULL DEFAULT 6;

-- ── 2. btc_withdrawals: batch columns + full status vocabulary ───────────
ALTER TABLE public.btc_withdrawals
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'instant',
  ADD COLUMN IF NOT EXISTS reserved_fee_sats BIGINT,
  ADD COLUMN IF NOT EXISTS fee_share_sats BIGINT,
  ADD COLUMN IF NOT EXISTS solo_vsize INTEGER,
  ADD COLUMN IF NOT EXISTS batch_id UUID,
  ADD COLUMN IF NOT EXISTS batch_deadline TIMESTAMPTZ;

UPDATE public.btc_withdrawals
SET reserved_fee_sats = fee_sats
WHERE reserved_fee_sats IS NULL;

ALTER TABLE public.btc_withdrawals DROP CONSTRAINT IF EXISTS btc_withdrawals_status_check;
ALTER TABLE public.btc_withdrawals ADD CONSTRAINT btc_withdrawals_status_check
  CHECK (status IN ('pending', 'reserved', 'broadcast', 'confirmed', 'failed',
                    'queued', 'batched', 'cancelled'));

ALTER TABLE public.btc_withdrawals DROP CONSTRAINT IF EXISTS btc_withdrawals_mode_check;
ALTER TABLE public.btc_withdrawals ADD CONSTRAINT btc_withdrawals_mode_check
  CHECK (mode IN ('instant', 'batch'));

CREATE INDEX IF NOT EXISTS idx_btc_withdrawals_batch_queue
  ON public.btc_withdrawals (created_at)
  WHERE mode = 'batch' AND status IN ('queued', 'batched');

-- ── 3. Batch records: one row per runner evaluation ──────────────────────
-- Mirrors btc_consolidation_runs: skip rows carry member_count 0 and a
-- reason; a formed batch's row carries the members, inputs, txid and
-- the settled fee accounting. RLS on, no client policies — service
-- role only.
CREATE TABLE IF NOT EXISTS public.btc_withdrawal_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN (
    'forming', 'broadcast', 'broadcast_unknown', 'broadcast_unsettled',
    'released',
    'skipped_disabled', 'skipped_in_flight', 'skipped_empty',
    'skipped_fee_window', 'skipped_no_custody', 'skipped_insufficient_pool',
    'failed')),
  reason TEXT,
  fee_rate_sat_vb NUMERIC,
  forced_by_wait BOOLEAN NOT NULL DEFAULT false,
  member_count INTEGER NOT NULL DEFAULT 0,
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount_sats BIGINT,
  actual_fee_sats BIGINT,
  absorbed_sats BIGINT,
  vsize INTEGER,
  change_index BIGINT,
  txid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.btc_withdrawal_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_btc_withdrawal_batches_created
  ON public.btc_withdrawal_batches(created_at DESC);

ALTER TABLE public.btc_withdrawals
  DROP CONSTRAINT IF EXISTS btc_withdrawals_batch_id_fkey;
ALTER TABLE public.btc_withdrawals
  ADD CONSTRAINT btc_withdrawals_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.btc_withdrawal_batches(id);

-- ── 4. Queue a batched withdrawal (reserve at the solo estimate) ─────────
CREATE OR REPLACE FUNCTION public.btc_queue_batched_withdrawal(
  p_user_id UUID,
  p_to_address TEXT,
  p_amount_sats BIGINT,
  p_reserved_fee_sats BIGINT,
  p_solo_vsize INTEGER,
  p_idempotency_key TEXT,
  p_max_daily_sats BIGINT DEFAULT NULL,
  p_deadline TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE(withdrawal_id UUID, status TEXT, amount_sats BIGINT, fee_sats BIGINT, batch_deadline TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.btc_withdrawals%ROWTYPE;
  v_total BIGINT := p_amount_sats + p_reserved_fee_sats;
  v_sent_today BIGINT;
  v_held_sats BIGINT;
  v_available_sats BIGINT;
  v_id UUID;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_reserved_fee_sats IS NULL OR p_reserved_fee_sats < 0 THEN
    RAISE EXCEPTION 'Fee must be zero or positive';
  END IF;
  IF p_solo_vsize IS NULL OR p_solo_vsize <= 0 THEN
    RAISE EXCEPTION 'Solo vsize must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT w.* INTO v_existing
    FROM public.btc_withdrawals w
    WHERE w.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      -- L2 discipline (as in btc_reserve_withdrawal): a stored key is
      -- only ever replayed to its owner, and only within its own flow.
      IF v_existing.user_id <> p_user_id OR v_existing.mode <> 'batch' THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      withdrawal_id := v_existing.id; status := v_existing.status;
      amount_sats := v_existing.amount_sats; fee_sats := v_existing.fee_sats;
      batch_deadline := v_existing.batch_deadline;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- The SAME per-user advisory lock the instant path takes, so queue
  -- and instant reservations serialize against each other and the cap
  -- sum below is atomic with the INSERT.
  PERFORM pg_advisory_xact_lock(hashtext('btc_reserve:' || p_user_id::text));

  -- Daily cap across every fund-committing status of BOTH flows.
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(w.amount_sats), 0) INTO v_sent_today
    FROM public.btc_withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('reserved', 'broadcast', 'confirmed', 'queued', 'batched')
      AND w.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily withdrawal limit exceeded';
    END IF;
  END IF;

  -- T+1 P2P withdrawal hold, identical to the instant path's: a
  -- queued withdrawal is still an on-chain exit, so sats inside
  -- their safety hold may not leave via the batch either. Read under
  -- the advisory lock above. The queue_send action surfaces this
  -- message to the user verbatim.
  v_held_sats := public.p2p_unmatured_withdrawal_hold_sats(p_user_id);
  IF v_held_sats > 0 THEN
    SELECT w.available_sats INTO v_available_sats
    FROM public.crypto_wallets w
    WHERE w.user_id = p_user_id AND w.asset = 'BTC';
    IF v_total > COALESCE(v_available_sats, 0) - v_held_sats THEN
      RAISE EXCEPTION 'Part of your Bitcoin is still inside its 24-hour safety hold from a recent P2P trade - that part is not available to withdraw yet';
    END IF;
  END IF;

  -- Debit amount + reserved solo fee atomically; raises if insufficient.
  PERFORM public.btc_adjust_crypto_wallet(p_user_id, -v_total, -v_total);

  INSERT INTO public.btc_withdrawals
    (user_id, to_address, amount_sats, fee_sats, reserved_fee_sats,
     solo_vsize, status, mode, idempotency_key, batch_deadline)
  VALUES
    (p_user_id, p_to_address, p_amount_sats, p_reserved_fee_sats,
     p_reserved_fee_sats, p_solo_vsize, 'queued', 'batch',
     p_idempotency_key, p_deadline)
  RETURNING id INTO v_id;

  withdrawal_id := v_id; status := 'queued';
  amount_sats := p_amount_sats; fee_sats := p_reserved_fee_sats;
  batch_deadline := p_deadline;
  RETURN NEXT;
END;
$$;

-- ── 5. Cancel a queued withdrawal (full reserve release) ────────────────
CREATE OR REPLACE FUNCTION public.btc_cancel_batched_withdrawal(
  p_user_id UUID,
  p_withdrawal_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.btc_withdrawals%ROWTYPE;
BEGIN
  SELECT w.* INTO v_row
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Withdrawal does not belong to this user';
  END IF;
  IF v_row.mode <> 'batch' THEN
    RAISE EXCEPTION 'Only a queued batch withdrawal can be cancelled here';
  END IF;
  IF v_row.status = 'cancelled' THEN
    RETURN 'already_cancelled';
  END IF;
  IF v_row.status <> 'queued' THEN
    RAISE EXCEPTION 'This withdrawal can no longer be cancelled — it is already on its way';
  END IF;

  -- Refund the reservation in full (amount + reserved fee never left).
  PERFORM public.btc_adjust_crypto_wallet(
    v_row.user_id,
    v_row.amount_sats + v_row.fee_sats,
    v_row.amount_sats + v_row.fee_sats);

  UPDATE public.btc_withdrawals
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_withdrawal_id;

  RETURN 'cancelled';
END;
$$;

-- ── 6. Claim the queue into a batch (one formation at a time) ───────────
CREATE OR REPLACE FUNCTION public.btc_claim_withdrawal_batch(
  p_max_members INTEGER
)
RETURNS TABLE(batch_id UUID, withdrawal_id UUID, user_id UUID, to_address TEXT,
              amount_sats BIGINT, fee_sats BIGINT, solo_vsize INTEGER, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch UUID;
  v_ids UUID[];
BEGIN
  -- Serialize formations globally: two runner ticks can never claim
  -- the same queue.
  PERFORM pg_advisory_xact_lock(hashtext('btc_batch_form'));

  -- One batch in flight at a time: an unresolved batch blocks new
  -- formations until it settles or is released.
  IF EXISTS (
    SELECT 1 FROM public.btc_withdrawal_batches b
    WHERE b.status IN ('forming', 'broadcast_unknown', 'broadcast_unsettled')
  ) THEN
    RETURN;
  END IF;

  SELECT array_agg(s.id ORDER BY s.created_at, s.id) INTO v_ids
  FROM (
    SELECT w.id, w.created_at
    FROM public.btc_withdrawals w
    WHERE w.mode = 'batch' AND w.status = 'queued'
    ORDER BY w.created_at, w.id
    LIMIT GREATEST(1, p_max_members)
    FOR UPDATE SKIP LOCKED
  ) s;
  IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.btc_withdrawal_batches (status, member_count, members)
  VALUES ('forming', array_length(v_ids, 1),
          (SELECT jsonb_agg(to_jsonb(x)) FROM unnest(v_ids) AS x))
  RETURNING id INTO v_batch;

  UPDATE public.btc_withdrawals
  SET status = 'batched', batch_id = v_batch, updated_at = now()
  WHERE id = ANY (v_ids);

  RETURN QUERY
  SELECT v_batch, w.id, w.user_id, w.to_address, w.amount_sats,
         w.fee_sats, w.solo_vsize, w.created_at
  FROM public.btc_withdrawals w
  WHERE w.id = ANY (v_ids)
  ORDER BY w.created_at, w.id;
END;
$$;

-- ── 7. Release a claim (proven pre-broadcast failure) ───────────────────
CREATE OR REPLACE FUNCTION public.btc_release_batch_claim(
  p_batch_id UUID,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT b.status INTO v_status
  FROM public.btc_withdrawal_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_status = 'released' THEN
    RETURN 'already_released';
  END IF;
  IF v_status <> 'forming' THEN
    RAISE EXCEPTION 'Only a forming batch can be released (status %)', v_status;
  END IF;

  UPDATE public.btc_withdrawals
  SET status = 'queued', batch_id = NULL, updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'batched';

  UPDATE public.btc_withdrawal_batches
  SET status = 'released', reason = p_reason, updated_at = now()
  WHERE id = p_batch_id;

  RETURN 'released';
END;
$$;

-- ── 8. Record a batch txid without changing member states ───────────────
-- Used the moment a broadcast is positively confirmed OR classified
-- unknown: reconciliation can find the transaction in the tables, and
-- later coin selections exclude its inputs via committedOutpoints.
CREATE OR REPLACE FUNCTION public.btc_record_batch_txid(
  p_batch_id UUID,
  p_txid TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.btc_withdrawal_batches
  SET txid = p_txid, updated_at = now()
  WHERE id = p_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  UPDATE public.btc_withdrawals
  SET txid = p_txid, updated_at = now()
  WHERE batch_id = p_batch_id AND status = 'batched';

  RETURN 'recorded';
END;
$$;

-- ── 9. Unknown broadcast: hold everything (never auto-refund) ───────────
CREATE OR REPLACE FUNCTION public.btc_mark_batch_broadcast_unknown(
  p_batch_id UUID,
  p_txid TEXT,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT b.status INTO v_status
  FROM public.btc_withdrawal_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_status = 'broadcast_unknown' THEN
    RETURN 'already_unknown';
  END IF;
  IF v_status <> 'forming' THEN
    RAISE EXCEPTION 'Only a forming batch can be marked broadcast-unknown (status %)', v_status;
  END IF;

  PERFORM public.btc_record_batch_txid(p_batch_id, p_txid);

  UPDATE public.btc_withdrawal_batches
  SET status = 'broadcast_unknown', reason = p_reason, updated_at = now()
  WHERE id = p_batch_id;

  RETURN 'broadcast_unknown';
END;
$$;

-- ── 10. Settle a broadcast batch: fee shares + reserve releases ─────────
-- p_shares: [{"withdrawal_id": uuid, "share_sats": n}, ...] from the
-- pure allocateBatchFeeShares policy (_shared/btc-core.ts). The RPC
-- re-validates everything it is told: exactly one share per member,
-- no share above the member's reserved fee, shares summing to at most
-- the actual fee (the difference is the platform-absorbed overage,
-- stored on the batch row). Per member: refund the unused reserve,
-- mark 'broadcast' with the batch txid, and write the activity-ledger
-- row with the ACTUAL share — atomically.
CREATE OR REPLACE FUNCTION public.btc_settle_withdrawal_batch(
  p_batch_id UUID,
  p_txid TEXT,
  p_actual_fee_sats BIGINT,
  p_shares JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.btc_withdrawal_batches%ROWTYPE;
  v_member_count INTEGER;
  v_share_count INTEGER;
  v_share_sum BIGINT;
  v_member RECORD;
  v_share BIGINT;
  v_refund BIGINT;
BEGIN
  SELECT b.* INTO v_batch
  FROM public.btc_withdrawal_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_batch.status = 'broadcast' THEN
    RETURN 'already_settled';
  END IF;
  -- 'forming' = the normal post-broadcast settle; 'broadcast_unknown'
  -- = the ops reconciliation settle once the outcome is proven.
  IF v_batch.status NOT IN ('forming', 'broadcast_unknown') THEN
    RAISE EXCEPTION 'Batch is not in a settleable state (status %)', v_batch.status;
  END IF;
  IF p_actual_fee_sats IS NULL OR p_actual_fee_sats < 0 THEN
    RAISE EXCEPTION 'Actual fee must be zero or positive';
  END IF;
  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' THEN
    RAISE EXCEPTION 'Shares must be a JSON array';
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.btc_withdrawals w
  WHERE w.batch_id = p_batch_id AND w.status = 'batched';

  WITH share_rows AS (
    SELECT (e->>'withdrawal_id')::uuid AS wid,
           (e->>'share_sats')::bigint AS share
    FROM jsonb_array_elements(p_shares) AS e
  )
  SELECT count(*), COALESCE(sum(share), 0) INTO v_share_count, v_share_sum
  FROM share_rows;

  IF v_share_count <> v_member_count THEN
    RAISE EXCEPTION 'Share count % does not match batch member count %',
      v_share_count, v_member_count;
  END IF;
  -- Every share names a distinct member of THIS batch, within its cap.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_shares) AS e
    LEFT JOIN public.btc_withdrawals w
      ON w.id = (e->>'withdrawal_id')::uuid
     AND w.batch_id = p_batch_id AND w.status = 'batched'
    WHERE w.id IS NULL
       OR (e->>'share_sats')::bigint < 0
       OR (e->>'share_sats')::bigint > w.fee_sats
  ) THEN
    RAISE EXCEPTION 'Invalid share: unknown member, negative, or above the reserved fee cap';
  END IF;
  IF (SELECT count(DISTINCT (e->>'withdrawal_id'))
      FROM jsonb_array_elements(p_shares) AS e) <> v_member_count THEN
    RAISE EXCEPTION 'Duplicate share for a batch member';
  END IF;
  IF v_share_sum > p_actual_fee_sats THEN
    RAISE EXCEPTION 'Shares exceed the actual batch fee';
  END IF;

  FOR v_member IN
    SELECT w.* FROM public.btc_withdrawals w
    WHERE w.batch_id = p_batch_id AND w.status = 'batched'
    ORDER BY w.id
    FOR UPDATE
  LOOP
    SELECT (e->>'share_sats')::bigint INTO v_share
    FROM jsonb_array_elements(p_shares) AS e
    WHERE (e->>'withdrawal_id')::uuid = v_member.id;

    v_refund := v_member.fee_sats - v_share;
    IF v_refund > 0 THEN
      PERFORM public.btc_adjust_crypto_wallet(v_member.user_id, v_refund, v_refund);
    END IF;

    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       description, reference, category, idempotency_key, metadata)
    VALUES
      (v_member.user_id,
       (v_member.amount_sats + v_share)::numeric / 100000000, 'BTC',
       'outgoing', 'bitcoin_onchain', 'completed',
       'Bitcoin withdrawal (on-chain, low-fee batch)',
       p_txid, 'btc_withdrawal',
       'btc-wd:' || v_member.id::text,
       jsonb_build_object(
         'type', 'withdrawal',
         'txid', p_txid,
         'fee_sats', v_share,
         'batched', true,
         'batch_id', p_batch_id,
         'reserved_fee_sats', v_member.fee_sats,
         'fee_refunded_sats', v_refund));

    UPDATE public.btc_withdrawals
    SET status = 'broadcast', txid = p_txid, fee_share_sats = v_share,
        broadcast_at = now(), updated_at = now()
    WHERE id = v_member.id;
  END LOOP;

  UPDATE public.btc_withdrawal_batches
  SET status = 'broadcast', txid = p_txid,
      actual_fee_sats = p_actual_fee_sats,
      absorbed_sats = p_actual_fee_sats - v_share_sum,
      updated_at = now()
  WHERE id = p_batch_id;

  RETURN 'settled';
END;
$$;

-- ── 11. Instant path: cap sum learns the batch statuses ─────────────────
-- CREATE OR REPLACE restating the LIVE body (fetched via
-- pg_get_functiondef 2026-10-26, P2P-hold amendment included) with
-- ONLY the cap status list extended ('queued', 'batched' added).
-- REPLACE preserves the existing ACL ({postgres, service_role}).
CREATE OR REPLACE FUNCTION public.btc_reserve_withdrawal(p_user_id uuid, p_to_address text, p_amount_sats bigint, p_fee_sats bigint, p_idempotency_key text, p_max_daily_sats bigint DEFAULT NULL::bigint)
 RETURNS TABLE(withdrawal_id uuid, status text, amount_sats bigint, fee_sats bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.btc_withdrawals%ROWTYPE;
  v_total BIGINT := p_amount_sats + p_fee_sats;
  v_sent_today BIGINT;
  v_held_sats BIGINT;
  v_available_sats BIGINT;
  v_id UUID;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_fee_sats IS NULL OR p_fee_sats < 0 THEN
    RAISE EXCEPTION 'Fee must be zero or positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT w.* INTO v_existing
    FROM public.btc_withdrawals w
    WHERE w.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      -- L2: a stored key is only ever replayed to its owner.
      IF v_existing.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      withdrawal_id := v_existing.id; status := v_existing.status;
      amount_sats := v_existing.amount_sats; fee_sats := v_existing.fee_sats;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- M1: serialize this user's reservations so the cap sum below and
  -- the INSERT are atomic against concurrent sends by the same user.
  -- Transaction-scoped: released automatically at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtext('btc_reserve:' || p_user_id::text));

  -- M1: the daily cap, enforced in the reserving transaction with the
  -- app layer's exact semantics (amount_sats only; 'reserved',
  -- 'broadcast' and 'confirmed' rows; rolling 24 hours). A NULL cap
  -- leaves enforcement to the app layer, as before this migration.
  -- P4 (20261225): 'queued' and 'batched' rows commit funds exactly
  -- like 'reserved' rows, so the cap sum counts them too — the ONLY
  -- behavioural delta in this restatement. The body below is the live
  -- definition verbatim (including the T+1 P2P withdrawal hold),
  -- verified against pg_get_functiondef before applying.
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(w.amount_sats), 0) INTO v_sent_today
    FROM public.btc_withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('reserved', 'broadcast', 'confirmed', 'queued', 'batched')
      AND w.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily withdrawal limit exceeded';
    END IF;
  END IF;

  -- T+1 P2P withdrawal hold (scope §3.8 amendment; Phase 1a finding
  -- 5): sats credited by a P2P release may not leave on-chain until
  -- their hold matures (default 24h). Reservable is what remains of
  -- available after unmatured holds; in-flight reservations are
  -- already out of available (debited at their reserve time), so
  -- they are not subtracted again. Read under the advisory lock
  -- above, so the figure cannot race another reservation by this
  -- user. The btc-onchain edge function returns this message to the
  -- user verbatim, before any broadcast.
  v_held_sats := public.p2p_unmatured_withdrawal_hold_sats(p_user_id);
  IF v_held_sats > 0 THEN
    SELECT w.available_sats INTO v_available_sats
    FROM public.crypto_wallets w
    WHERE w.user_id = p_user_id AND w.asset = 'BTC';
    IF v_total > COALESCE(v_available_sats, 0) - v_held_sats THEN
      RAISE EXCEPTION 'Part of your Bitcoin is still inside its 24-hour safety hold from a recent P2P trade - that part is not available to withdraw yet';
    END IF;
  END IF;

  -- Debit balance + available atomically; raises if insufficient.
  PERFORM public.btc_adjust_crypto_wallet(p_user_id, -v_total, -v_total);

  INSERT INTO public.btc_withdrawals
    (user_id, to_address, amount_sats, fee_sats, status, idempotency_key)
  VALUES
    (p_user_id, p_to_address, p_amount_sats, p_fee_sats, 'reserved', p_idempotency_key)
  RETURNING id INTO v_id;

  withdrawal_id := v_id; status := 'reserved';
  amount_sats := p_amount_sats; fee_sats := p_fee_sats;
  RETURN NEXT;
END;
$function$;

-- ── 12. Batcher cron (mirrors btc-consolidate-utxos / btc-check-deposits) ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-batch-withdrawals') THEN
    PERFORM cron.unschedule('btc-batch-withdrawals');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-batch-withdrawals',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/btc-onchain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"action": "run_batch"}'::jsonb);
  $$);

-- ── 13. Grants: service role only ────────────────────────────────────────
-- Fresh CREATEs inherit this project's DEFAULT function privileges
-- (EXECUTE to anon + authenticated); PUBLIC-only revokes do not remove
-- those — revoke every role explicitly, then grant service_role.
REVOKE ALL ON FUNCTION public.btc_queue_batched_withdrawal(UUID, TEXT, BIGINT, BIGINT, INTEGER, TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_cancel_batched_withdrawal(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_claim_withdrawal_batch(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_release_batch_claim(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_record_batch_txid(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_mark_batch_broadcast_unknown(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.btc_settle_withdrawal_batch(UUID, TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_queue_batched_withdrawal(UUID, TEXT, BIGINT, BIGINT, INTEGER, TEXT, BIGINT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_cancel_batched_withdrawal(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_claim_withdrawal_batch(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_release_batch_claim(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_record_batch_txid(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_mark_batch_broadcast_unknown(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_settle_withdrawal_batch(UUID, TEXT, BIGINT, JSONB) TO service_role;
