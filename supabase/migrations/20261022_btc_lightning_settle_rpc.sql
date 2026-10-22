-- Custodial Lightning deposit settlement: claim + credit in ONE
-- transaction (exactly-once).
--
-- Problem this fixes: breez-lightning's check_status settled a paid
-- inbound invoice in separate, non-atomic steps — first a conditional
-- UPDATE flipping lightning_payments pending -> paid (the "claim"),
-- then the btc_adjust_crypto_wallet RPC, then the ledger insert. If
-- the process was hard-stopped BETWEEN the claim commit and the
-- credit, the row stayed 'paid' uncredited, and every later poll
-- early-returned at the status check — the user's sats were stranded
-- with no safe retry (a naive retry could double-credit a different
-- failure shape). Exactly-once cannot be built from separate calls.
--
-- This migration adds btc_settle_lightning_deposit(): the single
-- server-side settlement path, called by breez-lightning's
-- check_status through a dedicated service-role client. It follows
-- the complete_wallet_deposit pattern
-- (supabase/migrations/20261021_complete_wallet_deposit.sql):
-- SECURITY DEFINER, service_role only, the row locked
-- FOR UPDATE, and the status transition in the SAME transaction as
-- the wallet credit — so a crash anywhere rolls the whole settlement
-- back to 'pending' and the next poll retries the complete unit.
--
-- Money rules enforced inside the function:
--   - Only 'inbound' payments can settle here; outbound payments are
--     settled by the pay path, never by a poll.
--   - A 'paid' row reports 'already_settled' and credits nothing —
--     replays and concurrent polls are safe.
--   - Any other terminal status reports 'not_pending'.
--   - The credited amount is the RECORDED amount_sats on the payment
--     row (fixed at invoice creation), never a caller-supplied value.
--   - The credit reuses btc_adjust_crypto_wallet (row-locked,
--     non-negative, creates the wallet row on demand) — so balance
--     and available move exactly as every other BTC credit does.
--   - The activity-feed ledger row is written in the same transaction
--     under idempotency_key 'ln-in:<payment_id>' (unique index), so
--     it can never duplicate either.

CREATE OR REPLACE FUNCTION public.btc_settle_lightning_deposit(
  p_payment_id uuid
)
RETURNS TABLE(
  outcome text,
  payment_status text,
  amount_sats bigint,
  new_balance_sats bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_payment public.lightning_payments;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'A lightning payment id is required';
  END IF;

  -- Lock the payment row: the status check, the transition and the
  -- credit below are one atomic unit, which is what makes settlement
  -- exactly-once. Two racing polls serialize here; the loser sees
  -- 'paid' and reports 'already_settled'.
  SELECT lp.* INTO v_payment
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    outcome := 'not_found';
    payment_status := NULL;
    amount_sats := NULL;
    new_balance_sats := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  payment_status := v_payment.status;
  amount_sats := v_payment.amount_sats;

  SELECT w.balance_sats INTO new_balance_sats
  FROM public.crypto_wallets w
  WHERE w.user_id = v_payment.user_id AND w.asset = 'BTC';

  IF v_payment.direction <> 'inbound' THEN
    outcome := 'not_inbound';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_payment.status = 'paid' THEN
    outcome := 'already_settled';
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_payment.status <> 'pending' THEN
    outcome := 'not_pending';
    RETURN NEXT;
    RETURN;
  END IF;

  -- Claim and credit, atomically: any failure from here rolls the
  -- status back to 'pending' with the rest of the transaction, so the
  -- next poll retries the whole settlement — never half of it.
  UPDATE public.lightning_payments lp
  SET status = 'paid',
      settled_at = now()
  WHERE lp.id = v_payment.id;

  PERFORM public.btc_adjust_crypto_wallet(
    v_payment.user_id,
    v_payment.amount_sats,
    v_payment.amount_sats
  );

  INSERT INTO public.transactions
    (user_id, currency, amount, direction, payment_method, status,
     description, reference, category, transaction_id, idempotency_key,
     metadata)
  VALUES
    (v_payment.user_id, 'BTC',
     v_payment.amount_sats::numeric / 100000000, 'incoming', 'lightning',
     'completed', 'Lightning deposit', v_payment.payment_hash,
     'lightning_deposit',
     COALESCE(v_payment.payment_hash, 'ln-in-' || v_payment.id::text),
     'ln-in:' || v_payment.id::text,
     jsonb_build_object('type', 'lightning_deposit',
                        'sats', v_payment.amount_sats))
  ON CONFLICT (idempotency_key) DO NOTHING;

  SELECT w.balance_sats INTO new_balance_sats
  FROM public.crypto_wallets w
  WHERE w.user_id = v_payment.user_id AND w.asset = 'BTC';

  outcome := 'credited';
  payment_status := 'paid';
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.btc_settle_lightning_deposit(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_settle_lightning_deposit(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.btc_settle_lightning_deposit(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.btc_settle_lightning_deposit(uuid) TO service_role;
