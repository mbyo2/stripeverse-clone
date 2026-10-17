-- Core money-movement foundation: atomic transfers with idempotency.
--
-- Problem: every money flow did client-side table writes with no server-side
-- settlement. This migration adds:
--   1. idempotency_key on transactions (prevents double-processing)
--   2. wallets table (if not exists — defined here as source of truth)
--   3. execute_atomic_transfer() SECURITY DEFINER function that moves money
--      atomically with row-level locking.

-- ── wallets table (source of truth; live DB already has it via Lovable) ──
CREATE TABLE IF NOT EXISTS public.wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  balance NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own wallets" ON public.wallets;
CREATE POLICY "Users view own wallets"
ON public.wallets FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users create own wallets" ON public.wallets;
CREATE POLICY "Users create own wallets"
ON public.wallets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- ── idempotency on transactions ──
ALTER TABLE public.transactions
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
ON public.transactions (idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- ── Atomic transfer function ──
-- Moves funds from one user's wallet to another's (or to an external
-- recipient when to_user_id is NULL, e.g. bill payments) in a single
-- transaction with row locking. Called by the atomic-transfer edge function.
CREATE OR REPLACE FUNCTION public.execute_atomic_transfer(
  p_from_user_id UUID,
  p_to_user_id UUID,          -- NULL for external/biller payments
  p_amount NUMERIC,
  p_currency TEXT,
  p_reference_type TEXT,      -- 'transfer' | 'bill_payment' | 'escrow' | 'refund' | ...
  p_reference_id TEXT,        -- id linking to the source record
  p_idempotency_key TEXT,
  p_description TEXT DEFAULT NULL,
  p_recipient_name TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'wallet'
)
RETURNS TABLE(transaction_id UUID, new_sender_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_wallet_id UUID;
  v_sender_balance NUMERIC;
  v_recipient_wallet_id UUID;
  v_existing_id UUID;
  v_tx_id UUID;
BEGIN
  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  -- Idempotency: if this key was already processed, return the original result
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.id INTO v_existing_id
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.direction = 'outgoing'
    LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      SELECT t.id, w.balance INTO v_tx_id, v_sender_balance
      FROM public.transactions t
      JOIN public.wallets w ON w.user_id = t.user_id AND w.currency = t.currency
      WHERE t.id = v_existing_id;
      transaction_id := v_tx_id;
      new_sender_balance := v_sender_balance;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Lock sender wallet row
  SELECT w.id, w.balance INTO v_sender_wallet_id, v_sender_balance
  FROM public.wallets w
  WHERE w.user_id = p_from_user_id AND w.currency = p_currency
  FOR UPDATE;

  IF v_sender_wallet_id IS NULL THEN
    RAISE EXCEPTION 'Sender wallet not found for currency %', p_currency;
  END IF;

  IF v_sender_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: have %, need %', v_sender_balance, p_amount;
  END IF;

  -- Debit sender
  UPDATE public.wallets
  SET balance = balance - p_amount, updated_at = now()
  WHERE id = v_sender_wallet_id;

  -- Credit recipient (internal transfer only)
  IF p_to_user_id IS NOT NULL THEN
    -- Lock or create recipient wallet
    SELECT w.id INTO v_recipient_wallet_id
    FROM public.wallets w
    WHERE w.user_id = p_to_user_id AND w.currency = p_currency
    FOR UPDATE;

    IF v_recipient_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id, currency, balance, status)
      VALUES (p_to_user_id, p_currency, 0, 'active')
      RETURNING id INTO v_recipient_wallet_id;
    END IF;

    UPDATE public.wallets
    SET balance = balance + p_amount, updated_at = now()
    WHERE id = v_recipient_wallet_id;

    -- Recipient ledger entry
    INSERT INTO public.transactions
      (user_id, wallet_id, amount, currency, direction, payment_method,
       status, description, reference, category, idempotency_key)
    VALUES
      (p_to_user_id, v_recipient_wallet_id, p_amount, p_currency, 'incoming',
       p_payment_method, 'completed', p_description, p_reference_id,
       p_reference_type, p_idempotency_key || ':in')
    RETURNING id INTO v_tx_id;
  END IF;

  -- Sender ledger entry
  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method,
     status, recipient_name, description, reference, category, idempotency_key)
  VALUES
    (p_from_user_id, v_sender_wallet_id, p_amount, p_currency, 'outgoing',
     p_payment_method, 'completed', p_recipient_name, p_description,
     p_reference_id, p_reference_type, p_idempotency_key)
  RETURNING id INTO v_tx_id;

  transaction_id := v_tx_id;
  new_sender_balance := v_sender_balance - p_amount;
  RETURN NEXT;
END;
$$;

-- Only the service role (edge functions) may execute this.
REVOKE ALL ON FUNCTION public.execute_atomic_transfer FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_atomic_transfer TO service_role;
