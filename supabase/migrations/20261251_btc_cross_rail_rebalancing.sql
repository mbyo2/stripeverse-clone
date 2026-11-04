-- ============================================================================
-- 20261251 — Automatic cross-rail pool rebalancing (CEO decision
-- 2026-11-04 18:36: one unified custodial balance per account,
-- sendable on EITHER rail regardless of how the funds arrived —
-- "just like other popular wallets").
--
-- The $0 send-safety mission (20261250) made pool refusals
-- classifiable: POOL_SHORT_REBALANCE_NEEDED (this rail is short, the
-- platform's combined backing covers the send) vs
-- INSUFFICIENT_PLATFORM_FUNDS (a true refusal). This migration is
-- the machinery that converts the first class into queue-and-bridge:
--
--   LEDGER   — btc_rebalance_requests: one row per bridge operation
--              (direction, amount, reason, state machine
--              requested → awaiting_operator → bridging → confirming
--              → completed/failed, bridge txid). btc_request_
--              rebalance() is the exactly-once entry point: a second
--              request for the same direction while one is in flight
--              JOINS it (links the caller's send, never double-
--              executes). btc_rebalance_links binds queued sends
--              (btc_withdrawals / lightning_payments rows) to the
--              request that will unblock them.
--   QUEUE    — 'awaiting_rebalance' joins the status vocabulary of
--              btc_withdrawals and lightning_payments, and joins
--              EVERY fund-committing sum (the two reserve RPCs'
--              daily-cap lists, restated below) so a queued send
--              commits its user's funds exactly like a reserved one.
--              Dedicated RPCs move rows into, out of, and (with a
--              full refund) out-for-good of the state.
--   TREASURY — btc_platform_addresses: chain-0 addresses allocated
--              from the shared derivation sequence for PLATFORM
--              purposes (the Coinos → Sparrow bridge destination).
--              They are never in btc_address_assignments, so the
--              deposit scanner can never credit them to a user —
--              a bridge is platform-internal and moves NO user's
--              ledger balance.
--   POLICY   — operator-tunable thresholds on platform_settings:
--              buffer, min/max bridge, daily bridge cap, cooldown,
--              bounded wait, per-rail pool targets for proactive
--              top-ups, and the operator-supplied Coinos Bitcoin
--              deposit address fallback.
--   CRONS    — btc-process-rebalance (btc-onchain, every 5 min)
--              executes/advances bridges, enforces the bounded wait,
--              resumes queued on-chain sends and requests proactive
--              top-ups; btc-process-rebalance-lightning
--              (lightning-service, every 5 min, offset) resumes or
--              releases queued Lightning sends.
--
-- Grant discipline (CEO rule 2026-10-28/30): new tables are
-- service_role-only — RLS on, no policies, explicit REVOKE from
-- PUBLIC/anon/authenticated (REVOKE can silently no-op when the
-- grantor differs, so ACLs are verified live after applying).
-- ============================================================================

-- ── 1. Policy columns on platform_settings ─────────────────────────────────

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS btc_rebalance_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS btc_rebalance_buffer_sats BIGINT NOT NULL DEFAULT 50000,
  ADD COLUMN IF NOT EXISTS btc_rebalance_min_sats BIGINT NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS btc_rebalance_max_tx_sats BIGINT NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS btc_rebalance_max_daily_sats BIGINT NOT NULL DEFAULT 5000000,
  ADD COLUMN IF NOT EXISTS btc_rebalance_cooldown_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS btc_rebalance_max_wait_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS btc_rebalance_target_lightning_sats BIGINT NOT NULL DEFAULT 200000,
  ADD COLUMN IF NOT EXISTS btc_rebalance_target_onchain_sats BIGINT NOT NULL DEFAULT 200000,
  ADD COLUMN IF NOT EXISTS btc_coinos_deposit_address TEXT;

-- ── 2. Status vocabulary: 'awaiting_rebalance' ─────────────────────────────

ALTER TABLE public.btc_withdrawals
  DROP CONSTRAINT IF EXISTS btc_withdrawals_status_check;
ALTER TABLE public.btc_withdrawals
  ADD CONSTRAINT btc_withdrawals_status_check
  CHECK (status IN ('pending', 'reserved', 'broadcast', 'confirmed', 'failed',
                    'queued', 'batched', 'cancelled', 'awaiting_rebalance'));

ALTER TABLE public.lightning_payments
  DROP CONSTRAINT IF EXISTS lightning_payments_status_check;
ALTER TABLE public.lightning_payments
  ADD CONSTRAINT lightning_payments_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'expired', 'failed',
                    'awaiting_rebalance'));

