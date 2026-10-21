-- PayPal wallet-deposit completion: credit a deposit exactly once,
-- only against a verified PayPal capture.
--
-- Problem this fixes: `wallet-deposit` creates a real PayPal order and
-- records a PENDING deposit row (metadata.kind = 'wallet_deposit',
-- reference = PayPal order id), then credits nothing — correctly,
-- because an approved order is not captured money. But nothing ever
-- captured those orders, so every approved PayPal deposit sat pending
-- forever and no PayPal deposit could ever reach a wallet.
--
-- This migration adds complete_wallet_deposit(): the single
-- server-side completion path, called by the `paypal-deposit-capture`
-- edge function (user return flow) and the `paypal-webhook` deposit
-- backstop via _shared/paypal-deposit.ts. It runs SECURITY DEFINER,
-- service_role only, through a dedicated service-role client that
-- never forwards a caller JWT — the protect_wallet_balance trigger
-- silently neutralizes balance UPDATEs made under a user session (the
-- lesson recorded in 20261021_internal_transfer_service_path.sql).
--
-- Money rules enforced inside the function:
--   - The pending row is found by its PayPal order reference and
--     locked FOR UPDATE; the status transition pending -> completed
--     happens in the same transaction as the wallet credit, so two
--     racing completions (return flow + webhook) cannot double-credit.
--   - The captured amount and currency must match the recorded
--     deposit exactly (amount compared at 2dp); a mismatch changes
--     nothing and reports itself.
--   - A replay with the same capture id reports 'already_completed'
--     with the current balance and credits nothing.
--   - A capture id already consumed by a DIFFERENT deposit row also
--     reports 'already_completed' (defence in depth — one capture can
--     only ever fund one deposit).
--   - A frozen wallet may receive (receiving is not sending — same
--     rule as execute_internal_transfer); a closed wallet may not.
--   - The credited amount is the RECORDED deposit amount, which the
--     verification has just proven equal to the captured amount.
--   - Transaction identity is uuid_id (transactions.id is an INTEGER
--     PK; see 20261021_fix_transaction_id_returning.sql). The capture
--     id is stored in external_reference and metadata.capture_id.

CREATE OR REPLACE FUNCTION public.complete_wallet_deposit(
  p_order_id text,
  p_capture_id text,
  p_captured_amount numeric,
  p_captured_currency text
)
RETURNS TABLE(
  outcome text,
  transaction_id uuid,
  wallet_id uuid,
  credited_amount numeric,
  currency text,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.transactions;
  v_wallet public.wallets;
BEGIN
  IF p_order_id IS NULL OR length(p_order_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal order id is required';
  END IF;
  IF p_capture_id IS NULL OR length(p_capture_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal capture id is required';
  END IF;
  IF p_captured_amount IS NULL OR p_captured_amount <= 0 THEN
    RAISE EXCEPTION 'Captured amount must be greater than zero';
  END IF;
  IF p_captured_currency IS NULL OR length(p_captured_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid captured currency is required';
  END IF;

  -- Lock the deposit row: the status check and the credit below are
  -- one atomic unit, which is what makes completion exactly-once.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.reference = p_order_id
    AND t.payment_method = 'paypal'
    AND t.metadata ->> 'kind' = 'wallet_deposit'
  ORDER BY t.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  transaction_id := v_tx.uuid_id;
  wallet_id := v_tx.wallet_id;
  credited_amount := v_tx.amount;
  currency := v_tx.currency;

  IF v_tx.status = 'completed' THEN
    IF v_tx.external_reference = p_capture_id
       OR v_tx.metadata ->> 'capture_id' = p_capture_id THEN
      outcome := 'already_completed';
    ELSE
      outcome := 'conflict';
    END IF;
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Defence in depth: this capture already funded another deposit.
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.external_reference = p_capture_id
      AND t.status = 'completed'
      AND t.metadata ->> 'kind' = 'wallet_deposit'
      AND t.uuid_id <> v_tx.uuid_id
  ) THEN
    outcome := 'already_completed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_tx.status <> 'pending' THEN
    outcome := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Verify the capture against the recorded deposit. A mismatch is a
  -- hard stop: no state changes, no credit, the outcome names itself.
  IF round(p_captured_amount, 2) <> round(v_tx.amount, 2) THEN
    outcome := 'amount_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;
  IF upper(p_captured_currency) <> upper(v_tx.currency) THEN
    outcome := 'currency_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.id = v_tx.wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'wallet_not_found';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_wallet.status = 'closed' THEN
    outcome := 'wallet_closed';
    RETURN NEXT;
    RETURN;
  END IF;

  UPDATE public.wallets w
  SET balance = w.balance + v_tx.amount,
      updated_at = now()
  WHERE w.id = v_wallet.id
  RETURNING w.balance INTO new_balance;

  UPDATE public.transactions t
  SET status = 'completed',
      external_reference = p_capture_id,
      description = 'Wallet deposit via PayPal',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'capture_id', p_capture_id,
        'captured_amount', p_captured_amount,
        'captured_currency', upper(p_captured_currency),
        'captured_at', now()
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  outcome := 'credited';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_wallet_deposit(text, text, numeric, text) TO service_role;
