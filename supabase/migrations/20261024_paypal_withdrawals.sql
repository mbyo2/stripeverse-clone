-- PayPal withdrawals (payouts): a user's fiat exit back to PayPal.
--
-- STATE (2026-10-22): PayPal money only ever flowed IN (wallet
-- deposits, checkout payments). No payout path existed anywhere, so
-- a balance funded by PayPal could be spent inside the platform but
-- never leave as fiat. The CEO chose "PayPal withdrawals first" to
-- close that trust gap; this migration is the money core of it.
--
-- STATE MACHINE (public.paypal_withdrawals.status):
--   pending    — reserved (balance debited), payout not yet sent
--   processing — PayPal accepted the batch; outcome not final
--   completed  — PayPal reports the item SUCCEEDED (terminal)
--   failed     — PayPal rejected/failed/returned/denied it, or the
--                synchronous send was refused; the reservation is
--                refunded in full (amount + fee) exactly once and
--                refunded_at is set (terminal)
-- provider_status mirrors PayPal's last seen batch/item status for
-- support and reconciliation; it never drives money by itself.
--
-- PROVENANCE GUARDRAIL (CEO compliance decision, 2026-10-22): every
-- payout must be a user withdrawing their own traceable PayPal
-- money — never money "from nowhere". Enforced inside
-- reserve_paypal_withdrawal, atomically with the debit:
--
--   withdrawable(currency) =
--       SUM(completed PayPal-sourced credits in that currency)
--     - SUM(this user's paypal_withdrawals in that currency whose
--           status is NOT IN ('failed','refunded'))
--
--   Counted as PayPal-sourced credits — rows in public.transactions
--   with user_id = the caller, direction 'incoming', status
--   'completed', payment_method 'paypal', and metadata.kind IN:
--     - 'wallet_deposit'   — the user's own PayPal wallet deposits
--                            (wallet-deposit / complete_wallet_deposit)
--     - 'checkout_payment' — PayPal checkout payments the user
--                            received as a merchant (process-payment /
--                            complete_checkout_payment)
--   Both kinds credit a wallet ONLY from a PayPal capture the
--   platform verified against PayPal's own API, so both are equally
--   traceable. Payment-link settlements are wallet-to-wallet only
--   and never PayPal-sourced; subscription invoice rows are records,
--   not wallet credits — neither is counted.
--   The cap applies to the payout AMOUNT. The fee (below) is a
--   platform charge on top, not a payout of funds.
--
-- FEE: platform_settings.paypal_payout_fee_percent, DEFAULT 0 —
-- the CEO sets the commercial rate later; nothing here invents one.
-- When positive, fee = round(amount * rate / 100, 2), charged ON
-- TOP (recipient receives the exact amount; sender is debited
-- amount + fee) and credited to the platform operator's Main wallet
-- (earliest-created 'admin', created on demand — the split/send
-- pattern; skipped if the sender IS the platform or no admin
-- exists). PayPal's own payout fee is charged by PayPal to the
-- platform account and is NOT passed through these rows.
--
-- LIMITS: minimum 5.00 and a per-user per-currency daily cap of
-- 2,000.00 (major units), enforced in the reserve RPC. The same
-- numbers live in _shared/paypal-payout.ts (PAYOUT_MIN_AMOUNT /
-- PAYOUT_DAILY_LIMIT) for previews; the vitest suite pins the two
-- to each other.
--
-- MONEY RULES: all movement runs through the three SECURITY DEFINER
-- functions below, EXECUTE-granted to service_role only, called via
-- a dedicated service-role client that never forwards a caller JWT
-- (the protect_wallet_balance lesson). Ledger rows ride on
-- transactions.idempotency_key: <key> (amount out), <key>:fee /
-- <key>:fee:in (fee legs), <key>:refund (full refund in).

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS paypal_payout_fee_percent numeric NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.paypal_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  fee_amount numeric NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  recipient_email text NOT NULL,
  payout_batch_id text UNIQUE,
  payout_item_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  provider_status text,
  failure_reason text,
  idempotency_key text NOT NULL UNIQUE,
  refunded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paypal_withdrawals_user_created
  ON public.paypal_withdrawals (user_id, created_at DESC);

-- Supports the provenance sums in reserve_paypal_withdrawal.
CREATE INDEX IF NOT EXISTS idx_transactions_paypal_provenance
  ON public.transactions (user_id, currency)
  WHERE payment_method = 'paypal' AND direction = 'incoming';

ALTER TABLE public.paypal_withdrawals ENABLE ROW LEVEL SECURITY;