-- ── 3. The rebalance ledger ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.btc_rebalance_requests (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction                TEXT NOT NULL CHECK (direction IN ('lightning_to_onchain', 'onchain_to_lightning')),
  amount_sats              BIGINT NOT NULL CHECK (amount_sats > 0),
  reason                   TEXT NOT NULL CHECK (reason IN ('send', 'topup')),
  status                   TEXT NOT NULL DEFAULT 'requested'
                             CHECK (status IN ('requested', 'awaiting_operator', 'bridging',
                                               'confirming', 'completed', 'failed')),
  bridge_txid              TEXT,
  bridge_address           TEXT,
  source_balance_before_sats BIGINT,
  received_sats            BIGINT,
  fee_sats                 BIGINT,
  failure_reason           TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_btc_rebalance_requests_direction_status
  ON public.btc_rebalance_requests (direction, status);
CREATE INDEX IF NOT EXISTS idx_btc_rebalance_requests_status
  ON public.btc_rebalance_requests (status);

ALTER TABLE public.btc_rebalance_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.btc_rebalance_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.btc_rebalance_requests FROM anon, authenticated;
GRANT ALL ON TABLE public.btc_rebalance_requests TO service_role;

-- Queued sends bound to the request that will unblock them. A send
-- (kind, ref_id) links to exactly one request at a time; relinking
-- (a completed bridge that still leaves the send short) moves it.
CREATE TABLE IF NOT EXISTS public.btc_rebalance_links (
  request_id UUID NOT NULL REFERENCES public.btc_rebalance_requests(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('withdrawal', 'lightning_payment')),
  ref_id     UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref_id)
);

CREATE INDEX IF NOT EXISTS idx_btc_rebalance_links_request
  ON public.btc_rebalance_links (request_id);

ALTER TABLE public.btc_rebalance_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.btc_rebalance_links FROM PUBLIC;
REVOKE ALL ON TABLE public.btc_rebalance_links FROM anon, authenticated;
GRANT ALL ON TABLE public.btc_rebalance_links TO service_role;

-- ── 4. Platform treasury addresses ─────────────────────────────────────────
-- Chain-0 addresses from the shared derivation sequence, owned by
-- the platform (never assigned to a user, never scanned for user
-- deposits). scanPoolUtxos covers their indices so bridged UTXOs
-- stay in the pool's spendable set once the engine notes them.

CREATE TABLE IF NOT EXISTS public.btc_platform_addresses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose          TEXT NOT NULL UNIQUE,
  derivation_index BIGINT NOT NULL UNIQUE,
  address          TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.btc_platform_addresses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.btc_platform_addresses FROM PUBLIC;
REVOKE ALL ON TABLE public.btc_platform_addresses FROM anon, authenticated;
GRANT ALL ON TABLE public.btc_platform_addresses TO service_role;

-- ── 5. Request a rebalance (exactly-once; concurrent requests join) ───────
--
-- Serialized per direction by an advisory lock: while a request for
-- the direction is in flight (requested / awaiting_operator /
-- bridging / confirming), a new caller JOINS it — its send is
-- linked and the in-flight row is returned with created = false.
-- If the in-flight request has not started bridging yet and the new
-- caller needs more, the amount grows to cover it. A fresh request
-- is inserted only when nothing is in flight.

