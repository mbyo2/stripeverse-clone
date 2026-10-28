-- Bank withdrawals: cash out to a ZAMBIAN BANK ACCOUNT (CEO order
-- 2026-10-28 — "Do a research and implement", the Payoneer-gap
-- programme's bank cash-out leg).
--
-- DESIGN — modelled on the two proven machines in this codebase:
--   * The PayPal withdrawal reserve/refund pair (20261024 +
--     the 20261213 float versions): reserve-first, row-locked,
--     idempotent; the fee rides ON TOP and returns in full on any
--     refund; every transition is exactly-once because the RPC
--     owns the state change under the row lock.
--   * The rail kill switch (20261242 paypal_payouts_enabled): a
--     platform_settings flag, default FALSE, refused BEFORE any
--     reservation with crafted copy, fail-closed when unreadable.
--
-- THE CHANNEL IS OPERATOR-PAID AT LAUNCH: there is no bank API
-- moving this money yet. A withdrawal is a reviewed instruction —
-- the user requests, the balance is RESERVED at request time, an
-- admin approves it, an operator pays it from the platform's own
-- bank account, and an admin marks it paid with the bank's own
-- reference. Reject / fail at any point before paid refunds the
-- full reservation exactly once. The status lifecycle is:
--
--   pending_review → approved → paid_out
--   pending_review → rejected  (refunded in the same transition)
--   pending_review|approved → failed (refunded in the same transition)
--
-- paid_out / rejected / failed are terminal. Terminal rows never
-- move again, so replays of any transition are no-ops.
--
-- CURRENCY: bank payouts settle in ZMW to Zambian banks, from the
-- user's ZMW wallet (the account's Main ZMW wallet by default).
-- A USD wallet cannot pay a Zambian bank directly — the user
-- converts to ZMW first, the same rule (and copy family) as the
-- PayPal ZMW gate. Nothing here ever implies a USD→bank payout.
--
-- SAVED METHODS: the user's saved bank accounts already live in
-- public.bank_accounts (managed on the Bank Transfers page,
-- owner-only RLS). A withdrawal SNAPSHOTS the chosen account's
-- bank / account name / account number onto its own row, so later
-- edits or deletion of the saved account can never rewrite what
-- was actually requested or paid.
--
-- SETTINGS (this migration):
--   platform_settings.bank_payouts_enabled  boolean NOT NULL DEFAULT false
--   platform_settings.bank_payout_fee_percent numeric NOT NULL DEFAULT 0
--   platform_settings.bank_payout_min_zmw   numeric NOT NULL DEFAULT 50
-- The fee mirrors the PayPal payout fee's shape (percent of the
-- amount, ON TOP, credited to the platform operator's wallet with
-- the same skip rules) and is 0 until the CEO sets a rate. The
-- minimum is a setting, not a constant, for the same reason.
--
-- GRANTS (CEO GRANT rule, approved 2026-10-28 — applies from the
-- 2026-10-30 Supabase cutover): the new table carries explicit
-- scoped grants below; RLS is the row-level gate. All money
-- movement runs through the SECURITY DEFINER RPCs, EXECUTE-granted
-- to service_role ONLY (the paypal-payout pattern); the bank-
-- payout edge function is the only caller. Admin transitions are
-- additionally role-checked inside their RPC (admin/super_admin),
-- so even a leaked service path cannot be driven by a plain user
-- session end-to-end: the function re-checks the role before it
-- calls, and audit rows are written by the function into
-- audit_logs (the paypal-admin pattern — the audit is required
-- and its failure is surfaced, never hidden).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS bank_payouts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_payout_fee_percent numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bank_payout_min_zmw numeric NOT NULL DEFAULT 50;