-- Owners may read their own withdrawal history. There are
-- deliberately NO authenticated write policies: every write goes
-- through the service-role RPCs / edge functions.
CREATE POLICY "Users can read their own PayPal withdrawals"
  ON public.paypal_withdrawals FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ── Reserve ──────────────────────────────────────────────────────────
-- Debits amount + fee from the caller's wallet and records the
-- withdrawal as 'pending', atomically. Outcomes:
--   reserved            — debit done; row returned
--   already_reserved    — same idempotency key replayed; the
--                         ORIGINAL row is returned, nothing re-debits
--   wallet_not_found / wallet_not_active / currency_mismatch
--   below_minimum / limit_exceeded (daily_remaining reports room left)
--   over_provenance_cap (provenance_available reports the true cap)
--   insufficient_balance
CREATE OR REPLACE FUNCTION public.reserve_paypal_withdrawal(
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
  daily_remaining numeric
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
  v_deposits numeric;
  v_withdrawn numeric;
  v_today numeric;
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

  -- ── Provenance guardrail ──────────────────────────────────────
  -- What PayPal paid IN to this user (verified captures only) minus
  -- what they have already taken OUT to PayPal (anything not
  -- failed/refunded still counts against them).
  SELECT COALESCE(SUM(t.amount), 0) INTO v_deposits
  FROM public.transactions t
  WHERE t.user_id = p_user_id
    AND t.direction = 'incoming'
    AND t.status = 'completed'
    AND t.payment_method = 'paypal'
    AND t.currency = v_currency
    AND t.metadata ->> 'kind' IN ('wallet_deposit', 'checkout_payment');
  SELECT COALESCE(SUM(w.amount), 0) INTO v_withdrawn
  FROM public.paypal_withdrawals w
  WHERE w.user_id = p_user_id
    AND w.currency = v_currency
    AND w.status NOT IN ('failed', 'refunded');
  provenance_available := GREATEST(0, v_deposits - v_withdrawn);
  IF p_amount > provenance_available THEN
    outcome := 'over_provenance_cap';
    wallet_id := v_wallet.id;
    RETURN NEXT;
    RETURN;
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
     status, idempotency_key)
  VALUES
    (p_user_id, v_wallet.id, p_amount, v_currency, v_fee,
     btrim(p_recipient_email), 'pending', p_idempotency_key)
  RETURNING id INTO withdrawal_id;

  UPDATE public.wallets
  SET balance = balance - p_amount - v_fee, updated_at = now()
  WHERE id = v_wallet.id;

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

-- ── Refund ───────────────────────────────────────────────────────────
-- Returns amount + fee to the source wallet and marks the
-- withdrawal failed, exactly once: the row lock + the refunded_at
-- guard mean replays (status poll racing the webhook) report
-- 'already_refunded' and move nothing.
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

-- ── Complete ─────────────────────────────────────────────────────────
-- Marks a withdrawal completed when PayPal reports the item
-- SUCCEEDED. Terminal-state guard makes replays no-ops.
CREATE OR REPLACE FUNCTION public.complete_paypal_withdrawal(
  p_withdrawal_id uuid,
  p_provider_status text DEFAULT NULL
)
RETURNS TABLE(
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wd public.paypal_withdrawals;
BEGIN
  SELECT * INTO v_wd FROM public.paypal_withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;
  IF v_wd.id IS NULL THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wd.status = 'completed' THEN
    outcome := 'already_completed';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wd.status = 'failed' THEN
    -- Already refunded. A success claim arriving now contradicts
    -- the refund — surface it, change nothing.
    outcome := 'already_failed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.paypal_withdrawals
  SET status = 'completed',
      provider_status = COALESCE(p_provider_status, provider_status),
      completed_at = now(),
      updated_at = now()
  WHERE id = v_wd.id;

  UPDATE public.transactions
  SET status = 'completed', updated_at = now()
  WHERE idempotency_key = v_wd.idempotency_key
    AND direction = 'outgoing';

  outcome := 'completed';
  RETURN NEXT;
END;
$$;

-- Only the service role (the paypal-payout / paypal-webhook edge
-- functions) may execute these — the same grant pattern as
-- execute_send_money_transfer and complete_wallet_deposit.
REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reserve_paypal_withdrawal(uuid, uuid, numeric, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.refund_paypal_withdrawal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.refund_paypal_withdrawal(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.complete_paypal_withdrawal(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_paypal_withdrawal(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_paypal_withdrawal(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_paypal_withdrawal(uuid, text) TO service_role;
