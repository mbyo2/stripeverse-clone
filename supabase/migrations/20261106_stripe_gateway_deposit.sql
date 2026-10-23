-- Stripe gateway wallet top-ups: exactly-once credit of a verified
-- Stripe Checkout payment, plus the rail's kill switch.
--
-- The gateway-expansion build (brief §3) mirrors the proven PayPal
-- deposit rail one-to-one:
--   - `stripe-gateway-checkout` records a PENDING ledger row
--     (transactions, payment_method 'stripe', metadata.kind =
--     'wallet_deposit', reference = Checkout Session id) and credits
--     nothing.
--   - `stripe-gateway-webhook` treats events as hints, re-queries
--     the session from Stripe, and settles only a 'paid' session via
--     complete_stripe_wallet_deposit() below — modelled line-by-line
--     on complete_wallet_deposit (20261021, provenance hooks added
--     20261028): row locked FOR UPDATE, pending -> completed in the
--     same transaction as the credit, replay with the same session
--     id reports 'already_completed', a session id consumed by a
--     DIFFERENT deposit also reports 'already_completed', amount and
--     currency verified at 2dp against the recorded row, a frozen
--     wallet may receive, a closed wallet may not.
--   - Transaction identity is uuid_id (transactions.id is an INTEGER
--     PK). The session id is stored in external_reference and
--     metadata.session_id; the PaymentIntent id lands in
--     metadata.payment_intent_id (charge.refunded reconciliation
--     keys off it).
--
-- PROVENANCE: a verified Stripe capture creates the external-money
-- mark through the SAME helper a verified PayPal capture uses
-- (paypal_taint_credit into paypal_provenance_balances) — brief
-- §3.1: "provenance follows the money exactly as with PayPal-sourced
-- funds". Consequence, stated plainly: the counter's meaning widens
-- from "PayPal-paid-in" to "verified external money paid in", so
-- Stripe-sourced money counts toward the provenance cap that gates
-- PayPal withdrawals. The platform invariant survives — marks are
-- created ONLY by verified external captures (PayPal or Stripe),
-- move spent-first, and are consumed 1:1 by payouts, so total
-- payouts can never exceed total verified external money in. If
-- Finance later wants per-rail counters, the change is this one
-- PERFORM plus a sibling counter; the shared counter is the brief's
-- specified behaviour today.
--
-- KILL SWITCH: platform_settings.stripe_gateway_enabled, in the
-- style of p2p_enabled (20261023). Default TRUE — unlike the paused
-- marketplace, this rail is already dark until STRIPE_GATEWAY_SECRET_KEY
-- exists and is role-gated to admin/super_admin besides; the flag
-- exists so the rail can be switched off instantly without a
-- redeploy. The checkout function refuses with a crafted
-- not_configured response while it is false.
--
-- This function runs SECURITY DEFINER, service_role only, through a
-- dedicated service-role client that never forwards a caller JWT —
-- the protect_wallet_balance trigger silently neutralizes balance
-- UPDATEs made under a user session (the lesson recorded in
-- 20261021_internal_transfer_service_path.sql).

-- ── Kill switch ──────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS stripe_gateway_enabled boolean NOT NULL DEFAULT true;

-- ── Exactly-once Stripe deposit completion ───────────────────────────
CREATE OR REPLACE FUNCTION public.complete_stripe_wallet_deposit(
  p_session_id text,
  p_payment_intent_id text,
  p_paid_amount numeric,
  p_paid_currency text
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
  IF p_session_id IS NULL OR length(p_session_id) < 6 THEN
    RAISE EXCEPTION 'A valid Stripe session id is required';
  END IF;
  IF p_paid_amount IS NULL OR p_paid_amount <= 0 THEN
    RAISE EXCEPTION 'Paid amount must be greater than zero';
  END IF;
  IF p_paid_currency IS NULL OR length(p_paid_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid paid currency is required';
  END IF;

  -- Lock the deposit row: the status check and the credit below are
  -- one atomic unit, which is what makes completion exactly-once.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.reference = p_session_id
    AND t.payment_method = 'stripe'
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
    IF v_tx.external_reference = p_session_id
       OR v_tx.metadata ->> 'session_id' = p_session_id THEN
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

  -- Defence in depth: this session already funded another deposit.
  IF EXISTS (
    SELECT 1
    FROM public.transactions t
    WHERE t.external_reference = p_session_id
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

  -- Verify the re-queried session against the recorded deposit. A
  -- mismatch is a hard stop: no state changes, no credit, the
  -- outcome names itself.
  IF round(p_paid_amount, 2) <> round(v_tx.amount, 2) THEN
    outcome := 'amount_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;
  IF upper(p_paid_currency) <> upper(v_tx.currency) THEN
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
      external_reference = p_session_id,
      description = 'Wallet deposit via Stripe',
      metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'session_id', p_session_id,
        'payment_intent_id', p_payment_intent_id,
        'paid_amount', p_paid_amount,
        'paid_currency', upper(p_paid_currency),
        'paid_at', now()
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  -- Provenance: a verified Stripe capture creates the external-money
  -- mark, exactly as a verified PayPal capture does (20261028) —
  -- this credit is what makes the money count toward provenance-
  -- gated withdrawals, and the mark follows the money from here.
  -- Only on the credited path: replays report 'already_completed'
  -- above and create none.
  PERFORM public.paypal_taint_credit(v_tx.user_id, v_tx.currency, v_tx.amount);

  outcome := 'credited';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_stripe_wallet_deposit(text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_stripe_wallet_deposit(text, text, numeric, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.complete_stripe_wallet_deposit(text, text, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_stripe_wallet_deposit(text, text, numeric, text) TO service_role;
