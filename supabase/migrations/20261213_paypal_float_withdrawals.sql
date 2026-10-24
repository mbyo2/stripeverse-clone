-- PayPal withdrawals: the PLATFORM FLOAT (CEO directive 2026-10-24
-- 22:36 — "Make something that can be withdrawn in PayPal").
--
-- Until now a user could withdraw to PayPal ONLY the marked,
-- PayPal-sourced portion of their balance (the provenance counter,
-- 20261028): payouts could never exceed PayPal money in. That rule
-- stays — provenance is still spent FIRST — but it is no longer the
-- only source. A super_admin may set a platform FLOAT ALLOWANCE
-- (platform_settings.paypal_float_allowance_usd, USD, DEFAULT 0 =
-- no float-backed payouts at all). A USD withdrawal larger than the
-- user's provenance draws the remainder from the float, up to the
-- allowance the owner has set because the platform's real PayPal
-- account is funded to cover it.
--
-- SOLVENCY TRUTH (unchanged, now two-layered): provenance payouts
-- are backed 1:1 by PayPal money that came in; float payouts settle
-- from the PLATFORM's own PayPal balance. The allowance is a CAP the
-- owner sets to match what that account actually holds — the code
-- cannot see the PayPal balance, so if a float payout is attempted
-- against an unfunded account, PayPal refuses it (INSUFFICIENT_FUNDS
-- / item FAILED) and the existing finalize/refund path returns the
-- money to the user's wallet with a plain-language failure. A
-- withdrawal can therefore never strand user money: it either
-- completes at PayPal or refunds in full, exactly once.
--
-- THE SPLIT: every withdrawal row records how it was funded —
--   provenance_amount — the part taken from the user's mark;
--   float_amount      — the part drawn on the platform float;
--   provenance_amount + float_amount = amount (CHECK-enforced).
-- Refund restores ONLY the provenance part to the counter (the float
-- part was never the user's mark). The float "used" figure is NOT a
-- stored counter: it is derived, here and everywhere, as
--   SUM(float_amount) over USD withdrawals NOT IN ('failed','refunded')
-- so a failed payout releases its float reservation automatically
-- the moment it is marked failed, and no counter can drift.
--
-- FLOAT IS USD-ONLY: the allowance is denominated in USD and the
-- float check applies only to USD withdrawals. Other payout
-- currencies remain provenance-only, exactly as before.
--
-- CONCURRENCY: reserves that need the float lock the single
-- platform_settings row FOR UPDATE before reading the derived used
-- sum, so two float draws cannot both pass against the same
-- remaining allowance. Pure-provenance reserves never take that
-- lock and are not slowed by it.
--
-- GATES KEPT: reserve/refund/complete stay SECURITY DEFINER,
-- service_role-only. The allowance is written only by the
-- paypal-admin edge function, which gates the write to super_admin
-- and audit-logs it (audit_logs). No authenticated write path to
-- platform_settings is added here.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS paypal_float_allowance_usd numeric NOT NULL DEFAULT 0;

ALTER TABLE public.paypal_withdrawals
  ADD COLUMN IF NOT EXISTS provenance_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS float_amount numeric NOT NULL DEFAULT 0;

-- Rows that predate the split were funded entirely by provenance
-- under the old rule; say so before the sum CHECK starts enforcing.
UPDATE public.paypal_withdrawals
SET provenance_amount = amount
WHERE provenance_amount = 0 AND float_amount = 0 AND amount > 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paypal_withdrawals_split_sums_to_amount'
      AND conrelid = 'public.paypal_withdrawals'::regclass
  ) THEN
    ALTER TABLE public.paypal_withdrawals
      ADD CONSTRAINT paypal_withdrawals_split_sums_to_amount
      CHECK (provenance_amount + float_amount = amount);
  END IF;
END;
$$;

-- ── Float used, derived from the ledger ──────────────────────────
-- The single definition of "float already committed": float parts
-- of USD withdrawals that are not failed. Pending/processing rows
-- count (the money is reserved or in flight); completed rows count
-- forever (the money left); failed rows release automatically.
CREATE OR REPLACE FUNCTION public.paypal_float_used_usd()
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(SUM(w.float_amount), 0)
  FROM public.paypal_withdrawals w
  WHERE w.currency = 'USD'
    AND w.status NOT IN ('failed', 'refunded');
$$;

REVOKE ALL ON FUNCTION public.paypal_float_used_usd() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypal_float_used_usd() FROM authenticated;
REVOKE ALL ON FUNCTION public.paypal_float_used_usd() FROM anon;
GRANT EXECUTE ON FUNCTION public.paypal_float_used_usd() TO service_role;

-- ── Reserve: provenance first, then the float ────────────────────
-- The 20261028 body with ONLY the funding-source changes marked
-- (20261213): the cap becomes provenance + float, the split is
-- computed and stored, and the counter is consumed by the
-- provenance part only. DROP first: the RETURNS TABLE gains
-- float_available, which CREATE OR REPLACE cannot change.
DROP FUNCTION IF EXISTS public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text);

