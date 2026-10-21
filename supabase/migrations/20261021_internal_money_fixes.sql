-- Internal money correctness: savings transfers + currency conversion.
--
-- Why these exist:
--   * Savings deposits were written from the browser as
--     `balance = balance + amount` on savings_accounts — money created
--     from nothing, no wallet debit, and the write only "worked"
--     because savings_accounts has no balance-protection trigger.
--   * Currency conversion only inserted a currency_conversions history
--     row: no wallet was debited or credited while the UI toasted
--     success.
--
-- Both flows now move real money inside one Postgres transaction,
-- following the platform's established rules (see
-- 20261021_internal_transfer_service_path):
--   * SECURITY DEFINER, service_role-only — invoked from edge
--     functions whose RPC client forwards NO caller Authorization
--     header, because protect_wallet_balance() silently reverts
--     wallets.balance UPDATEs whenever auth.uid() IS NOT NULL.
--   * Actor defence-in-depth: a live user session may only act as
--     itself (auth.uid() must match p_user_id when present).
--   * Idempotency keys on the primary ledger leg; a replay returns
--     the original result and moves nothing twice.
--   * Ledger legs are written so calculate_wallet_balance() stays
--     exact: a savings movement writes exactly ONE leg on the funding
--     wallet (outgoing for a deposit, incoming for a withdrawal);
--     a conversion writes one outgoing leg on the source wallet and
--     one incoming leg on the destination wallet.

-- ── Savings <-> wallet ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_savings_transfer(
  p_user_id uuid,
  p_savings_account_id uuid,
  p_wallet_id uuid,
  p_amount numeric,
  p_direction text,           -- 'deposit' (wallet -> savings) | 'withdraw' (savings -> wallet)
  p_idempotency_key text,
  p_description text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid, new_wallet_balance numeric, new_savings_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wallet public.wallets;
  v_savings public.savings_accounts;
  v_existing_id uuid;
  v_tx_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_direction NOT IN ('deposit', 'withdraw') THEN
    RAISE EXCEPTION 'Direction must be deposit or withdraw';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: the primary leg carries the bare key (outgoing for a
  -- deposit, incoming for a withdrawal). Replay returns current state.
  SELECT t.uuid_id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT w.balance INTO new_wallet_balance FROM public.wallets w WHERE w.id = p_wallet_id;
    SELECT s.balance INTO new_savings_balance FROM public.savings_accounts s WHERE s.id = p_savings_account_id;
    transaction_id := v_existing_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Lock both rows (wallet first — consistent order).
  SELECT * INTO v_wallet FROM public.wallets WHERE id = p_wallet_id FOR UPDATE;
  SELECT * INTO v_savings FROM public.savings_accounts WHERE id = p_savings_account_id FOR UPDATE;
  IF v_wallet.id IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  IF v_savings.id IS NULL THEN
    RAISE EXCEPTION 'Savings account not found';
  END IF;
  IF v_wallet.user_id <> p_user_id OR v_savings.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Wallet and savings account must belong to the account holder';
  END IF;
  IF v_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Wallet is not active';
  END IF;
  IF v_savings.status <> 'active' THEN
    RAISE EXCEPTION 'Savings account is not active';
  END IF;
  IF v_wallet.currency <> v_savings.currency THEN
    RAISE EXCEPTION 'Wallet currency % does not match savings currency %', v_wallet.currency, v_savings.currency;
  END IF;

  IF p_direction = 'deposit' THEN
    IF v_wallet.balance < p_amount THEN
      RAISE EXCEPTION 'Insufficient wallet balance: have %, need %', v_wallet.balance, p_amount;
    END IF;

    UPDATE public.wallets
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_wallet.id;
    UPDATE public.savings_accounts
    SET balance = balance + p_amount, updated_at = now()
    WHERE id = v_savings.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, description, reference, category, idempotency_key)
    VALUES
      (p_user_id, v_wallet.id, p_amount, v_wallet.currency, 'outgoing', 'wallet',
       'completed', COALESCE(p_description, 'Deposit to savings goal'),
       'savings:' || p_savings_account_id::text, 'savings_deposit', p_idempotency_key)
    RETURNING uuid_id INTO v_tx_id;

    new_wallet_balance := v_wallet.balance - p_amount;
    new_savings_balance := v_savings.balance + p_amount;
  ELSE
    IF v_savings.balance < p_amount THEN
      RAISE EXCEPTION 'Insufficient savings balance: have %, need %', v_savings.balance, p_amount;
    END IF;

    UPDATE public.savings_accounts
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_savings.id;
    UPDATE public.wallets
    SET balance = balance + p_amount, updated_at = now()
    WHERE id = v_wallet.id;

    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, description, reference, category, idempotency_key)
    VALUES
      (p_user_id, v_wallet.id, p_amount, v_wallet.currency, 'incoming', 'wallet',
       'completed', COALESCE(p_description, 'Withdrawal from savings goal'),
       'savings:' || p_savings_account_id::text, 'savings_withdrawal', p_idempotency_key)
    RETURNING uuid_id INTO v_tx_id;

    new_wallet_balance := v_wallet.balance + p_amount;
    new_savings_balance := v_savings.balance - p_amount;
  END IF;

  transaction_id := v_tx_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_savings_transfer(uuid, uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_savings_transfer(uuid, uuid, uuid, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_savings_transfer(uuid, uuid, uuid, numeric, text, text, text) TO service_role;

-- ── Currency conversion between the user's own wallets ─────────────
-- The rate is read server-side from exchange_rates (the same table the
-- UI displays, with the same direct-or-inverse semantics and validity
-- window) — a client-supplied rate is only an expectation: if the
-- stored rate has moved more than 2% from it, the conversion refuses
-- rather than silently settling at a different price.
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
