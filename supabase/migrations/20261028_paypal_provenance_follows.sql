-- PayPal provenance FOLLOWS THE MONEY (CEO decision 2026-10-23,
-- reversing the strict per-user rule shipped hours earlier in
-- 20261024_paypal_withdrawals.sql).
--
-- THE OLD RULE: reserve_paypal_withdrawal computed the cap from the
-- ledger — a user could withdraw to PayPal only what PayPal had paid
-- INTO THEIR OWN wallets (their deposits + checkout payments they
-- received), minus their non-failed withdrawals. Money received
-- from ANOTHER USER (a send, a transfer, a split leg) never counted,
-- even when it was the very same PayPal money one hop later.
--
-- THE NEW RULE: PayPal-sourced money is a MARKED PORTION of a user's
-- balance, tracked per (user, currency) in
-- public.paypal_provenance_balances ("the counter", column
-- sourced_amount). The semantics, enforced by the taint helpers and
-- the hooks below:
--   - CREATED only by real PayPal captures: a verified wallet
--     deposit (complete_wallet_deposit) or a verified checkout
--     payment (complete_checkout_payment) credits the counter by the
--     captured amount. Nothing else in the platform creates a mark.
--   - SPENT FIRST: whenever marked money moves, the marked portion
--     moves first — paypal_taint_move(sender, recipient, ...) moves
--     LEAST(amount, sender's mark). Sends, transfers and payment-
--     link settlements carry the mark to the recipient; debits to
--     non-user destinations (billers, the BTC float, external
--     rails) destroy the moved portion of the mark.
--   - CONSUMED by withdrawing: reserve_paypal_withdrawal reads the
--     counter (locked) as the cap and decrements it by the payout
--     AMOUNT (never the fee — the fee is a platform charge, not the
--     user's PayPal money leaving). refund_paypal_withdrawal
--     restores it in full, exactly once (the refund's own guard).
--     complete_paypal_withdrawal changes nothing.
--   - CONVERTED proportionally: a currency conversion carries the
--     marked fraction across currencies at the conversion's own
--     effective rate.
--   PLATFORM INVARIANT: because marks are created only by captures
--   and consumed by payouts 1:1 (moves conserve them, conversions
--   re-denominate them at the trade's own rate), the total ever paid
--   out to PayPal can never exceed the total PayPal paid in.
--
-- SEED: existing users keep exactly the withdrawal rights the old
-- rule gave them — the counter is backfilled below from the old
-- computed definition (completed PayPal wallet deposits + checkout
-- payments, minus non-failed withdrawals, per user/currency,
-- floored at 0).
--
-- REWRITE FIDELITY: every CREATE OR REPLACE below is its current
-- repo definition with ONLY the marked provenance hooks added (the
-- 20261024 reserve rewrite additionally swaps its ledger-sum cap for
-- the counter read). No amounts, limits, fees, ledger rows or
-- outcomes change anywhere else.

-- ── The provenance counter ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.paypal_provenance_balances (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  sourced_amount numeric NOT NULL DEFAULT 0 CHECK (sourced_amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, currency)
);

ALTER TABLE public.paypal_provenance_balances ENABLE ROW LEVEL SECURITY;

-- Owners may read their own counter (the withdraw form shows it).
-- There are deliberately NO authenticated write policies: every
-- write happens inside the SECURITY DEFINER helpers/RPCs below.
CREATE POLICY "Users can read their own PayPal provenance"
  ON public.paypal_provenance_balances FOR SELECT TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT ON public.paypal_provenance_balances TO authenticated;

-- ── Taint helpers ────────────────────────────────────────────────────
-- The only writers of the counter. All three are SECURITY DEFINER
-- with a locked search_path and EXECUTE granted to service_role
-- only; they run inside the caller's transaction (every hook below
-- is in the same transaction as the money it marks).

-- Credit fresh PayPal-sourced money to a user (verified captures
-- only). Returns the user's new counter total for the currency.
CREATE OR REPLACE FUNCTION public.paypal_taint_credit(
  p_user_id uuid,
  p_currency text,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_total numeric := 0;
BEGIN
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR length(v_currency) <> 3 THEN
    RETURN 0;
  END IF;
  INSERT INTO public.paypal_provenance_balances (user_id, currency, sourced_amount)
  VALUES (p_user_id, v_currency, p_amount)
  ON CONFLICT (user_id, currency) DO UPDATE
    SET sourced_amount = public.paypal_provenance_balances.sourced_amount
                         + EXCLUDED.sourced_amount,
        updated_at = now()
  RETURNING sourced_amount INTO v_total;
  RETURN v_total;
END;
$$;

-- Remove mark spent-first (money leaving to a non-user destination,
-- or the first half of a move). Returns how much mark was actually
-- removed: LEAST(p_amount, the user's mark).
CREATE OR REPLACE FUNCTION public.paypal_taint_debit(
  p_user_id uuid,
  p_currency text,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_current numeric := 0;
  v_moved numeric := 0;
BEGIN
  IF p_user_id IS NULL OR p_amount IS NULL OR p_amount <= 0
     OR length(v_currency) <> 3 THEN
    RETURN 0;
  END IF;
  INSERT INTO public.paypal_provenance_balances (user_id, currency, sourced_amount)
  VALUES (p_user_id, v_currency, 0)
  ON CONFLICT (user_id, currency) DO NOTHING;
  SELECT b.sourced_amount INTO v_current
  FROM public.paypal_provenance_balances b
  WHERE b.user_id = p_user_id AND b.currency = v_currency
  FOR UPDATE;
  v_moved := LEAST(p_amount, COALESCE(v_current, 0));
  IF v_moved > 0 THEN
    UPDATE public.paypal_provenance_balances
    SET sourced_amount = sourced_amount - v_moved, updated_at = now()
    WHERE user_id = p_user_id AND currency = v_currency;
  END IF;
  RETURN v_moved;
END;
$$;

-- Move the mark with the money, spent-first: the sender loses
-- LEAST(p_amount, their mark); a real user recipient gains exactly
-- that much; a NULL recipient destroys it (the money left to a
-- non-user destination). Returns how much mark moved.
CREATE OR REPLACE FUNCTION public.paypal_taint_move(
  p_from_user uuid,
  p_to_user uuid,
  p_currency text,
  p_amount numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_moved numeric := 0;
BEGIN
  IF p_from_user IS NULL OR p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;
  v_moved := public.paypal_taint_debit(p_from_user, p_currency, p_amount);
  IF v_moved > 0 AND p_to_user IS NOT NULL THEN
    PERFORM public.paypal_taint_credit(p_to_user, p_currency, v_moved);
  END IF;
  RETURN v_moved;
END;
$$;

REVOKE ALL ON FUNCTION public.paypal_taint_credit(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypal_taint_credit(uuid, text, numeric) FROM authenticated;
REVOKE ALL ON FUNCTION public.paypal_taint_credit(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.paypal_taint_credit(uuid, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.paypal_taint_debit(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypal_taint_debit(uuid, text, numeric) FROM authenticated;
REVOKE ALL ON FUNCTION public.paypal_taint_debit(uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.paypal_taint_debit(uuid, text, numeric) TO service_role;

REVOKE ALL ON FUNCTION public.paypal_taint_move(uuid, uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.paypal_taint_move(uuid, uuid, text, numeric) FROM authenticated;
REVOKE ALL ON FUNCTION public.paypal_taint_move(uuid, uuid, text, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.paypal_taint_move(uuid, uuid, text, numeric) TO service_role;

-- ── Seed: backfill from the OLD computed definition ──────────────────
-- Completed PayPal-sourced credits (wallet deposits + checkout
-- payments, the exact rows the 20261024 cap counted) minus the
-- user's PayPal withdrawals that are not failed/refunded, per
-- user/currency, floored at 0. After this, the counter and the old
-- rule agree to the cent for every existing user.
INSERT INTO public.paypal_provenance_balances (user_id, currency, sourced_amount)
SELECT pairs.user_id, pairs.currency,
       GREATEST(0, COALESCE(c.credits, 0) - COALESCE(w.withdrawn, 0))
FROM (
  SELECT user_id, upper(currency) AS currency
  FROM public.transactions
  WHERE payment_method = 'paypal' AND direction = 'incoming'
    AND status = 'completed'
    AND metadata ->> 'kind' IN ('wallet_deposit', 'checkout_payment')
  UNION
  SELECT user_id, upper(currency)
  FROM public.paypal_withdrawals
) pairs
LEFT JOIN (
  SELECT user_id, upper(currency) AS currency, SUM(amount) AS credits
  FROM public.transactions
  WHERE payment_method = 'paypal' AND direction = 'incoming'
    AND status = 'completed'
    AND metadata ->> 'kind' IN ('wallet_deposit', 'checkout_payment')
  GROUP BY user_id, upper(currency)
) c ON c.user_id = pairs.user_id AND c.currency = pairs.currency
LEFT JOIN (
  SELECT user_id, upper(currency) AS currency, SUM(amount) AS withdrawn
  FROM public.paypal_withdrawals
  WHERE status NOT IN ('failed', 'refunded')
  GROUP BY user_id, upper(currency)
) w ON w.user_id = pairs.user_id AND w.currency = pairs.currency
WHERE GREATEST(0, COALESCE(c.credits, 0) - COALESCE(w.withdrawn, 0)) > 0
ON CONFLICT (user_id, currency) DO UPDATE
  SET sourced_amount = EXCLUDED.sourced_amount, updated_at = now();

-- ── Withdrawals: the counter replaces the ledger-sum cap ──────
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
  v_sourced numeric;
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

  -- ── Provenance: the counter is the cap (20261028) ─────────────
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

  -- Consume the mark for the payout amount (never the fee: the fee
  -- is a platform charge, not the user's PayPal money leaving).
  UPDATE public.paypal_provenance_balances
  SET sourced_amount = sourced_amount - p_amount, updated_at = now()
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

  -- Provenance (20261028): a refunded payout restores the mark in
  -- full — the money is back in the wallet and may be withdrawn
  -- again. Exactly-once is inherited from the refund guard above.
  PERFORM public.paypal_taint_credit(v_wd.user_id, v_wd.currency, v_wd.amount);

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

-- ── Send Money: the mark moves with the send ──────────────────
CREATE OR REPLACE FUNCTION public.execute_send_money_transfer(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference_id text,
  p_idempotency_key text,
  p_description text DEFAULT NULL::text,
  p_recipient_name text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'wallet'::text
)
RETURNS TABLE(transaction_id uuid, new_sender_balance numeric, fee_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender_wallet_id UUID;
  v_sender_balance NUMERIC;
  v_recipient_wallet_id UUID;
  v_existing_id UUID;
  v_tx_id UUID;
  -- Send-fee state.
  v_fee_rate numeric;             -- platform_settings.send_money_fee_percent
  v_fee numeric := 0;             -- fee actually charged (0 when the leg is skipped)
  v_platform_user uuid;           -- platform operator (earliest-created admin)
  v_platform_wallet_id UUID;
  v_platform_wallet_status text;
  v_sender_name text;
  v_fee_description text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Recipient is required';
  END IF;
  IF p_to_user_id = p_from_user_id THEN
    RAISE EXCEPTION 'Cannot transfer to yourself';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a replay returns the original send (and its fee).
  SELECT t.uuid_id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key
    AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT t.uuid_id, w.balance INTO v_tx_id, v_sender_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.user_id = t.user_id AND w.currency = t.currency
    WHERE t.uuid_id = v_existing_id
      AND w.account_id IS NULL;
    SELECT COALESCE(SUM(t.amount), 0) INTO v_fee
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':fee'
      AND t.direction = 'outgoing';
    transaction_id := v_tx_id;
    new_sender_balance := v_sender_balance;
    fee_amount := v_fee;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── Send fee ──────────────────────────────────────────────────────
  -- Computed BEFORE the balance check so the check covers amount + fee.
  -- Resolving the platform leg first is what decides whether a fee is
  -- charged at all (skipped legs leave v_fee at 0).
  v_fee_rate := COALESCE(
    (SELECT send_money_fee_percent FROM public.platform_settings WHERE id),
    2.5);
  IF v_fee_rate > 0 THEN
    v_fee := round(p_amount * v_fee_rate / 100, 2);
  END IF;

  IF v_fee > 0 THEN
    -- The platform operator: earliest-created admin.
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;

    IF v_platform_user IS NULL OR v_platform_user = p_from_user_id THEN
      -- No platform operator yet, or the sender IS the platform: no fee.
      v_fee := 0;
    ELSE
      -- Platform's Main wallet in the send currency, created on
      -- demand. A closed wallet cannot receive — the leg is skipped;
      -- frozen may receive.
      SELECT w.id, w.status INTO v_platform_wallet_id, v_platform_wallet_status
      FROM public.wallets w
      WHERE w.user_id = v_platform_user AND w.currency = p_currency
        AND w.account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, currency, balance, status)
        VALUES (v_platform_user, p_currency, 0, 'active')
        RETURNING id INTO v_platform_wallet_id;
        v_platform_wallet_status := 'active';
      END IF;
      IF v_platform_wallet_status = 'closed' THEN
        v_fee := 0;
      END IF;
    END IF;
  END IF;

  -- Sender: the Main wallet for this currency (account_id IS NULL) —
  -- the same scope rule as execute_atomic_transfer.
  SELECT w.id, w.balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets w
  WHERE w.user_id = p_from_user_id AND w.currency = p_currency
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_sender_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found for currency %', p_currency;
  END IF;

  -- The fee rides ON TOP: the sender must cover amount + fee.
  IF v_sender_balance < p_amount + v_fee THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %',
      v_sender_balance, p_amount + v_fee;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_sender_wallet_id;

  -- Recipient: their Main wallet for this currency, created if absent.
  SELECT w.id INTO v_recipient_wallet_id
  FROM public.wallets w
  WHERE w.user_id = p_to_user_id AND w.currency = p_currency
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_recipient_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (p_to_user_id, p_currency, 0, 'active')
    RETURNING id INTO v_recipient_wallet_id;
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_recipient_wallet_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_to_user_id, v_recipient_wallet_id, p_amount, p_currency, 'incoming',
     p_payment_method, 'completed', p_description, p_reference_id,
     'transfer', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_tx_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_from_user_id, v_sender_wallet_id, p_amount, p_currency, 'outgoing',
     p_payment_method, 'completed', p_recipient_name, p_description,
     p_reference_id, 'transfer', p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  -- ── Fee movement: sender Main wallet → platform Main wallet ──────
  IF v_fee > 0 THEN
    -- Sender's display name for the platform's incoming row (may be NULL).
    SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    INTO v_sender_name
    FROM public.profiles p
    WHERE p.id = p_from_user_id;

    v_fee_description := 'Send fee for transfer to '
      || COALESCE(p_recipient_name, 'recipient')
      || CASE WHEN p_reference_id IS NOT NULL
              THEN ' (ref ' || p_reference_id || ')' ELSE '' END;

    UPDATE public.wallets
    SET balance = balance - v_fee, updated_at = now()
    WHERE id = v_sender_wallet_id;
    UPDATE public.wallets
    SET balance = balance + v_fee, updated_at = now()
    WHERE id = v_platform_wallet_id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_from_user_id, v_sender_wallet_id, v_fee, p_currency, 'outgoing',
       p_payment_method, 'completed', 'BMaGlass Pay', v_fee_description,
       p_reference_id, 'transfer_fee', p_idempotency_key || ':fee');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_platform_user, v_platform_wallet_id, v_fee, p_currency, 'incoming',
       p_payment_method, 'completed', v_sender_name, v_fee_description,
       p_reference_id, 'transfer_fee', p_idempotency_key || ':fee:in');
  END IF;

  -- ── Provenance (20261028): the mark follows the money ────────
  -- PayPal-sourced money is spent first: up to the full amount of
  -- the sender's mark moves to the recipient with the send. The fee
  -- leg carries no mark (a platform charge, not the user's PayPal
  -- money). The idempotent-replay return above never reaches here,
  -- so a replayed send moves no mark twice.
  PERFORM public.paypal_taint_move(
    p_from_user_id, p_to_user_id, p_currency, p_amount);

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount - v_fee;
  fee_amount := v_fee;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) TO service_role;

-- ── Transfer: the mark moves with the transfer ────────────────
CREATE OR REPLACE FUNCTION public.execute_transfer_with_fee(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference_id text,
  p_idempotency_key text,
  p_description text DEFAULT NULL::text,
  p_recipient_name text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'wallet'::text
)
RETURNS TABLE(transaction_id uuid, new_sender_balance numeric, fee_amount numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender_wallet_id UUID;
  v_sender_balance NUMERIC;
  v_recipient_wallet_id UUID;
  v_existing_id UUID;
  v_tx_id UUID;
  -- Transfer-fee state.
  v_fee_rate numeric;             -- platform_settings.transfer_fee_percent
  v_fee numeric := 0;             -- fee actually charged (0 when the leg is skipped)
  v_platform_user uuid;           -- platform operator (earliest-created admin)
  v_platform_wallet_id UUID;
  v_platform_wallet_status text;
  v_sender_name text;
  v_fee_description text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_to_user_id IS NULL THEN
    RAISE EXCEPTION 'Recipient is required';
  END IF;
  IF p_to_user_id = p_from_user_id THEN
    RAISE EXCEPTION 'Cannot transfer to yourself';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a replay returns the original transfer (and its fee).
  SELECT t.uuid_id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key
    AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT t.uuid_id, w.balance INTO v_tx_id, v_sender_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.user_id = t.user_id AND w.currency = t.currency
    WHERE t.uuid_id = v_existing_id
      AND w.account_id IS NULL;
    SELECT COALESCE(SUM(t.amount), 0) INTO v_fee
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':fee'
      AND t.direction = 'outgoing';
    transaction_id := v_tx_id;
    new_sender_balance := v_sender_balance;
    fee_amount := v_fee;
    RETURN NEXT;
    RETURN;
  END IF;

  -- ── Transfer fee ──────────────────────────────────────────────────
  -- Computed BEFORE the balance check so the check covers amount + fee.
  -- Resolving the platform leg first is what decides whether a fee is
  -- charged at all (skipped legs leave v_fee at 0).
  v_fee_rate := COALESCE(
    (SELECT transfer_fee_percent FROM public.platform_settings WHERE id),
    1.5);
  IF v_fee_rate > 0 THEN
    v_fee := round(p_amount * v_fee_rate / 100, 2);
  END IF;

  IF v_fee > 0 THEN
    -- The platform operator: earliest-created admin.
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;

    IF v_platform_user IS NULL OR v_platform_user = p_from_user_id THEN
      -- No platform operator yet, or the sender IS the platform: no fee.
      v_fee := 0;
    ELSE
      -- Platform's Main wallet in the transfer currency, created on
      -- demand. A closed wallet cannot receive — the leg is skipped;
      -- frozen may receive.
      SELECT w.id, w.status INTO v_platform_wallet_id, v_platform_wallet_status
      FROM public.wallets w
      WHERE w.user_id = v_platform_user AND w.currency = p_currency
        AND w.account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, currency, balance, status)
        VALUES (v_platform_user, p_currency, 0, 'active')
        RETURNING id INTO v_platform_wallet_id;
        v_platform_wallet_status := 'active';
      END IF;
      IF v_platform_wallet_status = 'closed' THEN
        v_fee := 0;
      END IF;
    END IF;
  END IF;

  -- Sender: the Main wallet for this currency (account_id IS NULL) —
  -- the same scope rule as execute_atomic_transfer.
  SELECT w.id, w.balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets w
  WHERE w.user_id = p_from_user_id AND w.currency = p_currency
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_sender_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found for currency %', p_currency;
  END IF;

  -- The fee rides ON TOP: the sender must cover amount + fee.
  IF v_sender_balance < p_amount + v_fee THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %',
      v_sender_balance, p_amount + v_fee;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_sender_wallet_id;

  -- Recipient: their Main wallet for this currency, created if absent.
  SELECT w.id INTO v_recipient_wallet_id
  FROM public.wallets w
  WHERE w.user_id = p_to_user_id AND w.currency = p_currency
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_recipient_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (p_to_user_id, p_currency, 0, 'active')
    RETURNING id INTO v_recipient_wallet_id;
  END IF;

  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_recipient_wallet_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_to_user_id, v_recipient_wallet_id, p_amount, p_currency, 'incoming',
     p_payment_method, 'completed', p_description, p_reference_id,
     'transfer', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_tx_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_from_user_id, v_sender_wallet_id, p_amount, p_currency, 'outgoing',
     p_payment_method, 'completed', p_recipient_name, p_description,
     p_reference_id, 'transfer', p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  -- ── Fee movement: sender Main wallet → platform Main wallet ──────
  IF v_fee > 0 THEN
    -- Sender's display name for the platform's incoming row (may be NULL).
    SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    INTO v_sender_name
    FROM public.profiles p
    WHERE p.id = p_from_user_id;

    v_fee_description := 'Transfer fee for transfer to '
      || COALESCE(p_recipient_name, 'recipient')
      || CASE WHEN p_reference_id IS NOT NULL
              THEN ' (ref ' || p_reference_id || ')' ELSE '' END;

    UPDATE public.wallets
    SET balance = balance - v_fee, updated_at = now()
    WHERE id = v_sender_wallet_id;
    UPDATE public.wallets
    SET balance = balance + v_fee, updated_at = now()
    WHERE id = v_platform_wallet_id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_from_user_id, v_sender_wallet_id, v_fee, p_currency, 'outgoing',
       p_payment_method, 'completed', 'BMaGlass Pay', v_fee_description,
       p_reference_id, 'transfer_fee', p_idempotency_key || ':fee');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_platform_user, v_platform_wallet_id, v_fee, p_currency, 'incoming',
       p_payment_method, 'completed', v_sender_name, v_fee_description,
       p_reference_id, 'transfer_fee', p_idempotency_key || ':fee:in');
  END IF;

  -- ── Provenance (20261028): the mark follows the money ────────
  -- Same rule as Send Money: the sender's PayPal-sourced mark moves
  -- spent-first with the transfer amount; the fee leg carries none.
  -- The idempotent-replay return above never reaches here.
  PERFORM public.paypal_taint_move(
    p_from_user_id, p_to_user_id, p_currency, p_amount);

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount - v_fee;
  fee_amount := v_fee;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_transfer_with_fee(uuid, uuid, numeric, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_transfer_with_fee(uuid, uuid, numeric, text, text, text, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_transfer_with_fee(uuid, uuid, numeric, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_transfer_with_fee(uuid, uuid, numeric, text, text, text, text, text, text) TO service_role;

-- ── Generic atomic transfer: the mark moves or is destroyed ──
CREATE OR REPLACE FUNCTION public.execute_atomic_transfer(
  p_from_user_id uuid,
  p_to_user_id uuid,
  p_amount numeric,
  p_currency text,
  p_reference_type text,
  p_reference_id text,
  p_idempotency_key text,
  p_description text DEFAULT NULL::text,
  p_recipient_name text DEFAULT NULL::text,
  p_payment_method text DEFAULT 'wallet'::text
)
RETURNS TABLE(transaction_id uuid, new_sender_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sender_wallet_id UUID;
  v_sender_balance NUMERIC;
  v_recipient_wallet_id UUID;
  v_existing_id UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.uuid_id INTO v_existing_id
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      SELECT t.uuid_id, w.balance INTO v_tx_id, v_sender_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.user_id = t.user_id AND w.currency = t.currency
      WHERE t.uuid_id = v_existing_id
        AND w.account_id IS NULL;
      transaction_id := v_tx_id;
      new_sender_balance := v_sender_balance;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Sender: the Main wallet for this currency (account_id IS NULL).
  SELECT w.id, w.balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets w
  WHERE w.user_id = p_from_user_id AND w.currency = p_currency
    AND w.account_id IS NULL
  FOR UPDATE;

  IF v_sender_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found for currency %', p_currency;
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_sender_balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_sender_wallet_id;

  IF p_to_user_id IS NOT NULL THEN
    -- Recipient: their Main wallet for this currency, created if absent
    -- (a fresh wallet row defaults account_id to NULL, i.e. Main).
    SELECT w.id INTO v_recipient_wallet_id
    FROM public.wallets w
    WHERE w.user_id = p_to_user_id AND w.currency = p_currency
      AND w.account_id IS NULL
    FOR UPDATE;

    IF v_recipient_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, currency, balance, status)
      VALUES (p_to_user_id, p_currency, 0, 'active')
      RETURNING id INTO v_recipient_wallet_id;
    END IF;

    UPDATE public.wallets
    SET balance = balance + p_amount, updated_at = now()
    WHERE id = v_recipient_wallet_id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, description, reference, category, idempotency_key)
    VALUES
      (p_to_user_id, v_recipient_wallet_id, p_amount, p_currency, 'incoming',
       p_payment_method, 'completed', p_description, p_reference_id,
       p_reference_type, p_idempotency_key || ':in')
    RETURNING uuid_id INTO v_tx_id;
  END IF;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_from_user_id, v_sender_wallet_id, p_amount, p_currency, 'outgoing',
     p_payment_method, 'completed', p_recipient_name, p_description,
     p_reference_id, p_reference_type, p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  -- Provenance (20261028): the mark follows the money on this
  -- generic path too — spent-first to a real user recipient; when
  -- p_to_user_id is NULL the money leaves to a non-user destination
  -- (billers, external rails) and the moved mark is destroyed. The
  -- idempotent-replay return above never reaches here.
  PERFORM public.paypal_taint_move(
    p_from_user_id, p_to_user_id, p_currency, p_amount);

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) TO service_role;

-- ── Payment-link settlement: the mark follows the payment ────
CREATE OR REPLACE FUNCTION public.execute_payment_link_settlement(
  p_link_id uuid,
  p_payer_user_id uuid,           -- NULL = external (gateway) payment
  p_amount numeric,
  p_idempotency_key text,
  p_payment_method text DEFAULT 'wallet',
  p_description text DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  owner_transaction_id uuid,
  owner_new_balance numeric,
  payer_new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_link public.payment_links;
  v_account public.accounts;
  v_owner_wallet public.wallets;
  v_payer_wallet public.wallets;
  v_existing_in uuid;
  v_existing_out uuid;
  v_owner_tx uuid;
  v_payer_tx uuid;
  -- Platform fee state.
  v_fee_rate numeric;             -- platform_settings.split_platform_fee_percent
  v_platform_fee numeric := 0;    -- fee actually taken (0 when the leg is skipped)
  v_platform_user uuid;           -- platform operator (earliest-created admin)
  v_platform_wallet public.wallets;
  -- Split execution state.
  v_owner_balance numeric;        -- owner's balance after the gross credit
  v_remaining numeric;            -- undiverted remainder of the payment
  v_rule record;
  v_recipient_user uuid;
  v_recipient_wallet public.wallets;
  v_leg numeric;
  v_owner_name text;
  -- Provenance distribution state (20261028): the settlement's user
  -- legs are collected as they execute and the payer's mark (or the
  -- fresh PayPal money) is distributed over them at the end.
  v_taint_users uuid[] := '{}';
  v_taint_amounts numeric[] := '{}';
  v_taint_shares numeric[] := '{}';
  v_taint_total numeric := 0;
  v_taint_share numeric := 0;
  v_taint_assigned numeric := 0;
  v_largest_idx integer := 1;
BEGIN
  -- A live user session may only ever act as itself (defence in depth;
  -- the normal path is a service_role call with no session at all).
  IF auth.uid() IS NOT NULL AND p_payer_user_id IS NOT NULL
     AND auth.uid() <> p_payer_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a settled link payment always leaves exactly one owner
  -- incoming row keyed <key>:in. A replay returns the original result.
  SELECT t.uuid_id INTO v_existing_in
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key || ':in'
    AND t.direction = 'incoming'
  LIMIT 1;
  IF v_existing_in IS NOT NULL THEN
    SELECT t.uuid_id INTO v_existing_out
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    SELECT t.uuid_id, w.balance INTO v_owner_tx, owner_new_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.uuid_id = v_existing_in;
    owner_transaction_id := v_owner_tx;
    transaction_id := COALESCE(v_existing_out, v_owner_tx);
    IF v_existing_out IS NOT NULL THEN
      SELECT w.balance INTO payer_new_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.id = t.wallet_id
      WHERE t.uuid_id = v_existing_out;
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock the link row: serializes settlements per link (counters, cap,
  -- and on-demand wallet creation stay race-free).
  SELECT * INTO v_link FROM public.payment_links
  WHERE id = p_link_id FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;
  IF v_link.status <> 'active' THEN
    RAISE EXCEPTION 'Payment link is not active';
  END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RAISE EXCEPTION 'Payment link has expired';
  END IF;
  IF v_link.max_payments IS NOT NULL
     AND COALESCE(v_link.payment_count, 0) >= v_link.max_payments THEN
    RAISE EXCEPTION 'Payment link has reached its payment limit';
  END IF;
  IF v_link.amount IS NOT NULL AND p_amount <> v_link.amount THEN
    RAISE EXCEPTION 'This link requires payment of exactly % %',
      v_link.amount, v_link.currency;
  END IF;
  IF p_payer_user_id IS NOT NULL AND p_payer_user_id = v_link.user_id THEN
    RAISE EXCEPTION 'The link owner cannot pay their own payment link';
  END IF;

  -- Settlement target account (NULL = Main). Must be the owner's own
  -- account and must not be closed (frozen may receive, never send).
  IF v_link.account_id IS NOT NULL THEN
    SELECT * INTO v_account FROM public.accounts WHERE id = v_link.account_id;
    IF v_account.id IS NULL OR v_account.user_id <> v_link.user_id THEN
      RAISE EXCEPTION 'Settlement account is invalid for this link';
    END IF;
    IF v_account.status = 'closed' THEN
      RAISE EXCEPTION 'Settlement account is closed and cannot receive payments';
    END IF;
  END IF;

  -- Owner's wallet for (target account, link currency) — created on
  -- demand, as execute_atomic_transfer does for transfer recipients.
  SELECT * INTO v_owner_wallet FROM public.wallets
  WHERE user_id = v_link.user_id
    AND currency = v_link.currency
    AND account_id IS NOT DISTINCT FROM v_link.account_id
  FOR UPDATE;
  IF v_owner_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
    VALUES (v_link.user_id, v_link.account_id, v_link.currency, 0, 'active')
    RETURNING * INTO v_owner_wallet;
  END IF;
  IF v_owner_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Settlement wallet is not active';
  END IF;

  -- Wallet payment: debit the payer's Main wallet in the link currency.
  IF p_payer_user_id IS NOT NULL THEN
    SELECT * INTO v_payer_wallet FROM public.wallets
    WHERE user_id = p_payer_user_id
      AND currency = v_link.currency
      AND account_id IS NULL
    FOR UPDATE;
    IF v_payer_wallet.id IS NULL THEN
      RAISE EXCEPTION 'No % wallet found for the payer', v_link.currency;
    END IF;
    IF v_payer_wallet.status <> 'active' THEN
      RAISE EXCEPTION 'Payer wallet is not active';
    END IF;
    IF v_payer_wallet.balance < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance: have %, need %',
        v_payer_wallet.balance, p_amount;
    END IF;

    UPDATE public.wallets
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_payer_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (p_payer_user_id, v_payer_wallet.id, p_amount, v_link.currency,
       'outgoing', p_payment_method, 'completed', v_link.title,
       COALESCE(p_description, 'Payment link: ' || v_link.title),
       'link:' || v_link.id::text, 'payment_link', p_idempotency_key)
    RETURNING uuid_id INTO v_payer_tx;
    payer_new_balance := v_payer_wallet.balance - p_amount;
  END IF;

  -- Credit the owner and ledger their leg.
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_owner_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_link.user_id, v_owner_wallet.id, p_amount, v_link.currency,
     'incoming', p_payment_method, 'completed',
     COALESCE(p_description, 'Payment link: ' || v_link.title),
     'link:' || v_link.id::text, 'payment_link', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_owner_tx;

  -- Counters accumulate server-side, in the same transaction.
  UPDATE public.payment_links
  SET payment_count = COALESCE(payment_count, 0) + 1,
      total_collected = COALESCE(total_collected, 0) + p_amount,
      updated_at = now()
  WHERE id = v_link.id;

  v_owner_balance := v_owner_wallet.balance + p_amount;

  -- Owner's display name for the fee and split ledger rows (may be NULL).
  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_owner_name
  FROM public.profiles p
  WHERE p.id = v_link.user_id;

  -- ── Platform fee ────────────────────────────────────────────────────
  -- BMaGlass Pay's cut of this settlement, taken FIRST — before the
  -- owner's split rules run. Skipped legs leave v_platform_fee at 0
  -- and the share stays with the owner.
  v_fee_rate := COALESCE(
    (SELECT split_platform_fee_percent FROM public.platform_settings WHERE id),
    2.5);
  IF v_fee_rate > 0 THEN
    v_platform_fee := LEAST(round(p_amount * v_fee_rate / 100, 2), p_amount);
  END IF;

  IF v_platform_fee > 0 THEN
    -- The platform operator: earliest-created admin.
    SELECT ur.user_id INTO v_platform_user
    FROM public.user_roles ur
    WHERE ur.role = 'admin'
    ORDER BY ur.created_at, ur.user_id
    LIMIT 1;

    IF v_platform_user IS NULL OR v_platform_user = v_link.user_id THEN
      -- No platform operator yet, or the owner IS the platform: no fee.
      v_platform_fee := 0;
    ELSE
      -- Platform's Main wallet in the settlement currency, created on
      -- demand. A closed wallet cannot receive — the leg is skipped;
      -- frozen may receive.
      SELECT * INTO v_platform_wallet FROM public.wallets
      WHERE user_id = v_platform_user
        AND currency = v_link.currency
        AND account_id IS NULL
      FOR UPDATE;
      IF v_platform_wallet.id IS NULL THEN
        INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
        VALUES (v_platform_user, NULL, v_link.currency, 0, 'active')
        RETURNING * INTO v_platform_wallet;
      END IF;

      IF v_platform_wallet.status = 'closed' THEN
        v_platform_fee := 0;
      ELSE
        -- Move the fee: owner settlement wallet → platform Main wallet.
        UPDATE public.wallets
        SET balance = balance - v_platform_fee, updated_at = now()
        WHERE id = v_owner_wallet.id;
        UPDATE public.wallets
        SET balance = balance + v_platform_fee, updated_at = now()
        WHERE id = v_platform_wallet.id;

        INSERT INTO public.transactions
          (user_id, wallet_id, amount, currency, direction, payment_method,
           status, recipient_name, description, reference, category, idempotency_key)
        VALUES
          (v_link.user_id, v_owner_wallet.id, v_platform_fee, v_link.currency,
           'outgoing', p_payment_method, 'completed', 'BMaGlass Pay',
           'Platform fee — payment link: ' || v_link.title,
           'link:' || v_link.id::text, 'platform_fee',
           p_idempotency_key || ':platform_fee:out');

        INSERT INTO public.transactions
          (user_id, wallet_id, amount, currency, direction, payment_method,
           status, recipient_name, description, reference, category, idempotency_key)
        VALUES
          (v_platform_user, v_platform_wallet.id, v_platform_fee, v_link.currency,
           'incoming', p_payment_method, 'completed', v_owner_name,
           'Platform fee — payment link: ' || v_link.title,
           'link:' || v_link.id::text, 'platform_fee',
           p_idempotency_key || ':platform_fee:in');

        v_owner_balance := v_owner_balance - v_platform_fee;
        -- Provenance (20261028): collect the fee leg for the
        -- end-of-settlement distribution (its share of a moved mark
        -- is destroyed; fresh PayPal money gives it none).
        v_taint_users := array_append(v_taint_users, NULL::uuid);
        v_taint_amounts := array_append(v_taint_amounts, v_platform_fee);
      END IF;
    END IF;
  END IF;

  -- ── Split execution ─────────────────────────────────────────────────
  -- The owner's active rules divert shares of this payment to split
  -- recipients. With no active rules this loop finds no rows and the
  -- settlement is exactly what it was before splits executed. The
  -- remainder starts AFTER the platform fee: legs are still shares of
  -- the ORIGINAL payment amount, capped at what the fee left behind.
  v_remaining := p_amount - v_platform_fee;

  FOR v_rule IN
    SELECT r.id AS rule_id, r.name AS rule_name,
           r.split_type, r.split_value,
           s.id AS subaccount_id, s.account_name,
           s.account_email
    FROM public.split_rules r
    JOIN public.subaccounts s ON s.id = r.subaccount_id
    WHERE r.owner_id = v_link.user_id
      AND s.owner_id = v_link.user_id
      AND r.is_active
      AND s.status = 'active'
      AND r.split_value > 0
    ORDER BY r.created_at, r.id
  LOOP
    EXIT WHEN v_remaining <= 0;

    -- Leg size: percentage legs are shares of the ORIGINAL amount;
    -- every leg is capped at what remains of the payment.
    IF v_rule.split_type = 'percentage' THEN
      v_leg := round(p_amount * v_rule.split_value / 100, 2);
    ELSE
      v_leg := v_rule.split_value;
    END IF;
    v_leg := LEAST(v_leg, v_remaining);
    IF v_leg <= 0 THEN
      CONTINUE;
    END IF;

    -- Resolve the recipient to a platform user by account email.
    -- No email / no account under that email / the owner themselves:
    -- the leg does not execute and the share stays with the owner.
    IF v_rule.account_email IS NULL
       OR btrim(v_rule.account_email) = '' THEN
      CONTINUE;
    END IF;
    SELECT u.id INTO v_recipient_user
    FROM auth.users u
    WHERE lower(u.email) = lower(btrim(v_rule.account_email))
    ORDER BY u.created_at
    LIMIT 1;
    IF v_recipient_user IS NULL OR v_recipient_user = v_link.user_id THEN
      CONTINUE;
    END IF;

    -- Recipient's Main wallet in the settlement currency, created on
    -- demand. A closed wallet cannot receive — the leg is skipped and
    -- the share stays with the owner; frozen may receive.
    SELECT * INTO v_recipient_wallet FROM public.wallets
    WHERE user_id = v_recipient_user
      AND currency = v_link.currency
      AND account_id IS NULL
    FOR UPDATE;
    IF v_recipient_wallet.id IS NULL THEN
      INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
      VALUES (v_recipient_user, NULL, v_link.currency, 0, 'active')
      RETURNING * INTO v_recipient_wallet;
    END IF;
    IF v_recipient_wallet.status = 'closed' THEN
      CONTINUE;
    END IF;

    -- Move the leg: owner settlement wallet → recipient Main wallet.
    UPDATE public.wallets
    SET balance = balance - v_leg, updated_at = now()
    WHERE id = v_owner_wallet.id;
    UPDATE public.wallets
    SET balance = balance + v_leg, updated_at = now()
    WHERE id = v_recipient_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_link.user_id, v_owner_wallet.id, v_leg, v_link.currency,
       'outgoing', p_payment_method, 'completed', v_rule.account_name,
       'Split payment: ' || v_rule.rule_name || ' → ' || v_rule.account_name,
       'link:' || v_link.id::text, 'split_payment',
       p_idempotency_key || ':split:' || v_rule.rule_id::text || ':out');

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, recipient_name, description, reference, category, idempotency_key)
    VALUES
      (v_recipient_user, v_recipient_wallet.id, v_leg, v_link.currency,
       'incoming', p_payment_method, 'completed', v_owner_name,
       'Split payment: ' || v_rule.rule_name
         || ' (payment link: ' || v_link.title || ')',
       'link:' || v_link.id::text, 'split_payment',
       p_idempotency_key || ':split:' || v_rule.rule_id::text || ':in');

    UPDATE public.subaccounts
    SET total_received = COALESCE(total_received, 0) + v_leg,
        updated_at = now()
    WHERE id = v_rule.subaccount_id;

    v_owner_balance := v_owner_balance - v_leg;
    -- Provenance (20261028): collect this executed split leg.
    v_taint_users := array_append(v_taint_users, v_recipient_user);
    v_taint_amounts := array_append(v_taint_amounts, v_leg);
    v_remaining := v_remaining - v_leg;
  END LOOP;

  -- ── Provenance distribution (20261028) ─────────────────────────
  -- The collected legs — platform fee, each executed split leg, and
  -- the owner's residual appended here — sum to p_amount exactly.
  IF v_remaining > 0 THEN
    v_taint_users := array_append(v_taint_users, v_link.user_id);
    v_taint_amounts := array_append(v_taint_amounts, v_remaining);
  END IF;

  IF array_length(v_taint_amounts, 1) IS NOT NULL THEN
    IF p_payer_user_id IS NOT NULL THEN
      -- Wallet-paid: the payer's mark moves spent-first and is
      -- distributed across the legs PRO-RATA by leg amount. Per-leg
      -- shares are rounded to 2dp and the rounding residue lands on
      -- the largest leg, so the distributed mark equals the moved
      -- mark to the cent. The fee leg's share is destroyed (its
      -- "recipient" is NULL — the mark simply never lands anywhere).
      v_taint_total := public.paypal_taint_debit(
        p_payer_user_id, v_link.currency, p_amount);
      IF v_taint_total > 0 THEN
        FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
          v_taint_share := round(
            v_taint_total * v_taint_amounts[i] / p_amount, 2);
          v_taint_shares := array_append(v_taint_shares, v_taint_share);
          v_taint_assigned := v_taint_assigned + v_taint_share;
          IF v_taint_amounts[i] > v_taint_amounts[v_largest_idx] THEN
            v_largest_idx := i;
          END IF;
        END LOOP;
        v_taint_shares[v_largest_idx] := GREATEST(0,
          v_taint_shares[v_largest_idx]
            + (v_taint_total - v_taint_assigned));
        FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
          IF v_taint_users[i] IS NOT NULL AND v_taint_shares[i] > 0 THEN
            PERFORM public.paypal_taint_credit(
              v_taint_users[i], v_link.currency, v_taint_shares[i]);
          END IF;
        END LOOP;
      END IF;
    ELSIF lower(COALESCE(p_payment_method, '')) = 'paypal' THEN
      -- External PayPal payment (the gateway completion path): the
      -- whole settled amount is FRESH PayPal money, so every user
      -- leg is marked in full by its amount; the fee leg gets none.
      FOR i IN 1 .. array_length(v_taint_amounts, 1) LOOP
        IF v_taint_users[i] IS NOT NULL THEN
          PERFORM public.paypal_taint_credit(
            v_taint_users[i], v_link.currency, v_taint_amounts[i]);
        END IF;
      END LOOP;
    END IF;
  END IF;

  transaction_id := COALESCE(v_payer_tx, v_owner_tx);
  owner_transaction_id := v_owner_tx;
  owner_new_balance := v_owner_balance;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) TO service_role;

-- ── PayPal wallet deposits: the capture creates the mark ─────
CREATE OR REPLACE FUNCTION public.complete_wallet_deposit(
  p_order_id text,
  p_capture_id text,
  p_captured_amount numeric,
  p_captured_currency text
)
RETURNS TABLE(
  outcome text,
  transaction_id uuid,
  wallet_id uuid,
  credited_amount numeric,
  currency text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.transactions;
  v_wallet public.wallets;
BEGIN
  IF p_order_id IS NULL OR length(p_order_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal order id is required';
  END IF;
  IF p_capture_id IS NULL OR length(p_capture_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal capture id is required';
  END IF;
  IF p_captured_amount IS NULL OR p_captured_amount <= 0 THEN
    RAISE EXCEPTION 'Captured amount must be greater than zero';
  END IF;
  IF p_captured_currency IS NULL OR length(p_captured_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid captured currency is required';
  END IF;

  -- Lock the deposit row: the status check and the credit below are
  -- one atomic unit, which is what makes completion exactly-once.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.reference = p_order_id
    AND t.payment_method = 'paypal'
    AND t.metadata ->> 'kind' = 'wallet_deposit'
  ORDER BY t.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  transaction_id := v_tx.uuid_id;
  wallet_id := v_tx.wallet_id;
  credited_amount := v_tx.amount;
  currency := v_tx.currency;

  IF v_tx.status = 'completed' THEN
    IF v_tx.external_reference = p_capture_id
       OR v_tx.metadata ->> 'capture_id' = p_capture_id THEN
      outcome := 'already_completed';
    ELSE
      outcome := 'conflict';
    END IF;
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Defence in depth: this capture already funded another deposit.
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.external_reference = p_capture_id
      AND t.status = 'completed'
      AND t.metadata ->> 'kind' = 'wallet_deposit'
      AND t.uuid_id <> v_tx.uuid_id
  ) THEN
    outcome := 'already_completed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_tx.status <> 'pending' THEN
    outcome := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Verify the capture against the recorded deposit. A mismatch is a
  -- hard stop: no state changes, no credit, the outcome names itself.
  IF round(p_captured_amount, 2) <> round(v_tx.amount, 2) THEN
    outcome := 'amount_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;
  IF upper(p_captured_currency) <> upper(v_tx.currency) THEN
    outcome := 'currency_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.status = 'closed' THEN
    outcome := 'wallet_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.wallets w
  SET balance = w.balance + v_tx.amount,
      updated_at = now()
  WHERE w.id = v_wallet.id
  RETURNING w.balance INTO new_balance;

  UPDATE public.transactions t
  SET status = 'completed',
      external_reference = p_capture_id,
      description = 'Wallet deposit via PayPal',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'capture_id', p_capture_id,
        'captured_amount', p_captured_amount,
        'captured_currency', upper(p_captured_currency),
        'captured_at', now()
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  -- Provenance (20261028): a verified PayPal capture creates the
  -- mark — this credit is what makes the money PayPal-withdrawable,
  -- and the mark follows the money from here. Only on the credited
  -- path: replays report 'already_completed' above and create none.
  PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount);

  outcome := 'credited';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) TO service_role;

-- ── PayPal checkout payments: the capture creates the mark ───
CREATE OR REPLACE FUNCTION public.complete_checkout_payment(
  p_order_id text,
  p_capture_id text,
  p_captured_amount numeric,
  p_captured_currency text
)
RETURNS TABLE(
  outcome text,
  transaction_id uuid,
  wallet_id uuid,
  credited_amount numeric,
  currency text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.transactions;
  v_wallet public.wallets;
BEGIN
  IF p_order_id IS NULL OR length(p_order_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal order id is required';
  END IF;
  IF p_capture_id IS NULL OR length(p_capture_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal capture id is required';
  END IF;
  IF p_captured_amount IS NULL OR p_captured_amount <= 0 THEN
    RAISE EXCEPTION 'Captured amount must be greater than zero';
  END IF;
  IF p_captured_currency IS NULL OR length(p_captured_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid captured currency is required';
  END IF;

  -- Lock the checkout row: the status check and the credit below are
  -- one atomic unit, which is what makes completion exactly-once.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.reference = p_order_id
    AND t.payment_method = 'paypal'
    AND t.metadata ->> 'kind' = 'checkout_payment'
  ORDER BY t.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  transaction_id := v_tx.uuid_id;
  wallet_id := v_tx.wallet_id;
  credited_amount := v_tx.amount;
  currency := v_tx.currency;

  IF v_tx.status = 'completed' THEN
    IF v_tx.external_reference = p_capture_id
       OR v_tx.metadata ->> 'capture_id' = p_capture_id THEN
      outcome := 'already_completed';
    ELSE
      outcome := 'conflict';
    END IF;
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Defence in depth: this capture already funded another checkout
  -- payment.
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.external_reference = p_capture_id
      AND t.status = 'completed'
      AND t.metadata ->> 'kind' = 'checkout_payment'
      AND t.uuid_id <> v_tx.uuid_id
  ) THEN
    outcome := 'already_completed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_tx.status <> 'pending' THEN
    outcome := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Verify the capture against the recorded checkout amount. A
  -- mismatch is a hard stop: no state changes, no credit, the outcome
  -- names itself.
  IF round(p_captured_amount, 2) <> round(v_tx.amount, 2) THEN
    outcome := 'amount_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;
  IF upper(p_captured_currency) <> upper(v_tx.currency) THEN
    outcome := 'currency_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.status = 'closed' THEN
    outcome := 'wallet_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.wallets w
  SET balance = w.balance + v_tx.amount,
      updated_at = now()
  WHERE w.id = v_wallet.id
  RETURNING w.balance INTO new_balance;

  UPDATE public.transactions t
  SET status = 'completed',
      external_reference = p_capture_id,
      description = 'Checkout payment via PayPal',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'capture_id', p_capture_id,
        'captured_amount', p_captured_amount,
        'captured_currency', upper(p_captured_currency),
        'captured_at', now()
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  -- Provenance (20261028): a verified PayPal capture creates the
  -- mark for the merchant, exactly as a deposit does for its owner —
  -- this money arrived via PayPal and keeps that right as it moves.
  -- Only on the credited path (replays return above).
  PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount);

  outcome := 'credited';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_checkout_payment(text, text, numeric, text) TO service_role;

-- ── Currency conversion: the mark converts with the money ────
CREATE OR REPLACE FUNCTION public.execute_currency_conversion(
  p_user_id uuid,
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_from_amount numeric,
  p_expected_rate numeric DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE(
  transaction_id uuid,
  conversion_id uuid,
  exchange_rate numeric,
  to_amount numeric,
  new_from_balance numeric,
  new_to_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from public.wallets;
  v_to public.wallets;
  v_rate numeric;
  v_inverse numeric;
  v_existing_id uuid;
  v_tx_id uuid;
  v_taint_from numeric := 0;
  v_taint_to numeric := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_from_amount IS NULL OR p_from_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'Source and destination wallets must differ';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: replay returns the original conversion.
  SELECT t.uuid_id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT c.id, c.exchange_rate, c.to_amount INTO conversion_id, exchange_rate, to_amount
    FROM public.currency_conversions c
    WHERE c.from_wallet_id = p_from_wallet_id
      AND c.to_wallet_id = p_to_wallet_id
      AND c.from_amount = p_from_amount
    ORDER BY c.created_at DESC
    LIMIT 1;
    SELECT w.balance INTO new_from_balance FROM public.wallets w WHERE w.id = p_from_wallet_id;
    SELECT w.balance INTO new_to_balance FROM public.wallets w WHERE w.id = p_to_wallet_id;
    transaction_id := v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock both wallet rows in id order (deadlock-safe).
  PERFORM 1 FROM public.wallets
  WHERE id IN (p_from_wallet_id, p_to_wallet_id)
  ORDER BY id FOR UPDATE;

  SELECT * INTO v_from FROM public.wallets WHERE id = p_from_wallet_id;
  SELECT * INTO v_to FROM public.wallets WHERE id = p_to_wallet_id;
  IF v_from.id IS NULL OR v_to.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF v_from.user_id <> p_user_id OR v_to.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Both wallets must belong to the account holder';
  END IF;
  IF v_from.currency = v_to.currency THEN
    RAISE EXCEPTION 'Conversion requires two different currencies';
  END IF;
  IF v_from.status <> 'active' OR v_to.status <> 'active' THEN
    RAISE EXCEPTION 'Both wallets must be active';
  END IF;
  IF v_from.balance < p_from_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_from.balance, p_from_amount;
  END IF;

  -- Stored rate: direct pair first, then the inverse pair.
  SELECT r.rate INTO v_rate
  FROM public.exchange_rates r
  WHERE r.from_currency = v_from.currency
    AND r.to_currency = v_to.currency
    AND r.valid_from <= now()
    AND (r.valid_until IS NULL OR r.valid_until >= now())
  ORDER BY r.valid_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    SELECT r.rate INTO v_inverse
    FROM public.exchange_rates r
    WHERE r.from_currency = v_to.currency
      AND r.to_currency = v_from.currency
      AND r.valid_from <= now()
      AND (r.valid_until IS NULL OR r.valid_until >= now())
    ORDER BY r.valid_from DESC
    LIMIT 1;
    IF v_inverse IS NOT NULL AND v_inverse <> 0 THEN
      v_rate := 1 / v_inverse;
    END IF;
  END IF;

  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'No live exchange rate is available for % to %', v_from.currency, v_to.currency;
  END IF;

  IF p_expected_rate IS NOT NULL AND p_expected_rate > 0
     AND abs(v_rate - p_expected_rate) / p_expected_rate > 0.02 THEN
    RAISE EXCEPTION 'Exchange rate moved from % to % — review and try again', p_expected_rate, v_rate;
  END IF;

  to_amount := round(p_from_amount * v_rate, 2);
  IF to_amount <= 0 THEN
    RAISE EXCEPTION 'Converted amount is too small';
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_from_amount, updated_at = now()
  WHERE id = v_from.id;
  UPDATE public.wallets
  SET balance = balance + to_amount, updated_at = now()
  WHERE id = v_to.id;

  -- Provenance (20261028): the mark converts with the money — the
  -- marked fraction leaves the source currency spent-first and is
  -- credited to the destination currency at this conversion's own
  -- effective rate (to_amount / p_from_amount).
  v_taint_from := public.paypal_taint_debit(p_user_id, v_from.currency, p_from_amount);
  IF v_taint_from > 0 THEN
    v_taint_to := round(v_taint_from * to_amount / p_from_amount, 2);
    IF v_taint_to > 0 THEN
      PERFORM public.paypal_taint_credit(p_user_id, v_to.currency, v_taint_to);
    END IF;
  END IF;

  -- No conversion fee is charged (fee_amount stays 0); the previous
  -- client code recorded a 1.5% "fee" that was never actually taken.
  INSERT INTO public.currency_conversions
    (user_id, from_currency, to_currency, from_amount, to_amount,
     exchange_rate, fee_amount, from_wallet_id, to_wallet_id, status)
  VALUES
    (p_user_id, v_from.currency, v_to.currency, p_from_amount, to_amount,
     v_rate, 0, p_from_wallet_id, p_to_wallet_id, 'completed')
  RETURNING id INTO conversion_id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_to.id, to_amount, v_to.currency, 'incoming', 'wallet',
     'completed',
     'Converted ' || p_from_amount || ' ' || v_from.currency || ' to ' || v_to.currency,
     'conversion:' || conversion_id::text, 'currency_conversion', p_idempotency_key || ':in');

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_from.id, p_from_amount, v_from.currency, 'outgoing', 'wallet',
     'completed',
     'Converted ' || p_from_amount || ' ' || v_from.currency || ' to ' || v_to.currency,
     'conversion:' || conversion_id::text, 'currency_conversion', p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  transaction_id := v_tx_id;
  exchange_rate := v_rate;
  new_from_balance := v_from.balance - p_from_amount;
  new_to_balance := v_to.balance + to_amount;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.execute_currency_conversion(uuid, uuid, uuid, numeric, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_currency_conversion(uuid, uuid, uuid, numeric, numeric, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_currency_conversion(uuid, uuid, uuid, numeric, numeric, text) TO service_role;

-- ── Bitcoin trades: buying destroys the spent mark ───────────
CREATE OR REPLACE FUNCTION public.btc_execute_trade(
  p_user_id UUID,
  p_quote_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(quote_id UUID, side TEXT, amount_zmw NUMERIC, amount_sats BIGINT,
              new_zmw_balance NUMERIC, new_btc_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.btc_quotes%ROWTYPE;
  v_zmw_id UUID;
  v_zmw_balance NUMERIC;
  v_crypto_balance BIGINT;
  v_crypto_available BIGINT;
  v_existing UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.id INTO v_existing
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':zmw'
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT q.* INTO v_quote FROM public.btc_quotes q WHERE q.id = p_quote_id;
      SELECT w.balance INTO v_zmw_balance FROM public.wallets w
        WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL;
      SELECT c.balance_sats INTO v_crypto_balance FROM public.crypto_wallets c
        WHERE c.user_id = p_user_id AND c.asset = 'BTC';
      quote_id := v_quote.id; side := v_quote.side;
      amount_zmw := v_quote.amount_zmw; amount_sats := v_quote.amount_sats;
      new_zmw_balance := v_zmw_balance; new_btc_sats := v_crypto_balance;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT q.* INTO v_quote
  FROM public.btc_quotes q
  WHERE q.id = p_quote_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF v_quote.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Quote does not belong to this user';
  END IF;
  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote already used';
  END IF;
  IF v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'Quote expired';
  END IF;

  -- Lock treasury first (consistent lock order: treasury, ZMW, crypto).
  PERFORM 1 FROM public.btc_treasury WHERE id = 1 FOR UPDATE;

  -- Lock (or create) the ZMW wallet.
  SELECT w.id, w.balance INTO v_zmw_id, v_zmw_balance
  FROM public.wallets w
  WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL
  FOR UPDATE;

  IF v_zmw_id IS NULL THEN
    IF v_quote.side = 'buy' THEN
      RAISE EXCEPTION 'No ZMW wallet — fund your wallet first';
    END IF;
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (p_user_id, 'ZMW', 0, 'active')
    RETURNING id, balance INTO v_zmw_id, v_zmw_balance;
  END IF;

  -- Lock (or create) the BTC crypto wallet.
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT c.balance_sats, c.available_sats INTO v_crypto_balance, v_crypto_available
  FROM public.crypto_wallets c
  WHERE c.user_id = p_user_id AND c.asset = 'BTC'
  FOR UPDATE;

  IF v_quote.side = 'buy' THEN
    IF v_zmw_balance < v_quote.amount_zmw THEN
      RAISE EXCEPTION 'Insufficient ZMW balance: have %, need %',
        v_zmw_balance, v_quote.amount_zmw;
    END IF;
    IF (SELECT t.float_sats FROM public.btc_treasury t WHERE t.id = 1) < v_quote.amount_sats THEN
      RAISE EXCEPTION 'Bitcoin temporarily unavailable — insufficient platform inventory';
    END IF;

    UPDATE public.wallets
    SET balance = balance - v_quote.amount_zmw, updated_at = now()
    WHERE id = v_zmw_id;

    -- Provenance (20261028): fiat spent on Bitcoin leaves to the
    -- platform float — a non-user destination — so the mark is
    -- destroyed spent-first. (A sell credits fiat FROM the float:
    -- unmarked money, no mark is created.)
    PERFORM public.paypal_taint_debit(p_user_id, 'ZMW', v_quote.amount_zmw);

    UPDATE public.crypto_wallets
    SET balance_sats = balance_sats + v_quote.amount_sats,
        available_sats = available_sats + v_quote.amount_sats,
        updated_at = now()
    WHERE user_id = p_user_id AND asset = 'BTC';

    UPDATE public.btc_treasury
    SET float_sats = float_sats - v_quote.amount_sats, updated_at = now()
    WHERE id = 1;

    new_zmw_balance := v_zmw_balance - v_quote.amount_zmw;
    new_btc_sats := v_crypto_balance + v_quote.amount_sats;
  ELSE
    IF v_crypto_available < v_quote.amount_sats THEN
      RAISE EXCEPTION 'Insufficient BTC balance: have % sats, need %',
        v_crypto_available, v_quote.amount_sats;
    END IF;

    UPDATE public.crypto_wallets
    SET balance_sats = balance_sats - v_quote.amount_sats,
        available_sats = available_sats - v_quote.amount_sats,
        updated_at = now()
    WHERE user_id = p_user_id AND asset = 'BTC';

    UPDATE public.wallets
    SET balance = balance + v_quote.amount_zmw, updated_at = now()
    WHERE id = v_zmw_id;

    UPDATE public.btc_treasury
    SET float_sats = float_sats + v_quote.amount_sats, updated_at = now()
    WHERE id = 1;

    new_zmw_balance := v_zmw_balance + v_quote.amount_zmw;
    new_btc_sats := v_crypto_balance - v_quote.amount_sats;
  END IF;

  -- Ledger legs (positive amounts + direction, as in execute_atomic_transfer).
  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_zmw_id, v_quote.amount_zmw, 'ZMW',
     CASE WHEN v_quote.side = 'buy' THEN 'outgoing' ELSE 'incoming' END,
     'bitcoin_trade', 'completed',
     CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':zmw' END);

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_quote.amount_sats::numeric / 100000000, 'BTC',
     CASE WHEN v_quote.side = 'buy' THEN 'incoming' ELSE 'outgoing' END,
     'bitcoin_trade', 'completed',
     CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':btc' END);

  UPDATE public.btc_quotes
  SET consumed_at = now()
  WHERE id = v_quote.id;

  quote_id := v_quote.id; side := v_quote.side;
  amount_zmw := v_quote.amount_zmw; amount_sats := v_quote.amount_sats;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.btc_execute_trade(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btc_execute_trade(UUID, UUID, TEXT) TO service_role;
