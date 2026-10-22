-- execute_atomic_transfer: settle sends into/out of the MAIN wallet.
--
-- Problem: since sub-accounts (20261021_sub_accounts_phase1), a user
-- can hold several wallets in the same currency — Main (account_id
-- NULL) plus one per sub-account. execute_atomic_transfer selects the
-- sender and recipient wallets by (user_id, currency) alone, and a
-- non-STRICT SELECT ... INTO over multiple matching rows picks an
-- arbitrary one. A user-to-user send could therefore debit a
-- sub-account wallet instead of Main — or fail with "Insufficient
-- balance" against an empty sub-account wallet while Main is funded
-- (live QA Round 2's sender holds a closed, zero-balance sub-account
-- wallet next to a funded Main).
--
-- Product rule (already applied by the wallet UI and the internal /
-- payment-link settlement paths): user-to-user sends leave from, and
-- land in, the Main wallet. The partial unique indexes from Phase 1
-- guarantee at most one Main wallet per (user, currency), so adding
-- `account_id IS NULL` makes every lookup deterministic.
--
-- Body is otherwise IDENTICAL to the current definition
-- (20261021_fix_transaction_id_returning.sql). Grants re-asserted to
-- match 20261017: service_role only — the atomic-transfer edge
-- function executes this RPC on a dedicated service-role client.

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

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) TO service_role;