CREATE FUNCTION public.reserve_paypal_withdrawal(
  p_user_id uuid,
  p_wallet_id uuid,           -- NULL = caller's Main wallet in p_currency
  p_amount numeric,
  p_currency text,
  p_recipient_email text,
  p_idempotency_key text
)
RETURNS TABLE(
  outcome text,
  withdrawal_id uuid,
  wallet_id uuid,
  fee_amount numeric,
  new_balance numeric,
  provenance_available numeric,
  daily_remaining numeric,
  float_available numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_wallet public.wallets;
  v_existing public.paypal_withdrawals;
  v_fee_rate numeric;
  v_fee numeric := 0;
  v_platform_user uuid;
  v_platform_wallet public.wallets;
  v_sourced numeric;
  v_today numeric;
  -- Funding split state (20261213).
  v_provenance_part numeric := 0;
  v_float_part numeric := 0;
  v_float_allowance numeric := 0;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF length(v_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid currency is required';
  END IF;
  IF p_recipient_email IS NULL OR position('@' in p_recipient_email) < 2 THEN
    RAISE EXCEPTION 'A valid recipient PayPal email is required';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a replayed reserve returns the original withdrawal.
  SELECT * INTO v_existing FROM public.paypal_withdrawals
  WHERE idempotency_key = p_idempotency_key;
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
    provenance_available := NULL;
    daily_remaining := NULL;
    float_available := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- The source wallet: the one the caller named (must be theirs) or
  -- their Main wallet in this currency. Locked for the debit.
  IF p_wallet_id IS NOT NULL THEN
    SELECT * INTO v_wallet FROM public.wallets
    WHERE id = p_wallet_id AND user_id = p_user_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_wallet FROM public.wallets
    WHERE user_id = p_user_id AND currency = v_currency
      AND account_id IS NULL
    FOR UPDATE;
  END IF;
  IF v_wallet.id IS NULL THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.currency <> v_currency THEN
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

  -- Limits (mirrors PAYOUT_MIN_AMOUNT / PAYOUT_DAILY_LIMIT).
  IF p_amount < 5 THEN
    outcome := 'below_minimum';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT COALESCE(SUM(w.amount), 0) INTO v_today
  FROM public.paypal_withdrawals w
  WHERE w.user_id = p_user_id
    AND w.currency = v_currency
    AND w.status NOT IN ('failed', 'refunded')
    AND w.created_at >= date_trunc('day', now());
  daily_remaining := GREATEST(0, 2000 - v_today);
  IF p_amount > daily_remaining THEN
    outcome := 'limit_exceeded';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── Provenance: the counter is the first source (20261028) ────
  -- PayPal-sourced money is tracked as a marked portion of the
  -- user's balance in public.paypal_provenance_balances: created
  -- only by verified PayPal captures, moved spent-first with the
  -- money, consumed here. The row is ensured and locked so
  -- concurrent reserves for this user+currency serialize on the
  -- counter itself.
  INSERT INTO public.paypal_provenance_balances (user_id, currency, sourced_amount)
  VALUES (p_user_id, v_currency, 0)
  ON CONFLICT (user_id, currency) DO NOTHING;
  SELECT b.sourced_amount INTO v_sourced
  FROM public.paypal_provenance_balances b
  WHERE b.user_id = p_user_id AND b.currency = v_currency
  FOR UPDATE;
  provenance_available := GREATEST(0, COALESCE(v_sourced, 0));

  -- ── The split (20261213): provenance first, float covers rest ──
  v_provenance_part := LEAST(p_amount, provenance_available);
  v_float_part := p_amount - v_provenance_part;
  float_available := 0;
  IF v_float_part > 0 THEN
    -- The float exists only for USD (its allowance is denominated
    -- in USD). Drawing on it serializes on the settings row so the
    -- derived used-sum read below cannot race a second draw.
    IF v_currency = 'USD' THEN
      SELECT s.paypal_float_allowance_usd INTO v_float_allowance
      FROM public.platform_settings s
      WHERE s.id
      FOR UPDATE;
      float_available := GREATEST(
        0, COALESCE(v_float_allowance, 0) - public.paypal_float_used_usd());
    END IF;
    IF v_float_part > float_available THEN
      outcome := 'over_provenance_cap';
      wallet_id := v_wallet.id;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Fee: read defensively — a missing row means the DEFAULT, 0.
  v_fee_rate := COALESCE(
    (SELECT paypal_payout_fee_percent FROM public.platform_settings WHERE id),
    0);
  IF v_fee_rate > 0 THEN
    v_fee := round(p_amount * v_fee_rate / 100, 2);
  END IF;

  -- Resolve where the fee would land BEFORE debiting: if there is
  -- no platform wallet to receive it (no admin, sender IS the
  -- platform, closed wallet), the fee is simply not charged — the
  -- same skip rules as the send fee.
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
      WHERE user_id = v_platform_user AND currency = v_currency
        AND account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet.id IS NULL THEN
        INSERT INTO public.wallets (user_id, currency, balance, status)
        VALUES (v_platform_user, v_currency, 0, 'active')
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

  INSERT INTO public.paypal_withdrawals
    (user_id, wallet_id, amount, currency, fee_amount, recipient_email,
     status, idempotency_key, provenance_amount, float_amount)
  VALUES
    (p_user_id, v_wallet.id, p_amount, v_currency, v_fee,
     btrim(p_recipient_email), 'pending', p_idempotency_key,
     v_provenance_part, v_float_part)
  RETURNING id INTO withdrawal_id;

  UPDATE public.wallets
  SET balance = balance - p_amount - v_fee, updated_at = now()
  WHERE id = v_wallet.id;

  -- Consume the mark for the PROVENANCE part only (never the fee,
  -- and never the float part: float money was never the user's
  -- PayPal-sourced mark).
  UPDATE public.paypal_provenance_balances
  SET sourced_amount = sourced_amount - v_provenance_part, updated_at = now()
  WHERE user_id = p_user_id AND currency = v_currency;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_wallet.id, p_amount, v_currency, 'outgoing', 'paypal',
     'pending', btrim(p_recipient_email),
     'PayPal withdrawal to ' || btrim(p_recipient_email),
     withdrawal_id::text, 'withdrawal', p_idempotency_key);

  IF v_fee > 0 THEN
    UPDATE public.wallets
    SET balance = balance + v_fee, updated_at = now()
    WHERE id = v_platform_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_user_id, v_wallet.id, v_fee, v_currency, 'outgoing', 'paypal',
       'completed', 'BMaGlass Pay',
       'PayPal withdrawal fee',
       withdrawal_id::text, 'withdrawal_fee', p_idempotency_key || ':fee');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_platform_user, v_platform_wallet.id, v_fee, v_currency, 'incoming',
       'paypal', 'completed', btrim(p_recipient_email),
       'PayPal withdrawal fee',
       withdrawal_id::text, 'withdrawal_fee', p_idempotency_key || ':fee:in');
  END IF;

  outcome := 'reserved';
  wallet_id := v_wallet.id;
  fee_amount := v_fee;
  new_balance := v_wallet.balance - p_amount - v_fee;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) TO service_role;

