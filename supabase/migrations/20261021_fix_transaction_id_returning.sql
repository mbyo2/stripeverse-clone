-- Fix: transaction identity confusion (integer PK vs uuid_id).
--
-- public.transactions has an INTEGER primary key (id, nextval) and a
-- separate uuid_id (gen_random_uuid()) that is the row's public identity
-- (reward_transactions.transaction_id and transactions.reversal_id both
-- reference uuid_id). But execute_atomic_transfer and
-- execute_internal_transfer declare v_tx_id UUID and read back
-- `RETURNING id INTO v_tx_id` — the integer sequence value — which raises
-- 22P02 "invalid input syntax for type uuid" on the first successful
-- insert (proven 2026-10-21 by the sub-accounts probe: it died on the
-- value "4"). The idempotency-replay lookups have the same defect
-- (SELECT t.id into a uuid variable). Consequence until now: no
-- server-side transfer has ever completed on this platform.
--
-- Fix: use uuid_id as the transaction identity everywhere in both
-- functions. Bodies are otherwise identical to the live ones.

-- ── execute_internal_transfer ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
  p_user_id uuid,
  p_from_wallet_id uuid,
  p_to_wallet_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_description text DEFAULT NULL
)
RETURNS TABLE(transaction_id uuid, new_sender_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_from public.wallets;
  v_to public.wallets;
  v_from_account_status text;
  v_to_account_status text;
  v_existing_id uuid;
  v_tx_id uuid;
BEGIN
  -- A live user session may only ever act as itself.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'Source and destination wallets must differ';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: replay returns the original result.
  SELECT t.uuid_id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT t.uuid_id, w.balance INTO v_tx_id, new_sender_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.uuid_id = v_existing_id;
    transaction_id := v_tx_id;
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
  IF v_from.currency <> v_to.currency THEN
    RAISE EXCEPTION 'Internal transfers require the same currency on both wallets';
  END IF;
  IF v_from.status <> 'active' OR v_to.status <> 'active' THEN
    RAISE EXCEPTION 'Both wallets must be active';
  END IF;

  SELECT status INTO v_from_account_status FROM public.accounts WHERE id = v_from.account_id;
  SELECT status INTO v_to_account_status FROM public.accounts WHERE id = v_to.account_id;
  IF v_from.account_id IS NOT NULL AND v_from_account_status <> 'active' THEN
    RAISE EXCEPTION 'Source account is % and cannot send', v_from_account_status;
  END IF;
  IF v_to.account_id IS NOT NULL AND v_to_account_status = 'closed' THEN
    RAISE EXCEPTION 'Destination account is closed';
  END IF;

  IF v_from.balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_from.balance, p_amount;
  END IF;

  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_from.id;
  UPDATE public.wallets
  SET balance = balance + p_amount, updated_at = now()
  WHERE id = v_to.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_to.id, p_amount, v_from.currency, 'incoming', 'wallet',
     'completed', p_description, 'internal:' || p_to_wallet_id::text,
     'internal_transfer', p_idempotency_key || ':in');

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_from.id, p_amount, v_from.currency, 'outgoing', 'wallet',
     'completed', p_description, 'internal:' || p_from_wallet_id::text,
     'internal_transfer', p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_from.balance - p_amount;
  RETURN NEXT;
END;
$$;

-- ── execute_atomic_transfer (same identity fix; body otherwise live) ────
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
      WHERE t.uuid_id = v_existing_id;
      transaction_id := v_tx_id;
      new_sender_balance := v_sender_balance;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT w.id, w.balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets w
  WHERE w.user_id = p_from_user_id AND w.currency = p_currency
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
    SELECT w.id INTO v_recipient_wallet_id
    FROM public.wallets w
    WHERE w.user_id = p_to_user_id AND w.currency = p_currency
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

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount;
  RETURN NEXT;
END;
$$;
