-- 20261204_invoice_request_settlement.sql
-- Final-QA FIX-2: invoices and payment requests were unpayable.
-- merchant_invoices.payment_link_code / payment_requests.payment_link_code
-- are NOT payment_links rows, so /pay/:code 404'd on them, no function
-- settled either, and flipping invoice status by hand moved zero money.
--
-- This migration builds the missing settlement leg, mirroring the
-- payment-link rail's safety pattern (row lock, exactly-once status
-- flip in the same transaction as the money, ledger rows both sides,
-- PayPal provenance follows the money):
--
--   * execute_invoice_settlement(p_invoice_id, p_payer_user_id,
--     p_idempotency_key) — payer pays the FULL invoice total, issuer
--     receives the FULL total. NO platform fee: no fee was ever set
--     or disclosed for invoices (the escrow precedent moves full
--     principal the same way).
--   * execute_payment_request_settlement(p_request_id, ...) — same
--     shape for payment_requests (full amount, exactly once).
--
-- Both: invoice/request row locked FOR UPDATE; status must be payable
-- (invoice: draft/sent/pending — paid/cancelled/expired refused with
-- 'already paid' / 'no longer payable' plain language); payer must not
-- be the issuer/requester; amount re-validated whole-ngwee (FIX-1);
-- payer Main wallet (invoice currency) debited, recipient Main wallet
-- credited (created on demand); status flipped to 'paid' with paid_at
-- (+ paid_by / transaction references) in the SAME transaction, so a
-- second pay — any key — sees 'paid' and refuses. Money never moves
-- twice for one invoice/request.
--
-- merchant_invoices gains the payer/transaction columns it never had
-- (paid_by, transaction_id = payer's outgoing ledger row,
-- payer_transaction_id is NOT used; issuer_transaction_id = issuer's
-- incoming ledger row).
--
-- ACL: CREATE OR REPLACE would grant default PUBLIC execute on first
-- creation, so both functions are explicitly revoked down to
-- service_role only (paymentgetway lesson, 2026-10-23).

ALTER TABLE public.merchant_invoices
  ADD COLUMN IF NOT EXISTS paid_by UUID;
ALTER TABLE public.merchant_invoices
  ADD COLUMN IF NOT EXISTS transaction_id UUID;
ALTER TABLE public.merchant_invoices
  ADD COLUMN IF NOT EXISTS issuer_transaction_id UUID;

