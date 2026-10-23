-- =====================================================================
-- 20261023_l2_replay_scope.sql -- L2: scope idempotent replays to
-- their owner in the four SECURITY DEFINER money functions.
--
-- Audit finding L2 (Low): execute_atomic_transfer,
-- execute_internal_transfer, execute_payment_link_settlement and
-- btc_execute_trade look up an existing transaction by idempotency key
-- and return its result -- including the original caller's balances --
-- without verifying that the transaction belongs to the caller.
-- Anyone who learns a victim's client-generated idempotency key can
-- replay it to harvest the victim's balance or to obtain a false
-- 'already processed' answer.
--
-- Uniform fix pattern applied to each replay branch below:
--   * the replay lookup also fetches the stored transaction's owner;
--   * if a transaction with the key exists but belongs to someone
--     else, the function raises 'Idempotency key already used' before
--     any balance is read or returned;
--   * if it belongs to the caller, the original replay return runs
--     unchanged;
--   * if no transaction carries the key, the call falls through to
--     the main path unchanged.
-- Each definition below is the current repo definition of the
-- function with only its replay branch (plus one added DECLARE line)
-- changed; grants are restated exactly as in the source migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. execute_atomic_transfer
-- Source: supabase/migrations/20261028_paypal_provenance_follows.sql
-- Stored owner: transactions.user_id. Caller identity: p_from_user_id.
-- ---------------------------------------------------------------------
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
  v_existing_user UUID;
  v_tx_id UUID;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
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
$$;
REVOKE ALL ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_atomic_transfer(uuid, uuid, numeric, text, text, text, text, text, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 2. execute_internal_transfer
-- Source: supabase/migrations/20261021_internal_transfer_service_path.sql
-- Caller identity: owner of p_from_wallet_id. Stored owner: owner of
-- the transaction's wallet_id. (The source migration's DROP of the
-- superseded five-argument signature is not repeated: CREATE OR
-- REPLACE on this identical signature is sufficient.)
-- ---------------------------------------------------------------------
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
  SELECT t.id, w.user_id INTO v_existing_id, v_existing_owner
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
      SELECT t.id, w.balance INTO v_tx_id, new_sender_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.id = t.wallet_id
      WHERE t.id = v_existing_id;
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
  RETURNING id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_from.balance - p_amount;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(uuid, uuid, uuid, numeric, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 3. execute_payment_link_settlement
-- Source: supabase/migrations/20261028_paypal_provenance_follows.sql
-- Scoped by reference rather than user id: settlement rows carry
-- reference 'link:' || link id, and the replay is honoured only when
-- the stored ':in' (or bare-key outgoing) row names THIS link.
-- ---------------------------------------------------------------------
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
$$;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 4. btc_execute_trade
-- Source: supabase/migrations/20261025_btc_trade_wallet_scope.sql
-- Stored owner: transactions.user_id of the ':zmw' row. Caller
-- identity: p_user_id.
-- ---------------------------------------------------------------------
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
  v_existing_user UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.id, t.user_id INTO v_existing, v_existing_user
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':zmw'
    LIMIT 1;
    IF v_existing IS NOT NULL AND v_existing_user <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
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