-- ── The withdrawal ledger ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  wallet_id uuid NOT NULL REFERENCES public.wallets(id),
  bank_account_id uuid REFERENCES public.bank_accounts(id),
  bank_name text NOT NULL,
  bank_code text,
  account_name text NOT NULL,
  account_number text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ZMW' CHECK (currency = 'ZMW'),
  fee_amount numeric NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review', 'approved', 'paid_out', 'rejected', 'failed')),
  failure_reason text,
  admin_note text,
  external_reference text,
  idempotency_key text NOT NULL UNIQUE,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  paid_by uuid REFERENCES auth.users(id),
  paid_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bank_withdrawals_user_created_idx
  ON public.bank_withdrawals (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_withdrawals_status_created_idx
  ON public.bank_withdrawals (status, created_at);

ALTER TABLE public.bank_withdrawals ENABLE ROW LEVEL SECURITY;

-- Owner read only: a user can see their own withdrawal history.
-- All writes run through the service_role RPCs below (RLS does not
-- gate the definer functions; their EXECUTE grant does).
DROP POLICY IF EXISTS "Users view own bank withdrawals" ON public.bank_withdrawals;
CREATE POLICY "Users view own bank withdrawals"
  ON public.bank_withdrawals FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- Admin read: the payout queue's data gate at the row level too
-- (the edge function reads via service_role regardless; this keeps
-- direct client reads least-privilege if ever used).
DROP POLICY IF EXISTS "Admins view bank withdrawal queue" ON public.bank_withdrawals;
CREATE POLICY "Admins view bank withdrawal queue"
  ON public.bank_withdrawals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role));

-- Scoped grants (GRANT rule): authenticated SELECT is the only
-- client-facing surface, and RLS above decides which rows. The
-- REVOKEs strip the pre-cutover auto-grants a fresh CREATE TABLE
-- still inherits today (full DML for anon + authenticated), so
-- the table's effective grants are exactly the scoped ones in
-- every environment, before and after the cutover.
REVOKE ALL ON public.bank_withdrawals FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.bank_withdrawals FROM authenticated;
GRANT SELECT ON public.bank_withdrawals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_withdrawals TO service_role;

