-- =====================================================================
-- 20261023_settle_escrow_currency_fix.sql — hotfix for settle_escrow.
--
-- Live proof 2026-10-23 (Phase 3 re-proof F3): a real funded escrow
-- failed settlement with Postgres 42702 'column reference "currency"
-- is ambiguous' — the function's OUT parameter `currency` (RETURNS
-- TABLE) collides with the unqualified `currency` column reference in
-- the recipient-wallet lookup. The forged-'funded' attack was still
-- refused correctly; only the happy path was blocked.
--
-- Fix: qualify the wallet lookup with table alias w (w.currency etc.)
-- and FOR UPDATE OF w. NOTHING else changes — the body below is the
-- 20261023_p0_remediation.sql definition verbatim apart from that one
-- statement. The trailing REVOKE/GRANT is restated idempotently.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.settle_escrow(
  p_escrow_id uuid,
  p_action text,
  p_actor_id uuid
)
RETURNS TABLE (transaction_id uuid, recipient_id uuid,
               amount numeric, currency text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_escrow public.escrow_transactions%ROWTYPE;
  v_recipient uuid;
  v_wallet_id uuid;
  v_tx_id uuid;
BEGIN
  IF p_action NOT IN ('release', 'refund') THEN
    RAISE EXCEPTION 'Invalid escrow action';
  END IF;

  SELECT * INTO v_escrow
  FROM public.escrow_transactions
  WHERE id = p_escrow_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow not found';
  END IF;
  IF v_escrow.buyer_id <> p_actor_id THEN
    RAISE EXCEPTION 'Only the buyer can settle this escrow';
  END IF;
  IF v_escrow.status <> 'funded' THEN
    RAISE EXCEPTION 'Escrow must be funded to settle (current: %)',
      v_escrow.status;
  END IF;

  -- The funded flag alone is not proof: require the real hold —
  -- a completed outgoing 'escrow_hold' ledger entry from the buyer
  -- for exactly this amount, referencing this escrow.
  IF NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.reference::text = v_escrow.id::text
      AND t.category = 'escrow_hold'
      AND t.direction = 'outgoing'
      AND t.user_id = v_escrow.buyer_id
      AND t.status = 'completed'
      AND t.amount = v_escrow.amount
  ) THEN
    RAISE EXCEPTION 'No completed hold found for this escrow';
  END IF;

  v_recipient := CASE WHEN p_action = 'release'
                      THEN v_escrow.seller_id ELSE v_escrow.buyer_id END;

  -- Atomic claim: flip funded -> released/refunded in the same
  -- transaction as the credit. The row is already locked FOR UPDATE;
  -- the status guard is belt-and-braces. A second settle call now
  -- fails the status check above instead of crediting again.
  UPDATE public.escrow_transactions
  SET status = CASE WHEN p_action = 'release' THEN 'released'
                    ELSE 'refunded' END,
      released_at  = CASE WHEN p_action = 'release' THEN now()
                          ELSE released_at END,
      cancelled_at = CASE WHEN p_action = 'refund' THEN now()
                          ELSE cancelled_at END,
      updated_at = now()
  WHERE id = v_escrow.id AND status = 'funded';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow already settled';
  END IF;

  -- Credit the recipient's MAIN wallet (account_id IS NULL — the
  -- wallet-scope lesson of the atomic-transfer fix). Direct locked
  -- update, mirroring execute_savings_transfer; if the recipient has
  -- no Main wallet in this currency yet, create it at the credited
  -- amount (the only legitimate way a wallet is born funded is with
  -- real money attached, as here).
  SELECT w.id INTO v_wallet_id
  FROM public.wallets w
  WHERE w.user_id = v_recipient
    AND w.currency = v_escrow.currency
    AND w.account_id IS NULL
  FOR UPDATE OF w;
  IF v_wallet_id IS NULL THEN
    INSERT INTO public.wallets (user_id, balance, currency, status)
    VALUES (v_recipient, v_escrow.amount, v_escrow.currency, 'active')
    RETURNING id INTO v_wallet_id;
  ELSE
    UPDATE public.wallets
    SET balance = balance + v_escrow.amount, updated_at = now()
    WHERE id = v_wallet_id;
  END IF;

  -- Ledger entry, same shape escrow-settle writes today.
  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, description, reference, category, idempotency_key)
  VALUES
    (v_recipient, v_wallet_id, v_escrow.amount, v_escrow.currency,
     'incoming', 'wallet', 'completed',
     CASE WHEN p_action = 'release' THEN 'Escrow released: '
          ELSE 'Escrow refunded: ' END
       || COALESCE(v_escrow.description, v_escrow.id::text),
     v_escrow.id::text,
     CASE WHEN p_action = 'release' THEN 'escrow_release'
          ELSE 'escrow_refund' END,
     'escrow-' || p_action || '-' || v_escrow.id::text)
  RETURNING uuid_id INTO v_tx_id;

  UPDATE public.escrow_transactions
  SET settlement_transaction_id = v_tx_id
  WHERE id = v_escrow.id;

  transaction_id := v_tx_id;
  recipient_id := v_recipient;
  amount := v_escrow.amount;
  currency := v_escrow.currency;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_escrow(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_escrow(uuid, text, uuid)
  TO service_role;
