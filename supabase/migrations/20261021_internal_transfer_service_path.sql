-- Follow-up to 20261021_sub_accounts_phase1: route internal transfers
-- through the server-side path.
--
-- Why: public.protect_wallet_balance() (BEFORE UPDATE trigger on wallets)
-- restores OLD.balance whenever auth.uid() IS NOT NULL — i.e. it silently
-- neutralizes balance changes made inside a signed-in user's session.
-- That is the platform's protection against clients rewriting their own
-- balances, and it is why execute_atomic_transfer is service_role-only
-- behind an edge function. Phase 1 granted execute_internal_transfer to
-- `authenticated` for direct browser calls: under a user JWT the ledger
-- rows would be written but the balance UPDATEs neutralized — transfers
-- that report success and move nothing.
--
-- Caught pre-launch by the rolled-back probe (2026-10-21): with JWT
-- claims set, even a direct seeding UPDATE was neutralized (balance
-- stayed 0.00), which exposed the trigger's rule.
--
-- This migration: the function takes an explicit p_user_id actor. When a
-- user session IS present it must match the actor (defence in depth);
-- the normal path is a service_role call from the `internal-transfer`
-- edge function, which authenticates the caller and passes their id.
-- Ownership of both wallets is still verified against p_user_id inside.

DROP FUNCTION IF EXISTS public.execute_internal_transfer(uuid, uuid, numeric, text, text);

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
  SELECT t.id INTO v_existing_id
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT t.id, w.balance INTO v_tx_id, new_sender_balance
    FROM public.transactions t
    JOIN public.wallets w ON w.id = t.wallet_id
    WHERE t.id = v_existing_id;
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
  RETURNING id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_from.balance - p_amount;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) TO service_role;