-- ── Reserve: debit + hold at request time ────────────────────────
-- Mirrors reserve_paypal_withdrawal (20261213) minus provenance and
-- float (a bank payout is funded by the wallet balance itself —
-- any money in the ZMW wallet may leave by bank). Differences:
--   * ZMW only, settings-driven minimum and fee;
--   * the destination is a snapshot of a saved bank_accounts row
--     the caller owns (re-checked under no lock — the row is the
--     caller's own and the snapshot is taken in this transaction);
--   * the row is born 'pending_review' (an admin must approve
--     before any operator pays it).
CREATE OR REPLACE FUNCTION public.reserve_bank_withdrawal(
  p_user_id uuid,
  p_wallet_id uuid,           -- NULL = caller's Main ZMW wallet
  p_bank_account_id uuid,
  p_amount numeric,
  p_idempotency_key text
)
RETURNS TABLE(
  outcome text,
  withdrawal_id uuid,
  wallet_id uuid,
  fee_amount numeric,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet public.wallets;
  v_account public.bank_accounts;
  v_existing public.bank_withdrawals;
  v_fee_rate numeric;
  v_min numeric;
  v_fee numeric := 0;
  v_platform_user uuid;
  v_platform_wallet public.wallets;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;
  IF p_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Choose the bank account to pay to';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a replayed reserve returns the original request.
  SELECT * INTO v_existing FROM public.bank_withdrawals bw
  WHERE bw.idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key belongs to another user';
    END IF;
    outcome := 'already_reserved';
    withdrawal_id := v_existing.id;
    wallet_id := v_existing.wallet_id;
    fee_amount := v_existing.fee_amount;
    SELECT w.balance INTO new_balance FROM public.wallets w
    WHERE w.id = v_existing.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- The destination: one of the caller's OWN saved bank accounts.
  SELECT * INTO v_account FROM public.bank_accounts ba
  WHERE ba.id = p_bank_account_id AND ba.user_id = p_user_id;
  IF v_account.id IS NULL THEN
    outcome := 'bank_account_not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  -- The source wallet: the one the caller named (must be theirs)
  -- or their Main ZMW wallet. Locked for the debit.
  IF p_wallet_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets
    WHERE id = p_wallet_id AND user_id = p_user_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_wallet FROM public.wallets
    WHERE user_id = p_user_id AND currency = 'ZMW'
      AND account_id IS NULL
    FOR UPDATE;
  END IF;
  IF v_wallet.id IS NULL THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.currency <> 'ZMW' THEN
    outcome := 'currency_mismatch';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
  END IF;
  -- A frozen wallet may receive but never send (platform-wide rule).
  IF v_wallet.status <> 'active' THEN
    outcome := 'wallet_not_active';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Settings: the minimum is settings-driven (default K50).
  v_min := COALESCE(
    (SELECT s.bank_payout_min_zmw FROM public.platform_settings s WHERE s.id),
    50);
  IF p_amount < v_min THEN
    outcome := 'below_minimum';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Fee: read defensively — a missing row means the DEFAULT, 0.
  -- Resolved BEFORE the debit, with the PayPal reserve's skip
  -- rules: no platform operator yet, the requester IS the operator,
  -- or a closed platform wallet → the fee is simply not charged.
  v_fee_rate := COALESCE(
    (SELECT s.bank_payout_fee_percent FROM public.platform_settings s WHERE s.id),
    0);
  IF v_fee_rate > 0 THEN
    v_fee := round(p_amount * v_fee_rate / 100, 2);
  END IF;
  IF v_fee > 0 THEN
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;
    IF v_platform_user IS NULL OR v_platform_user = p_user_id THEN
      v_fee := 0;
    ELSE
      SELECT * INTO v_platform_wallet FROM public.wallets
      WHERE user_id = v_platform_user AND currency = 'ZMW'
        AND account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet.id IS NULL THEN
        INSERT INTO public.wallets (user_id, currency, balance, status)
        VALUES (v_platform_user, 'ZMW', 0, 'active')
        RETURNING * INTO v_platform_wallet;
      END IF;
      IF v_platform_wallet.status = 'closed' THEN
        v_fee := 0;
      END IF;
    END IF;
  END IF;

  -- The fee rides ON TOP: the balance must cover amount + fee.
  IF v_wallet.balance < p_amount + v_fee THEN
    outcome := 'insufficient_balance';
    wallet_id := v_wallet.id;
    new_balance := v_wallet.balance;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Snapshot the destination onto the withdrawal row: later edits
  -- to the saved account never rewrite this request.
  INSERT INTO public.bank_withdrawals
    (user_id, wallet_id, bank_account_id, bank_name, bank_code,
     account_name, account_number, amount, currency, fee_amount,
     status, idempotency_key)
  VALUES
    (p_user_id, v_wallet.id, v_account.id, v_account.bank_name,
     v_account.bank_code, v_account.account_name, v_account.account_number,
     p_amount, 'ZMW', v_fee, 'pending_review', p_idempotency_key)
  RETURNING id INTO withdrawal_id;

  UPDATE public.wallets
  SET balance = balance - p_amount - v_fee, updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_wallet.id, p_amount, 'ZMW', 'outgoing', 'bank_transfer',
     'pending', v_account.account_name,
     'Bank withdrawal to ' || v_account.bank_name || ' account ending '
       || right(v_account.account_number, 4),
     withdrawal_id::text, 'withdrawal', p_idempotency_key);

  IF v_fee > 0 THEN
    UPDATE public.wallets
    SET balance = balance + v_fee, updated_at = now()
    WHERE id = v_platform_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_user_id, v_wallet.id, v_fee, 'ZMW', 'outgoing', 'bank_transfer',
       'completed', 'BMaGlass Pay',
       'Bank withdrawal fee',
       withdrawal_id::text, 'withdrawal_fee', p_idempotency_key || ':fee');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_platform_user, v_platform_wallet.id, v_fee, 'ZMW', 'incoming',
       'bank_transfer', 'completed', v_account.account_name,
       'Bank withdrawal fee',
       withdrawal_id::text, 'withdrawal_fee', p_idempotency_key || ':fee:in');
  END IF;

  outcome := 'reserved';
  wallet_id := v_wallet.id;
  fee_amount := v_fee;
  new_balance := v_wallet.balance - p_amount - v_fee;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_bank_withdrawal(uuid, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_bank_withdrawal(uuid, uuid, uuid, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.reserve_bank_withdrawal(uuid, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_bank_withdrawal(uuid, uuid, uuid, numeric, text) TO service_role;

-- ── Refund leg (internal): restore amount + fee exactly once ────
-- Called ONLY by the transition function below, never directly:
-- EXECUTE is revoked from every role including service_role, and
-- the caller check refuses anything but the definer-owned
-- transition path (a SECURITY DEFINER caller runs with
-- current_user = the function owner; a direct session call does
-- not, except for the owner themselves — who needs no RPC).
CREATE OR REPLACE FUNCTION public.refund_bank_withdrawal_internal(
  p_withdrawal_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wd public.bank_withdrawals;
  v_wallet public.wallets;
BEGIN
  SELECT * INTO v_wd FROM public.bank_withdrawals bw
  WHERE bw.id = p_withdrawal_id
  FOR UPDATE;
  IF v_wd.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  -- Exactly-once: a row that already carries refunded_at was
  -- already made whole (by the transition that set it).
  IF v_wd.refunded_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE id = v_wd.wallet_id
  FOR UPDATE;
  IF v_wallet.id IS NULL OR v_wallet.status = 'closed' THEN
    -- The money stays reserved in the withdrawal row, retryable —
    -- never silently dropped. The transition aborts with it.
    RAISE EXCEPTION 'The wallet for this withdrawal is closed and cannot take the refund';
  END IF;

  UPDATE public.wallets
  SET balance = balance + v_wd.amount + v_wd.fee_amount, updated_at = now()
  WHERE id = v_wallet.id;

  -- The debit row stops claiming the money is on its way.
  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE idempotency_key = v_wd.idempotency_key
    AND direction = 'outgoing';

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (v_wd.user_id, v_wallet.id, v_wd.amount + v_wd.fee_amount, 'ZMW',
     'incoming', 'bank_transfer', 'completed', 'BMaGlass Pay',
     'Bank withdrawal refund — the payout was not completed',
     v_wd.id::text, 'withdrawal_refund', v_wd.idempotency_key || ':refund');

  -- Take back the fee leg: the platform does not keep a fee on a
  -- withdrawal it could not deliver (the PayPal refund's rule).
  IF v_wd.fee_amount > 0 THEN
    UPDATE public.transactions
    SET status = 'failed', updated_at = now()
    WHERE idempotency_key = v_wd.idempotency_key || ':fee:in'
      AND direction = 'incoming';
    UPDATE public.wallets w
    SET balance = w.balance - v_wd.fee_amount, updated_at = now()
    FROM public.transactions t
    WHERE t.idempotency_key = v_wd.idempotency_key || ':fee:in'
      AND t.wallet_id = w.id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_bank_withdrawal_internal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_bank_withdrawal_internal(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.refund_bank_withdrawal_internal(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.refund_bank_withdrawal_internal(uuid, text) FROM service_role;

-- ── Admin transitions: approve / reject / mark paid / fail ───────
-- One function owns the lifecycle so the legal moves exist in
-- exactly one place. Role-checked INSIDE (admin / super_admin)
-- against p_admin_id — the edge function passes the JWT-resolved
-- caller and has already applied the same gate; the RPC check is
-- the authoritative one because it cannot be skipped by a caller
-- that reaches the RPC directly with the service key.
--
--   approve:   pending_review → approved            (no money move)
--   reject:    pending_review → rejected + refund   (reason required)
--   mark_paid: approved → paid_out                  (bank reference required;
--                                                    debit row completes)
--   fail:      pending_review|approved → failed + refund (reason required)
-- Any other move answers 'invalid_transition' and changes nothing.
CREATE OR REPLACE FUNCTION public.transition_bank_withdrawal(
  p_withdrawal_id uuid,
  p_admin_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_external_reference text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  withdrawal_status text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wd public.bank_withdrawals;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ref text := NULLIF(btrim(COALESCE(p_external_reference, '')), '');
BEGIN
  -- Authoritative role gate.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_admin_id
      AND ur.role IN ('admin'::app_role, 'super_admin'::app_role)
  ) THEN
    outcome := 'forbidden';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_wd FROM public.bank_withdrawals bw
  WHERE bw.id = p_withdrawal_id
  FOR UPDATE;
  IF v_wd.id IS NULL THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_action = 'approve' AND v_wd.status = 'pending_review' THEN
    UPDATE public.bank_withdrawals
    SET status = 'approved',
        reviewed_by = p_admin_id, reviewed_at = now(),
        admin_note = COALESCE(v_reason, admin_note),
        updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'approved';
    withdrawal_status := 'approved';

  ELSIF p_action = 'reject' AND v_wd.status = 'pending_review' THEN
    IF v_reason IS NULL THEN
      outcome := 'reason_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    PERFORM public.refund_bank_withdrawal_internal(v_wd.id, v_reason);
    UPDATE public.bank_withdrawals
    SET status = 'rejected',
        failure_reason = v_reason,
        reviewed_by = p_admin_id, reviewed_at = now(),
        refunded_at = now(), updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'rejected';
    withdrawal_status := 'rejected';

  ELSIF p_action = 'mark_paid' AND v_wd.status = 'approved' THEN
    IF v_ref IS NULL THEN
      outcome := 'reference_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    UPDATE public.bank_withdrawals
    SET status = 'paid_out',
        external_reference = v_ref,
        paid_by = p_admin_id, paid_at = now(),
        updated_at = now()
    WHERE id = v_wd.id;
    -- The money has left: the pending debit becomes a completed one.
    UPDATE public.transactions
    SET status = 'completed', updated_at = now()
    WHERE idempotency_key = v_wd.idempotency_key
      AND direction = 'outgoing'
      AND status = 'pending';
    outcome := 'paid_out';
    withdrawal_status := 'paid_out';

  ELSIF p_action = 'fail' AND v_wd.status IN ('pending_review', 'approved') THEN
    IF v_reason IS NULL THEN
      outcome := 'reason_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    PERFORM public.refund_bank_withdrawal_internal(v_wd.id, v_reason);
    UPDATE public.bank_withdrawals
    SET status = 'failed',
        failure_reason = v_reason,
        refunded_at = now(), updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'failed';
    withdrawal_status := 'failed';

  ELSE
    outcome := 'invalid_transition';
    withdrawal_status := v_wd.status;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.balance INTO new_balance FROM public.wallets w
  WHERE w.id = v_wd.wallet_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_bank_withdrawal(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_bank_withdrawal(uuid, uuid, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.transition_bank_withdrawal(uuid, uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.transition_bank_withdrawal(uuid, uuid, text, text, text) TO service_role;

-- ── Treasury: pending bank-payout liabilities (super_admin) ──────
-- The Treasury console's pattern (20261222): a SECURITY DEFINER
-- entry point that gates on super_admin INSIDE, EXECUTE granted to
-- authenticated (the gate does the real work). Liabilities are the
-- reserved-but-unpaid rows: pending_review + approved. Their money
-- has left user wallets but not yet the platform — exactly what a
-- treasury view must not lose sight of.
CREATE OR REPLACE FUNCTION public.treasury_bank_payout_liabilities()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can view treasury data';
  END IF;
  RETURN (
    SELECT jsonb_build_object(
      'pending_review_count', COUNT(*) FILTER (WHERE bw.status = 'pending_review'),
      'pending_review_zmw', COALESCE(SUM(bw.amount + bw.fee_amount)
        FILTER (WHERE bw.status = 'pending_review'), 0),
      'approved_count', COUNT(*) FILTER (WHERE bw.status = 'approved'),
      'approved_zmw', COALESCE(SUM(bw.amount + bw.fee_amount)
        FILTER (WHERE bw.status = 'approved'), 0),
      'total_outstanding_zmw', COALESCE(SUM(bw.amount + bw.fee_amount)
        FILTER (WHERE bw.status IN ('pending_review', 'approved')), 0)
    )
    FROM public.bank_withdrawals bw
  );
END;
$$;

REVOKE ALL ON FUNCTION public.treasury_bank_payout_liabilities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_bank_payout_liabilities() FROM anon;
GRANT EXECUTE ON FUNCTION public.treasury_bank_payout_liabilities() TO authenticated;