CREATE OR REPLACE FUNCTION public.btc_request_rebalance(
  p_direction TEXT,
  p_amount_sats BIGINT,
  p_reason TEXT,
  p_linked_kind TEXT DEFAULT NULL,
  p_linked_id UUID DEFAULT NULL
)
RETURNS TABLE(request_id UUID, created BOOLEAN, status TEXT, amount_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.btc_rebalance_requests%ROWTYPE;
  v_id UUID;
BEGIN
  IF p_direction NOT IN ('lightning_to_onchain', 'onchain_to_lightning') THEN
    RAISE EXCEPTION 'Unknown rebalance direction %', p_direction;
  END IF;
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Rebalance amount must be positive';
  END IF;
  IF p_reason NOT IN ('send', 'topup') THEN
    RAISE EXCEPTION 'Unknown rebalance reason %', p_reason;
  END IF;
  IF (p_linked_kind IS NULL) <> (p_linked_id IS NULL) THEN
    RAISE EXCEPTION 'Linked kind and id must be supplied together';
  END IF;
  IF p_linked_kind IS NOT NULL AND p_linked_kind NOT IN ('withdrawal', 'lightning_payment') THEN
    RAISE EXCEPTION 'Unknown linked kind %', p_linked_kind;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('btc_rebalance:' || p_direction));

  SELECT r.* INTO v_existing
  FROM public.btc_rebalance_requests r
  WHERE r.direction = p_direction
    AND r.status IN ('requested', 'awaiting_operator', 'bridging', 'confirming')
  ORDER BY r.created_at ASC
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    -- Join the in-flight request. Grow it only while it has not
    -- started moving money; a bridging request keeps its amount and
    -- the caller re-checks after it completes.
    IF v_existing.status = 'requested' AND p_amount_sats > v_existing.amount_sats THEN
      UPDATE public.btc_rebalance_requests
      SET amount_sats = p_amount_sats, updated_at = now()
      WHERE id = v_existing.id;
      v_existing.amount_sats := p_amount_sats;
    END IF;
    IF p_linked_kind IS NOT NULL THEN
      INSERT INTO public.btc_rebalance_links (request_id, kind, ref_id)
      VALUES (v_existing.id, p_linked_kind, p_linked_id)
      ON CONFLICT (kind, ref_id)
      DO UPDATE SET request_id = EXCLUDED.request_id, created_at = now();
    END IF;
    request_id := v_existing.id; created := FALSE;
    status := v_existing.status; amount_sats := v_existing.amount_sats;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.btc_rebalance_requests (direction, amount_sats, reason)
  VALUES (p_direction, p_amount_sats, p_reason)
  RETURNING id INTO v_id;

  IF p_linked_kind IS NOT NULL THEN
    INSERT INTO public.btc_rebalance_links (request_id, kind, ref_id)
    VALUES (v_id, p_linked_kind, p_linked_id)
    ON CONFLICT (kind, ref_id)
    DO UPDATE SET request_id = EXCLUDED.request_id, created_at = now();
  END IF;

  request_id := v_id; created := TRUE;
  status := 'requested'; amount_sats := p_amount_sats;
  RETURN NEXT;
END;
$$;

-- ── 6. Withdrawal queue/resume/fail around 'awaiting_rebalance' ────────────