CREATE OR REPLACE FUNCTION public.execute_invoice_settlement(
  p_invoice_id UUID,
  p_payer_user_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(
  transaction_id UUID,
  issuer_transaction_id UUID,
  payer_new_balance NUMERIC,
  issuer_new_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice public.merchant_invoices%ROWTYPE;
  v_payer_wallet public.wallets%ROWTYPE;
  v_issuer_wallet public.wallets%ROWTYPE;
  v_amount NUMERIC;
  v_payer_tx UUID;
  v_issuer_tx UUID;
  v_issuer_name TEXT;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Lock the invoice: serializes payment attempts per invoice.
  SELECT * INTO v_invoice FROM public.merchant_invoices
  WHERE id = p_invoice_id FOR UPDATE;
  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- Exactly once: a paid invoice refuses every later attempt.
  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'This invoice has already been paid.';
  END IF;
  IF v_invoice.status NOT IN ('draft', 'sent', 'pending') THEN
    RAISE EXCEPTION 'This invoice is no longer payable.';
  END IF;

  IF p_payer_user_id = v_invoice.merchant_id THEN
    RAISE EXCEPTION 'You cannot pay your own invoice.';
  END IF;

  v_amount := v_invoice.total_amount;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero.';
  END IF;
  IF v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;

  -- Payer's Main wallet in the invoice currency.
  SELECT * INTO v_payer_wallet FROM public.wallets
  WHERE user_id = p_payer_user_id
    AND currency = v_invoice.currency
    AND account_id IS NULL
  FOR UPDATE;
  IF v_payer_wallet.id IS NULL THEN
    RAISE EXCEPTION 'No wallet found for this payment. Add funds to your wallet first.';
  END IF;
  IF v_payer_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Your wallet is not active right now.';
  END IF;
  IF v_payer_wallet.balance < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %',
      v_payer_wallet.balance, v_amount;
  END IF;

  -- Issuer's Main wallet in the invoice currency, created on demand.
  SELECT * INTO v_issuer_wallet FROM public.wallets
  WHERE user_id = v_invoice.merchant_id
    AND currency = v_invoice.currency
    AND account_id IS NULL
  FOR UPDATE;
  IF v_issuer_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
    VALUES (v_invoice.merchant_id, NULL, v_invoice.currency, 0, 'active')
    RETURNING * INTO v_issuer_wallet;
  END IF;
  IF v_issuer_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'The invoice issuer cannot receive payments right now.';
  END IF;

  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_issuer_name
  FROM public.profiles p WHERE p.id = v_invoice.merchant_id;

  -- Move the FULL total (no platform fee on invoices).
  UPDATE public.wallets
  SET balance = balance - v_amount, updated_at = now()
  WHERE id = v_payer_wallet.id;
  UPDATE public.wallets
  SET balance = balance + v_amount, updated_at = now()
  WHERE id = v_issuer_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_payer_user_id, v_payer_wallet.id, v_amount, v_invoice.currency,
     'outgoing', 'wallet', 'completed', v_issuer_name,
     'Invoice payment: ' || v_invoice.invoice_number,
     'invoice:' || v_invoice.id::text, 'invoice_payment', p_idempotency_key)
  RETURNING uuid_id INTO v_payer_tx;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_invoice.merchant_id, v_issuer_wallet.id, v_amount, v_invoice.currency,
     'incoming', 'wallet', 'completed',
     'Invoice payment: ' || v_invoice.invoice_number,
     'invoice:' || v_invoice.id::text, 'invoice_payment', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_issuer_tx;

  -- Flip to paid in the same transaction as the money.
  UPDATE public.merchant_invoices
  SET status = 'paid',
      paid_at = now(),
      paid_by = p_payer_user_id,
      transaction_id = v_payer_tx,
      issuer_transaction_id = v_issuer_tx,
      updated_at = now()
  WHERE id = v_invoice.id;

  -- Provenance: the mark follows the money (generic-path pattern).
  PERFORM public.paypal_taint_move(
    p_payer_user_id, v_invoice.merchant_id, v_invoice.currency, v_amount);

  transaction_id := v_payer_tx;
  issuer_transaction_id := v_issuer_tx;
  payer_new_balance := v_payer_wallet.balance - v_amount;
  issuer_new_balance := v_issuer_wallet.balance + v_amount;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_invoice_settlement(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_invoice_settlement(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.execute_invoice_settlement(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_invoice_settlement(UUID, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.execute_payment_request_settlement(
  p_request_id UUID,
  p_payer_user_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(
  transaction_id UUID,
  requester_transaction_id UUID,
  payer_new_balance NUMERIC,
  requester_new_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.payment_requests%ROWTYPE;
  v_payer_wallet public.wallets%ROWTYPE;
  v_requester_wallet public.wallets%ROWTYPE;
  v_amount NUMERIC;
  v_payer_tx UUID;
  v_requester_tx UUID;
  v_requester_name TEXT;
BEGIN
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'A valid idempotency key is required';
  END IF;

  -- Lock the request: serializes payment attempts per request.
  SELECT * INTO v_request FROM public.payment_requests
  WHERE id = p_request_id FOR UPDATE;
  IF v_request.id IS NULL THEN
    RAISE EXCEPTION 'Payment request not found';
  END IF;

  -- Exactly once: a paid request refuses every later attempt.
  IF v_request.status = 'paid' THEN
    RAISE EXCEPTION 'This payment request has already been paid.';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'This payment request is no longer payable.';
  END IF;
  IF v_request.expires_at IS NOT NULL AND v_request.expires_at <= now() THEN
    RAISE EXCEPTION 'This payment request has expired.';
  END IF;

  IF p_payer_user_id = v_request.requester_id THEN
    RAISE EXCEPTION 'You cannot pay your own payment request.';
  END IF;

  v_amount := v_request.amount;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero.';
  END IF;
  IF v_amount <> round(v_amount, 2) THEN
    RAISE EXCEPTION 'Amounts must be in whole ngwee — no more than two decimal places';
  END IF;

  -- Payer's Main wallet in the request currency.
  SELECT * INTO v_payer_wallet FROM public.wallets
  WHERE user_id = p_payer_user_id
    AND currency = v_request.currency
    AND account_id IS NULL
  FOR UPDATE;
  IF v_payer_wallet.id IS NULL THEN
    RAISE EXCEPTION 'No wallet found for this payment. Add funds to your wallet first.';
  END IF;
  IF v_payer_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'Your wallet is not active right now.';
  END IF;
  IF v_payer_wallet.balance < v_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %',
      v_payer_wallet.balance, v_amount;
  END IF;

  -- Requester's Main wallet in the request currency, on demand.
  SELECT * INTO v_requester_wallet FROM public.wallets
  WHERE user_id = v_request.requester_id
    AND currency = v_request.currency
    AND account_id IS NULL
  FOR UPDATE;
  IF v_requester_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, account_id, currency, balance, status)
    VALUES (v_request.requester_id, NULL, v_request.currency, 0, 'active')
    RETURNING * INTO v_requester_wallet;
  END IF;
  IF v_requester_wallet.status <> 'active' THEN
    RAISE EXCEPTION 'The requester cannot receive payments right now.';
  END IF;

  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_requester_name
  FROM public.profiles p WHERE p.id = v_request.requester_id;

  -- Move the FULL amount (no platform fee on payment requests).
  UPDATE public.wallets
  SET balance = balance - v_amount, updated_at = now()
  WHERE id = v_payer_wallet.id;
  UPDATE public.wallets
  SET balance = balance + v_amount, updated_at = now()
  WHERE id = v_requester_wallet.id;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_payer_user_id, v_payer_wallet.id, v_amount, v_request.currency,
     'outgoing', 'wallet', 'completed', v_requester_name,
     COALESCE(v_request.description, 'Payment request'),
     'request:' || v_request.id::text, 'payment_request', p_idempotency_key)
  RETURNING uuid_id INTO v_payer_tx;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_request.requester_id, v_requester_wallet.id, v_amount, v_request.currency,
     'incoming', 'wallet', 'completed',
     COALESCE(v_request.description, 'Payment request'),
     'request:' || v_request.id::text, 'payment_request', p_idempotency_key || ':in')
  RETURNING uuid_id INTO v_requester_tx;

  -- Flip to paid in the same transaction as the money.
  UPDATE public.payment_requests
  SET status = 'paid',
      paid_at = now(),
      paid_by = p_payer_user_id,
      transaction_id = v_payer_tx,
      updated_at = now()
  WHERE id = v_request.id;

  -- Provenance: the mark follows the money (generic-path pattern).
  PERFORM public.paypal_taint_move(
    p_payer_user_id, v_request.requester_id, v_request.currency, v_amount);

  transaction_id := v_payer_tx;
  requester_transaction_id := v_requester_tx;
  payer_new_balance := v_payer_wallet.balance - v_amount;
  requester_new_balance := v_requester_wallet.balance + v_amount;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_payment_request_settlement(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_payment_request_settlement(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.execute_payment_request_settlement(UUID, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.execute_payment_request_settlement(UUID, UUID, TEXT) TO service_role;
