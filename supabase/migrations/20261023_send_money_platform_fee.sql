-- Send Money: the 2.5% send fee, computed and collected by the server,
-- atomically with the send itself.
--
-- CEO decision (2026-10-22, corrected 22:19): Send Money charges a
-- 2.5% fee; the phone-number Transfer stays FREE — the divergence is
-- deliberate. This migration therefore adds a DEDICATED RPC for the
-- Send Money flow only. execute_atomic_transfer (used by Transfer,
-- bill payments, escrow, bulk payments, QR and refunds) is untouched,
-- and Transfer keeps charging exactly nothing.
--
-- The fee replaces the old flat K5, which was planned CLIENT-side as a
-- second atomic-transfer leg with to_user_id NULL — debit-only, so the
-- fee was burned (credited to no wallet) and a client could simply
-- omit the leg. Now the whole send is ONE call to
-- execute_send_money_transfer:
--
--   fee = round(amount * rate / 100, 2)   — on TOP of the amount:
--   the recipient is credited exactly the entered amount, and the
--   sender is debited amount + fee (the balance check covers both).
--   The rate comes from public.platform_settings.send_money_fee_percent
--   (2.5, added below; read defensively — a missing row falls back to
--   2.5 rather than failing a send). Only service_role can change it.
--
--   The fee is CREDITED to the platform: the earliest-created user
--   holding role 'admin' in public.user_roles (ORDER BY created_at,
--   then user_id), into their MAIN wallet (account_id NULL) in the
--   send currency, created on demand — the exact pattern
--   20261022_split_platform_fee.sql uses inside payment-link
--   settlement. The leg is skipped (fee = 0, sender charged only the
--   amount) when: the rate is <= 0, the fee rounds to 0, no admin
--   user exists, the sender IS the platform operator (the platform
--   does not fee itself), or the platform wallet is closed. A frozen
--   platform wallet may receive.
--
-- LEDGER (honest, both sides labelled): the amount rows keep category
-- 'transfer' (sender outgoing with the recipient's name; recipient
-- incoming keyed <key>:in) exactly as execute_atomic_transfer writes
-- them, so Send Money history reads identically to before. The fee is
-- its own pair of rows, category 'transfer_fee': a sender OUTGOING row
-- (recipient_name 'BMaGlass Pay', description 'Send fee for transfer
-- to <recipient name> (ref <reference>)', key <key>:fee) and a platform
-- INCOMING row (recipient_name = the sender's profile name, same
-- description, key <key>:fee:in).
--
-- IDEMPOTENCY: as in execute_atomic_transfer, a replayed
-- idempotency_key returns the original transaction and the fee that
-- was charged with it — a send can never be charged or fee'd twice.

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS send_money_fee_percent numeric NOT NULL DEFAULT 2.5;

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

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount - v_fee;
  fee_amount := v_fee;
  RETURN NEXT;
END;
$$;

-- Only the service role (the atomic-transfer edge function) may
-- execute this — the same grant pattern as execute_atomic_transfer.
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_send_money_transfer(uuid, uuid, numeric, text, text, text, text, text, text) TO service_role;