-- ── Refund: restore ONLY the provenance part of the split ────────
-- The 20261028 body with the single marked change (20261213): the
-- mark restored is the withdrawal's provenance_amount, not its full
-- amount. The float part needs no restore — the moment this row is
-- marked 'failed' it leaves the derived float-used sum, releasing
-- the reservation for the next withdrawal.
CREATE OR REPLACE FUNCTION public.refund_paypal_withdrawal(
  p_withdrawal_id uuid,
  p_failure_reason text DEFAULT NULL
)
RETURNS TABLE(
  outcome text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wd public.paypal_withdrawals;
  v_wallet public.wallets;
BEGIN
  SELECT * INTO v_wd FROM public.paypal_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;
  IF v_wd.id IS NULL THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wd.status = 'failed' AND v_wd.refunded_at IS NOT NULL THEN
    outcome := 'already_refunded';
    SELECT w.balance INTO new_balance FROM public.wallets w
    WHERE w.id = v_wd.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wd.status = 'completed' THEN
    -- Money reached the recipient; there is nothing to refund.
    -- (A later PayPal reversal is a reconciliation matter, not a
    -- wallet refund — see scheduled-reconciliation.)
    outcome := 'not_refundable';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets
  WHERE id = v_wd.wallet_id
  FOR UPDATE;
  IF v_wallet.id IS NULL OR v_wallet.status = 'closed' THEN
    -- The money stays reserved in the withdrawal row, retryable —
    -- never silently dropped.
    outcome := 'wallet_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.wallets
  SET balance = balance + v_wd.amount + v_wd.fee_amount, updated_at = now()
  WHERE id = v_wallet.id;

  -- Provenance (20261028, split-aware since 20261213): a refunded
  -- payout restores ONLY its provenance part to the mark — the
  -- float part was platform money, and its reservation releases
  -- through the derived sum when the row is marked failed below.
  -- Exactly-once is inherited from the refund guard above.
  IF v_wd.provenance_amount > 0 THEN
    PERFORM public.paypal_taint_credit(v_wd.user_id, v_wd.currency, v_wd.provenance_amount);
  END IF;

  -- The debit rows stop claiming the money is on its way.
  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE idempotency_key = v_wd.idempotency_key
    AND direction = 'outgoing';

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (v_wd.user_id, v_wallet.id, v_wd.amount + v_wd.fee_amount, v_wd.currency,
     'incoming', 'paypal', 'completed', 'BMaGlass Pay',
     'PayPal withdrawal refund — the payout could not be completed',
     v_wd.id::text, 'withdrawal_refund', v_wd.idempotency_key || ':refund');

  -- Take back the fee leg: the platform does not keep a fee on a
  -- withdrawal it could not deliver. The platform wallet may
  -- legitimately go negative here only if the fee was already
  -- withdrawn onwards — recorded, and visible to reconciliation.
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

  UPDATE public.paypal_withdrawals
  SET status = 'failed',
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      refunded_at = now(),
      updated_at = now()
  WHERE id = v_wd.id;

  outcome := 'refunded';
  SELECT w.balance INTO new_balance FROM public.wallets w
  WHERE w.id = v_wallet.id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_paypal_withdrawal(uuid, text) TO service_role;
