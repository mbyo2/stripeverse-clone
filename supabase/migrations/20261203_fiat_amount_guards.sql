-- 20261203_fiat_amount_guards.sql
-- Final-QA FIX-1 (DB layer): every money RPC refuses a fiat amount
-- with more than two decimal places. Before this, execute_atomic_transfer
-- & friends accepted 10.001: the sender's balance went 3dp while the
-- recipient was credited a rounded 10.00. The guard is inserted
-- immediately after each function's existing amount > 0 check.
-- Bodies below are the LIVE pg_get_functiondef output with ONLY the
-- guard added; CREATE OR REPLACE preserves each function's proacl
-- (verified service_role-only after apply).
-- Also: CHECK constraints pinning client-inserted amount columns
-- (payment_links, payment_requests, merchant_invoices) to 2dp —
-- pre-checked live: zero violating rows.


CREATE OR REPLACE FUNCTION public.execute_atomic_transfer(p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_currency text, p_reference_type text, p_reference_id text, p_idempotency_key text, p_description text DEFAULT NULL::text, p_recipient_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'wallet'::text)
 RETURNS TABLE(transaction_id uuid, new_sender_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender_wallet_id UUID;
  v_sender_balance NUMERIC;
  v_recipient_wallet_id UUID;
  v_existing_id UUID;
  v_existing_user UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.uuid_id, t.user_id INTO v_existing_id, v_existing_user
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    IF v_existing_id IS NOT NULL AND v_existing_user <> p_from_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
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
$function$

CREATE OR REPLACE FUNCTION public.execute_send_money_transfer(p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_currency text, p_reference_id text, p_idempotency_key text, p_description text DEFAULT NULL::text, p_recipient_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'wallet'::text)
 RETURNS TABLE(transaction_id uuid, new_sender_balance numeric, fee_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
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
$function$

CREATE OR REPLACE FUNCTION public.execute_transfer_with_fee(p_from_user_id uuid, p_to_user_id uuid, p_amount numeric, p_currency text, p_reference_id text, p_idempotency_key text, p_description text DEFAULT NULL::text, p_recipient_name text DEFAULT NULL::text, p_payment_method text DEFAULT 'wallet'::text)
 RETURNS TABLE(transaction_id uuid, new_sender_balance numeric, fee_amount numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
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
$function$

CREATE OR REPLACE FUNCTION public.execute_payment_link_settlement(p_link_id uuid, p_payer_user_id uuid, p_amount numeric, p_idempotency_key text, p_payment_method text DEFAULT 'wallet'::text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, owner_transaction_id uuid, owner_new_balance numeric, payer_new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_link public.payment_links;
  v_account public.accounts;
  v_owner_wallet public.wallets;
  v_payer_wallet public.wallets;
  v_existing_in uuid;
  v_existing_out uuid;
  v_existing_ref text;
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
  IF p_amount <> round(p_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Idempotency: a settled link payment always leaves exactly one owner
  -- incoming row keyed <key>:in. A replay returns the original result.
  -- L2 scope: the replay is honoured only for THIS link -- the stored
  -- rows carry reference 'link:' || p_link_id. The same key found under
  -- a different reference belongs to a different settlement and is
  -- rejected, so a leaked key cannot harvest another link's balances
  -- or fake an 'already processed' result for it.
  SELECT t.uuid_id, t.reference INTO v_existing_in, v_existing_ref
  FROM public.transactions t
  WHERE t.idempotency_key = p_idempotency_key || ':in'
    AND t.direction = 'incoming'
  LIMIT 1;
  IF v_existing_in IS NOT NULL
     AND v_existing_ref IS DISTINCT FROM 'link:' || p_link_id::text THEN
    RAISE EXCEPTION 'Idempotency key already used';
  END IF;
  IF v_existing_in IS NULL THEN
    SELECT t.reference INTO v_existing_ref
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    IF v_existing_ref IS NOT NULL
       AND v_existing_ref IS DISTINCT FROM 'link:' || p_link_id::text THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
  END IF;
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
$function$

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
$function$

CREATE OR REPLACE FUNCTION public.execute_savings_transfer(p_user_id uuid, p_savings_account_id uuid, p_wallet_id uuid, p_amount numeric, p_direction text, p_idempotency_key text, p_description text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, new_wallet_balance numeric, new_savings_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                      IF p_amount <> round(p_amount, 2) THEN
                                        RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
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
                                                                                                                                                                                                                                                                                                                                                $function$

CREATE OR REPLACE FUNCTION public.execute_currency_conversion(p_user_id uuid, p_from_wallet_id uuid, p_to_wallet_id uuid, p_from_amount numeric, p_expected_rate numeric DEFAULT NULL::numeric, p_idempotency_key text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id uuid, conversion_id uuid, exchange_rate numeric, to_amount numeric, new_from_balance numeric, new_to_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF p_from_amount <> round(p_from_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
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
$function$


-- ── Client-inserted amount columns: 2dp CHECK constraints ──────────
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_amount_2dp;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_amount_2dp
  CHECK (amount IS NULL OR amount = round(amount, 2));

ALTER TABLE public.payment_requests
  DROP CONSTRAINT IF EXISTS payment_requests_amount_2dp;
ALTER TABLE public.payment_requests
  ADD CONSTRAINT payment_requests_amount_2dp
  CHECK (amount = round(amount, 2));

ALTER TABLE public.merchant_invoices
  DROP CONSTRAINT IF EXISTS merchant_invoices_amounts_2dp;
ALTER TABLE public.merchant_invoices
  ADD CONSTRAINT merchant_invoices_amounts_2dp
  CHECK (total_amount = round(total_amount, 2)
     AND subtotal = round(subtotal, 2)
     AND tax_amount = round(tax_amount, 2));
