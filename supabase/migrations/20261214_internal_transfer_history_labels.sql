-- 20261214_internal_transfer_history_labels.sql
-- Workstream C (completion census, 2026-10-26) - two paper cuts in
-- execute_internal_transfer, whose body below is the LIVE
-- pg_get_functiondef output with ONLY the marked changes:
--
-- 1. HISTORY LABELS: an internal transfer with no caller note wrote
--    NULL descriptions on both ledger rows, so history lists could
--    not name the counterparty account (the receiving side rendered
--    as 'Received from Unknown' in the lists that composed
--    'Received from {recipient_name}'). The RPC now resolves both
--    account names ('Main account' for account_id NULL, otherwise
--    the sub-account's name) and, when no note was supplied, writes
--    'Transfer to <destination>' on the outgoing row and
--    'Transfer from <source>' on the incoming row. A supplied note
--    still wins on both rows. Each row's reference now names the
--    COUNTERPARTY wallet (previously each row referenced its own).
--
-- 2. FROZEN SENDS: the source-account refusal was the raw
--    'Source account is % and cannot send'. It is now a crafted
--    plain-language message that says the account is frozen, that
--    it can still receive, and how to send again (closed accounts
--    get their own wording). The client mapper
--    (src/utils/userFacingError.ts) normalises every frozen shape
--    to the same guidance.
--
-- CREATE OR REPLACE preserves the function's existing ACL
-- (verified service_role-only after apply, per repo convention).

CREATE OR REPLACE FUNCTION public.execute_internal_transfer(p_user_id uuid, p_from_wallet_id uuid, p_to_wallet_id uuid, p_amount numeric, p_idempotency_key text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, new_sender_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from public.wallets;
  v_to public.wallets;
  v_from_account_status text;
  v_to_account_status text;
  v_existing_id uuid;
  v_existing_owner uuid;
  v_from_owner uuid;
  v_tx_id uuid;
  v_from_account_name text;
  v_to_account_name text;
  v_out_description text;
  v_in_description text;
BEGIN
  -- A live user session may only ever act as itself.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Actor mismatch';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;
  IF p_from_wallet_id = p_to_wallet_id THEN
    RAISE EXCEPTION 'Source and destination wallets must differ';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: replay returns the original result -- but only to
  -- the wallet owner who created it (L2 replay scope). The caller is
  -- identified by the owner of p_from_wallet_id; if that wallet does
  -- not exist, the replay is skipped and the main path below raises
  -- 'Wallet not found' exactly as it does for a fresh call.
  SELECT t.uuid_id, w.user_id INTO v_existing_id, v_existing_owner
  FROM public.transactions t
  JOIN public.wallets w ON w.id = t.wallet_id
  WHERE t.idempotency_key = p_idempotency_key AND t.direction = 'outgoing'
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT user_id INTO v_from_owner
    FROM public.wallets WHERE id = p_from_wallet_id;
    IF v_from_owner IS NOT NULL THEN
      IF v_existing_owner <> v_from_owner THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      SELECT t.uuid_id, w.balance INTO v_tx_id, new_sender_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.id = t.wallet_id
      WHERE t.uuid_id = v_existing_id;
      transaction_id := v_tx_id;
      RETURN NEXT;
      RETURN;
    END IF;
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
    IF v_from_account_status = 'frozen' THEN
      RAISE EXCEPTION 'This account is frozen, so money can''t be sent from it right now. It can still receive money - unfreeze it to send again.';
    END IF;
    RAISE EXCEPTION 'This account is closed, so money can''t be sent from it. Closed accounts can''t be reopened.';
  END IF;
  IF v_to.account_id IS NOT NULL AND v_to_account_status = 'closed' THEN
    RAISE EXCEPTION 'Destination account is closed';
  END IF;

  -- History labels (Workstream C, 2026-10-26): resolve both account
  -- names so each ledger row can say where the money came from and
  -- where it went. Before this, both rows carried only the caller's
  -- optional note (usually NULL), so history lists fell back to
  -- generic wording - and earlier still rendered the receiving side
  -- as 'Received from Unknown'. A caller-supplied note still wins.
  IF v_from.account_id IS NULL THEN
    v_from_account_name := 'Main account';
  ELSE
    SELECT name INTO v_from_account_name FROM public.accounts WHERE id = v_from.account_id;
    v_from_account_name := COALESCE(v_from_account_name, 'Sub-account');
  END IF;
  IF v_to.account_id IS NULL THEN
    v_to_account_name := 'Main account';
  ELSE
    SELECT name INTO v_to_account_name FROM public.accounts WHERE id = v_to.account_id;
    v_to_account_name := COALESCE(v_to_account_name, 'Sub-account');
  END IF;
  IF p_description IS NOT NULL AND btrim(p_description) <> '' THEN
    v_out_description := p_description;
    v_in_description := p_description;
  ELSE
    v_out_description := 'Transfer to ' || v_to_account_name;
    v_in_description := 'Transfer from ' || v_from_account_name;
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
     'completed', v_in_description, 'internal:' || p_from_wallet_id::text,
     'internal_transfer', p_idempotency_key || ':in');

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_from.id, p_amount, v_from.currency, 'outgoing', 'wallet',
     'completed', v_out_description, 'internal:' || p_to_wallet_id::text,
     'internal_transfer', p_idempotency_key)
  RETURNING uuid_id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_from.balance - p_amount;
  RETURN NEXT;
END;
$function$