-- Move a fund-committed withdrawal ('reserved' instant or 'queued'
-- batch) into the awaiting-rebalance state. Idempotent.
CREATE OR REPLACE FUNCTION public.btc_mark_withdrawal_awaiting_rebalance(
  p_withdrawal_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT w.status INTO v_status
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_status = 'awaiting_rebalance' THEN
    RETURN 'awaiting_rebalance';
  END IF;
  IF v_status NOT IN ('reserved', 'queued') THEN
    RAISE EXCEPTION 'Cannot queue withdrawal in status % for rebalancing', v_status;
  END IF;
  UPDATE public.btc_withdrawals
  SET status = 'awaiting_rebalance', updated_at = now()
  WHERE id = p_withdrawal_id;
  RETURN 'awaiting_rebalance';
END;
$$;

-- Return an awaiting withdrawal to the state its mode resumes into:
-- instant sends back to 'reserved' (the caller then executes them),
-- batch members back to 'queued' (the batcher picks them up).
CREATE OR REPLACE FUNCTION public.btc_resume_awaiting_withdrawal(
  p_withdrawal_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.btc_withdrawals%ROWTYPE;
  v_target TEXT;
BEGIN
  SELECT w.* INTO v_row
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_row.status <> 'awaiting_rebalance' THEN
    RAISE EXCEPTION 'Cannot resume withdrawal in status %', v_row.status;
  END IF;
  v_target := CASE WHEN v_row.mode = 'batch' THEN 'queued' ELSE 'reserved' END;
  UPDATE public.btc_withdrawals
  SET status = v_target, updated_at = now()
  WHERE id = p_withdrawal_id;
  RETURN v_target;
END;
$$;

-- Fail an awaiting withdrawal with a FULL refund of everything its
-- reservation committed (amount + fee for instant sends; amount +
-- reserved fee for batch members). Only from 'awaiting_rebalance':
-- nothing has been broadcast for these rows, so the refund is
-- always safe — the bounded-wait failure path the CEO's policy
-- requires.
CREATE OR REPLACE FUNCTION public.btc_fail_awaiting_withdrawal(
  p_withdrawal_id UUID,
  p_error TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.btc_withdrawals%ROWTYPE;
  v_refund BIGINT;
BEGIN
  SELECT w.* INTO v_row
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN 'failed';
  END IF;
  IF v_row.status <> 'awaiting_rebalance' THEN
    RAISE EXCEPTION 'Cannot fail withdrawal in status % from the rebalance path', v_row.status;
  END IF;
  v_refund := v_row.amount_sats +
    CASE WHEN v_row.mode = 'batch'
         THEN COALESCE(v_row.reserved_fee_sats, v_row.fee_sats)
         ELSE v_row.fee_sats END;
  PERFORM public.btc_adjust_crypto_wallet(v_row.user_id, v_refund, v_refund);
  UPDATE public.btc_withdrawals
  SET status = 'failed', error = p_error, updated_at = now()
  WHERE id = p_withdrawal_id;
  RETURN 'failed';
END;
$$;

-- True-up a reserved instant withdrawal's fee after a resume-time
-- re-selection (the fee rate may have moved while the send waited
-- for its bridge). Only from 'reserved'; the delta moves through
-- btc_adjust_crypto_wallet, so an increase the user cannot cover
-- raises and the caller fails the withdrawal with a full refund.
CREATE OR REPLACE FUNCTION public.btc_adjust_withdrawal_fee(
  p_withdrawal_id UUID,
  p_new_fee_sats BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.btc_withdrawals%ROWTYPE;
  v_delta BIGINT;
BEGIN
  IF p_new_fee_sats IS NULL OR p_new_fee_sats < 0 THEN
    RAISE EXCEPTION 'Fee must be zero or positive';
  END IF;
  SELECT w.* INTO v_row
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_row.status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot adjust fee for withdrawal in status %', v_row.status;
  END IF;
  v_delta := p_new_fee_sats - v_row.fee_sats;
  IF v_delta <> 0 THEN
    PERFORM public.btc_adjust_crypto_wallet(v_row.user_id, -v_delta, -v_delta);
    UPDATE public.btc_withdrawals
    SET fee_sats = p_new_fee_sats, updated_at = now()
    WHERE id = p_withdrawal_id;
  END IF;
  RETURN 'adjusted';
END;
$$;

-- ── 7. Lightning queue/resume around 'awaiting_rebalance' ──────────────────

CREATE OR REPLACE FUNCTION public.btc_queue_lightning_send(
  p_payment_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT lp.status INTO v_status
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Lightning payment not found';
  END IF;
  IF v_status = 'awaiting_rebalance' THEN
    RETURN 'awaiting_rebalance';
  END IF;
  IF v_status <> 'processing' THEN
    RAISE EXCEPTION 'Cannot queue lightning payment in status % for rebalancing', v_status;
  END IF;
  UPDATE public.lightning_payments
  SET status = 'awaiting_rebalance'
  WHERE id = p_payment_id;
  RETURN 'awaiting_rebalance';
END;
$$;

CREATE OR REPLACE FUNCTION public.btc_resume_lightning_send(
  p_payment_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT lp.status INTO v_status
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Lightning payment not found';
  END IF;
  IF v_status <> 'awaiting_rebalance' THEN
    RAISE EXCEPTION 'Cannot resume lightning payment in status %', v_status;
  END IF;
  UPDATE public.lightning_payments
  SET status = 'processing'
  WHERE id = p_payment_id;
  RETURN 'processing';
END;
$$;

-- ── 8. Restated reserve RPCs: 'awaiting_rebalance' commits funds ──────────
-- A send queued for rebalancing has its user's sats committed
-- exactly like a reserved one, so every daily-cap sum must count
-- the new status — otherwise a user could double-commit past the
-- cap by queueing. Bodies are the live definitions (migration
-- 20261225 for the withdrawal pair, 20261224 for the Lightning
-- reserve) with ONLY the status lists extended, plus the Lightning
-- release learning to release from the queued state (a queued
-- payment provably was never attempted, so the release is safe).

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
  PERFORM pg_advisory_xact_lock(hashtext('btc_reserve:' || p_user_id::text));

  -- Daily cap across every fund-committing status — 20261251 adds
  -- 'awaiting_rebalance' (a queued send's sats are committed until
  -- it broadcasts or is refunded).
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(w.amount_sats), 0) INTO v_sent_today
    FROM public.btc_withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('reserved', 'broadcast', 'confirmed', 'queued', 'batched', 'awaiting_rebalance')
      AND w.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily withdrawal limit exceeded';
    END IF;
  END IF;

  -- T+1 P2P withdrawal hold (unchanged from 20261225).
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

  -- The SAME per-user advisory lock the instant path takes.
  PERFORM pg_advisory_xact_lock(hashtext('btc_reserve:' || p_user_id::text));

  -- Daily cap across every fund-committing status of BOTH flows —
  -- 20261251 adds 'awaiting_rebalance'.
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(w.amount_sats), 0) INTO v_sent_today
    FROM public.btc_withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('reserved', 'broadcast', 'confirmed', 'queued', 'batched', 'awaiting_rebalance')
      AND w.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily withdrawal limit exceeded';
    END IF;
  END IF;

  -- T+1 P2P withdrawal hold, identical to the instant path's.
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

-- Lightning reserve: body of 20261224 with 'awaiting_rebalance'
-- added to the invoice-identity replay list (a queued payment is
-- the SAME payment — a resubmission joins it, never pays twice)
-- and to the daily-cap sum.
CREATE OR REPLACE FUNCTION public.btc_reserve_lightning_send(
  p_user_id UUID,
  p_bolt11 TEXT,
  p_payment_hash TEXT,
  p_amount_sats BIGINT,
  p_idempotency_key TEXT,
  p_max_daily_sats BIGINT DEFAULT NULL
)
RETURNS TABLE(payment_id UUID, status TEXT, amount_sats BIGINT, replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.lightning_payments%ROWTYPE;
  v_sent_today BIGINT;
  v_id UUID;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;
  IF p_payment_hash IS NULL OR length(trim(p_payment_hash)) = 0 THEN
    RAISE EXCEPTION 'A payment hash is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('btc_ln_send:' || p_user_id::text));

  SELECT lp.* INTO v_existing
  FROM public.lightning_payments lp
  WHERE lp.idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    payment_id := v_existing.id; status := v_existing.status;
    amount_sats := v_existing.amount_sats; replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT lp.* INTO v_existing
  FROM public.lightning_payments lp
  WHERE lp.user_id = p_user_id
    AND lp.direction = 'outbound'
    AND lp.payment_hash = p_payment_hash
    AND lp.status IN ('processing', 'paid', 'awaiting_rebalance')
  ORDER BY lp.created_at ASC
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    payment_id := v_existing.id; status := v_existing.status;
    amount_sats := v_existing.amount_sats; replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(lp.amount_sats), 0) INTO v_sent_today
    FROM public.lightning_payments lp
    WHERE lp.user_id = p_user_id
      AND lp.direction = 'outbound'
      AND lp.status IN ('processing', 'paid', 'awaiting_rebalance')
      AND lp.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily Lightning payment limit exceeded';
    END IF;
  END IF;

  PERFORM public.btc_adjust_crypto_wallet(p_user_id, 0, -p_amount_sats);

  INSERT INTO public.lightning_payments
    (user_id, direction, amount_sats, bolt11, payment_hash, status, idempotency_key)
  VALUES
    (p_user_id, 'outbound', p_bolt11, p_payment_hash,
     'processing', p_idempotency_key)
  RETURNING id INTO v_id;

  payment_id := v_id; status := 'processing';
  amount_sats := p_amount_sats; replayed := FALSE;
  RETURN NEXT;
END;
$$;

-- Lightning release: also valid from 'awaiting_rebalance' — the
-- bounded-wait failure path for a queued payment. A queued payment
-- was never attempted with the provider, so releasing its hold is
-- exactly as safe as releasing from 'processing' after a proven
-- refusal.
CREATE OR REPLACE FUNCTION public.btc_release_lightning_send(
  p_payment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, payment_status TEXT, amount_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.lightning_payments%ROWTYPE;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'A lightning payment id is required';
  END IF;

  SELECT lp.* INTO v_row
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    outcome := 'not_found'; payment_status := NULL; amount_sats := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  payment_status := v_row.status;
  amount_sats := v_row.amount_sats;

  IF v_row.direction <> 'outbound' THEN
    RAISE EXCEPTION 'Only outbound payments release here';
  END IF;
  IF v_row.status = 'failed' THEN
    outcome := 'already_released';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_row.status NOT IN ('processing', 'awaiting_rebalance') THEN
    RAISE EXCEPTION 'Cannot release lightning payment in status % — the payment may already have been made', v_row.status;
  END IF;

  PERFORM public.btc_adjust_crypto_wallet(v_row.user_id, 0, v_row.amount_sats);

  UPDATE public.lightning_payments
  SET status = 'failed',
      failure_reason = p_reason
  WHERE id = p_payment_id;

  outcome := 'released';
  payment_status := 'failed';
  RETURN NEXT;
END;
$$;

-- ── 9. Lock the new RPCs down to the service role ─────────────────────────
-- Fresh CREATEs inherit this project's DEFAULT function privileges
-- (EXECUTE to anon + authenticated); a PUBLIC-only revoke does not
-- remove those, so revoke the role grants explicitly (the 20261023
-- lesson) and grant service_role only. CREATE OR REPLACE preserves
-- the restated functions' ACLs; the grants are re-asserted anyway.

REVOKE ALL ON FUNCTION public.btc_request_rebalance(TEXT, BIGINT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_request_rebalance(TEXT, BIGINT, TEXT, TEXT, UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_request_rebalance(TEXT, BIGINT, TEXT, TEXT, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.btc_mark_withdrawal_awaiting_rebalance(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_mark_withdrawal_awaiting_rebalance(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_mark_withdrawal_awaiting_rebalance(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.btc_resume_awaiting_withdrawal(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_resume_awaiting_withdrawal(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_resume_awaiting_withdrawal(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.btc_fail_awaiting_withdrawal(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_fail_awaiting_withdrawal(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_fail_awaiting_withdrawal(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_adjust_withdrawal_fee(UUID, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_adjust_withdrawal_fee(UUID, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_adjust_withdrawal_fee(UUID, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_queue_lightning_send(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_queue_lightning_send(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_queue_lightning_send(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.btc_resume_lightning_send(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_resume_lightning_send(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_resume_lightning_send(UUID) TO service_role;

REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_queue_batched_withdrawal(UUID, TEXT, BIGINT, BIGINT, INTEGER, TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_queue_batched_withdrawal(UUID, TEXT, BIGINT, BIGINT, INTEGER, TEXT, BIGINT, TIMESTAMPTZ) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_queue_batched_withdrawal(UUID, TEXT, BIGINT, BIGINT, INTEGER, TEXT, BIGINT, TIMESTAMPTZ) TO service_role;

REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) TO service_role;

-- ── 10. Processor crons (every 5 minutes, offset from each other) ─────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-process-rebalance') THEN
    PERFORM cron.unschedule('btc-process-rebalance');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-process-rebalance-lightning') THEN
    PERFORM cron.unschedule('btc-process-rebalance-lightning');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-process-rebalance',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/btc-onchain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"action":"process_rebalance"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'btc-process-rebalance-lightning',
  '2-59/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/lightning-service',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"action":"process_rebalance"}'::jsonb
  );
  $$
);
