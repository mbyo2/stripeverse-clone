-- 20261226 — PayPal capture reversals + subscription billing catalogue
-- (provider-connections audit D2 + D4, 2026-10-26).
--
-- D2: until now, nothing reconciled a PayPal refund / reversal /
-- denial of a capture that had already credited a wallet here: the
-- webhook had no cases for PAYMENT.CAPTURE.REFUNDED / .REVERSED /
-- .DENIED / .PENDING or CHECKOUT.PAYMENT-APPROVAL.REVERSED, and no
-- code called the captures/refunds API — so money PayPal clawed
-- back stayed credited locally. reverse_paypal_credit below is the
-- exactly-once reversal counterpart of complete_wallet_deposit /
-- complete_checkout_payment (20261021 / 20261022, provenance hooks
-- 20261028): row-locked, keyed per reversal unit, clamped at the
-- credited amount, and symmetric on provenance (the mark the
-- capture created is debited back, clamped by paypal_taint_debit).
--
-- This migration does NOT touch reserve_paypal_withdrawal /
-- refund_paypal_withdrawal: their 20261213 float bodies remain the
-- only correct base for those two functions.
--
-- D4: paypal_billing_plans is the platform's PayPal billing
-- catalogue — one row per (tier, currency, amount) price point,
-- holding the REAL PayPal plan id (P-…) minted once for that price
-- point, so a checkout reuses the plan instead of minting a new one
-- per subscriber (plans are immutable price points at PayPal; a new
-- row is created only when the price itself changes). The single
-- PayPal product the plans belong to is recorded once in
-- platform_settings.paypal_subscription_product_id.

-- ── reverse_paypal_credit ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.reverse_paypal_credit(
  p_capture_id text,
  p_reversal_key text,
  p_target_amount numeric,
  p_currency text,
  p_event_type text
)
RETURNS TABLE(
  outcome text,
  transaction_id uuid,
  wallet_id uuid,
  debited_amount numeric,
  reversed_total numeric,
  new_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx public.transactions;
  v_wallet public.wallets;
  v_applied jsonb;
  v_already numeric := 0;
  v_delta numeric := 0;
  v_debit numeric := 0;
  v_shortfall numeric := 0;
BEGIN
  IF p_capture_id IS NULL OR length(p_capture_id) < 6 THEN
    RAISE EXCEPTION 'A valid PayPal capture id is required';
  END IF;
  IF p_reversal_key IS NULL OR length(p_reversal_key) < 4 THEN
    RAISE EXCEPTION 'A reversal key is required';
  END IF;
  IF p_target_amount IS NULL OR p_target_amount <= 0 THEN
    RAISE EXCEPTION 'Reversal target must be greater than zero';
  END IF;
  IF p_currency IS NULL OR length(p_currency) <> 3 THEN
    RAISE EXCEPTION 'A valid currency is required';
  END IF;

  -- Lock the credited row: the key check, the totals and the debit
  -- below are one atomic unit, which is what makes reversal
  -- exactly-once under webhook replays and races.
  SELECT t.* INTO v_tx
  FROM public.transactions t
  WHERE t.payment_method = 'paypal'
    AND t.metadata ->> 'kind' IN ('wallet_deposit', 'checkout_payment')
    AND (t.external_reference = p_capture_id
         OR t.metadata ->> 'capture_id' = p_capture_id)
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
  reversed_total := COALESCE((v_tx.metadata ->> 'reversal_total')::numeric, 0);

  IF upper(p_currency) <> upper(v_tx.currency) THEN
    outcome := 'currency_mismatch';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Only a row that actually credited can be reversed. A pending or
  -- failed row means the capture never put money here: changing
  -- nothing is the correct reconciliation. (A credited row keeps
  -- status 'completed' even when fully reversed — see the metadata
  -- note at the update below.)
  IF v_tx.status <> 'completed' THEN
    outcome := 'not_credited';
    RETURN NEXT;
    RETURN;
  END IF;

  v_applied := COALESCE(v_tx.metadata -> 'reversals', '[]'::jsonb);
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_applied) e
    WHERE e ->> 'key' = p_reversal_key
  ) THEN
    outcome := 'already_reversed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- p_target_amount is the CUMULATIVE total that should stand
  -- reversed for this capture; the delta is what this event still
  -- owes. Capped at the credited amount by construction.
  v_already := reversed_total;
  v_delta := LEAST(round(p_target_amount, 2), round(v_tx.amount, 2)) - v_already;
  IF v_delta <= 0 THEN
    outcome := 'already_reversed';
    SELECT w.balance INTO new_balance
    FROM public.wallets w
    WHERE w.id = v_tx.wallet_id;
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

  -- wallets.balance is CHECK-constrained non-negative: if the user
  -- already spent the credited money, debit what is actually there
  -- and record the remainder as a shortfall for operations
  -- follow-up — never a silent negative balance, and never a reason
  -- to lose the reversal record itself.
  v_debit := LEAST(v_delta, v_wallet.balance);
  v_shortfall := v_delta - v_debit;

  IF v_debit > 0 THEN
    UPDATE public.wallets w
    SET balance = w.balance - v_debit,
        updated_at = now()
    WHERE w.id = v_wallet.id
    RETURNING w.balance INTO new_balance;
  ELSE
    new_balance := v_wallet.balance;
  END IF;

  -- Provenance symmetry (20261028): the capture created a mark;
  -- reversing the credit debits the mark back. paypal_taint_debit
  -- clamps at the mark that remains (it may have moved on with the
  -- money), exactly as every other mark consumer behaves.
  PERFORM public.paypal_taint_debit(v_tx.user_id, v_tx.currency, v_delta);

  reversed_total := v_already + v_delta;
  debited_amount := v_debit;

  -- The row's status stays 'completed': transactions_status_check
  -- admits only pending / completed / failed, and the capture DID
  -- complete — the reversal is recorded in metadata (reversal_total
  -- + the reversals ledger), the same place capture_id lives, and
  -- the wallet debit above is the money truth.
  UPDATE public.transactions t
  SET metadata = COALESCE(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'reversal_total', reversed_total,
        'reversals', v_applied || jsonb_build_array(jsonb_build_object(
          'key', p_reversal_key,
          'event_type', p_event_type,
          'amount', v_delta,
          'debited', v_debit,
          'shortfall', v_shortfall,
          'at', now()
        ))
      ),
      updated_at = now()
  WHERE t.uuid_id = v_tx.uuid_id;

  outcome := CASE
    WHEN v_shortfall > 0 THEN 'reversed_with_shortfall'
    ELSE 'reversed'
  END;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_paypal_credit(text, text, numeric, text, text) TO service_role;

-- ── PayPal billing catalogue (D4) ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.paypal_billing_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL,
  currency text NOT NULL,
  amount numeric NOT NULL,
  product_id text NOT NULL,
  plan_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier, currency, amount)
);
ALTER TABLE public.paypal_billing_plans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.paypal_billing_plans FROM PUBLIC;
REVOKE ALL ON TABLE public.paypal_billing_plans FROM anon;
REVOKE ALL ON TABLE public.paypal_billing_plans FROM authenticated;
GRANT ALL ON TABLE public.paypal_billing_plans TO service_role;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS paypal_subscription_product_id text;
