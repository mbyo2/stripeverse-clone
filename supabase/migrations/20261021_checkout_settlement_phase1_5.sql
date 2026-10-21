-- Checkout settlement + Phase 1.5: payment links settle into a chosen
-- account (the CEO gateway directive, 2026-10-21: every account is a
-- gateway account — payment links/checkout name a settlement account and
-- money received lands in that account's wallet of the payment currency).
--
-- Problems this fixes (completeness audit 2026-10-21, gaps #4 and #9):
--   1. payment_links had no settlement target: income could only ever
--      reach the owner's Main wallet — and in practice reached nobody,
--      because PublicCheckout settled against the *payer's* wallet via
--      the mock `process-payment` function.
--   2. There was no server-side settlement path for link payments at all:
--      the page updated payment_count/total_collected from the browser
--      (with overwritten, not accumulated, values, under an RLS policy
--      that only lets the owner write — so guest payments silently
--      failed to count).
--
-- This migration:
--   1. Adds payment_links.account_id (nullable; NULL = settle to Main).
--   2. Adds execute_payment_link_settlement(): the single server-side
--      settlement path. Runs SECURITY DEFINER, service_role only, and is
--      called by the `payment-link-checkout` edge function with a
--      dedicated service-role client (never the caller's JWT) — the
--      protect_wallet_balance trigger silently neutralizes balance
--      UPDATEs made under a user session, so browser-side or JWT-scoped
--      money movement writes ledger rows but moves nothing (the lesson
--      recorded in 20261021_internal_transfer_service_path.sql).
--
-- Money rules enforced inside the function:
--   - The link row is locked; link must be active, unexpired, and under
--     its max_payments cap; a fixed-amount link only settles its amount.
--   - The settlement wallet is the OWNER's wallet for the link currency
--     in the target account (account_id NULL = Main), created on demand
--     if the owner has no wallet in that currency/account yet.
--   - A closed target account cannot receive; a frozen one can (receiving
--     is not sending — same rule as execute_internal_transfer).
--   - Wallet payments (payer_user_id given): the payer's Main wallet in
--     the link currency is debited in the same transaction; the payer
--     cannot be the link owner; balance must cover the amount.
--   - External payments (payer_user_id NULL): credit-only — the money
--     arrived through a gateway, only the owner's leg is ledgered.
--   - Two ledger rows for wallet payments (payer outgoing / owner
--     incoming), one for external; keys are <key> and <key>:in on the
--     transactions.idempotency_key unique index, so a replayed request
--     returns the original result and never moves money twice.
--   - payment_count / total_collected are accumulated inside the same
--     transaction — the browser no longer writes counters.
--   - Transaction identity is uuid_id (transactions.id is an INTEGER PK;
--     see 20261021_fix_transaction_id_returning.sql).
--   - No fee is taken on link settlement.

-- ── 1. Settlement target on payment_links ────────────────────────────────
ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS account_id UUID
  REFERENCES public.accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_links_account
  ON public.payment_links (account_id);

-- ── 2. Settlement function ───────────────────────────────────────────────
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

  transaction_id := COALESCE(v_payer_tx, v_owner_tx);
  owner_transaction_id := v_owner_tx;
  owner_new_balance := v_owner_wallet.balance + p_amount;
  RETURN NEXT;
END;
$$;

-- Only the service role (the payment-link-checkout edge function) may
-- execute this — the same grant pattern as the other money functions.
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_settlement(uuid, uuid, numeric, text, text, text) TO service_role;
