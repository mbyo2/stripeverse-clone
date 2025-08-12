-- Create crypto wallets and invoices for BTC deposits

-- 1) Create crypto_wallets table
CREATE TABLE IF NOT EXISTS public.crypto_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  asset TEXT NOT NULL DEFAULT 'BTC',
  balance_sats BIGINT NOT NULL DEFAULT 0,
  available_sats BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, asset)	
);

ALTER TABLE public.crypto_wallets ENABLE ROW LEVEL SECURITY;

-- Policies: users can manage their own crypto wallet rows
CREATE POLICY "Users can insert their own crypto wallets"
ON public.crypto_wallets
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own crypto wallets"
ON public.crypto_wallets
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own crypto wallets"
ON public.crypto_wallets
FOR UPDATE
USING (auth.uid() = user_id);

-- Trigger to keep updated_at fresh
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_crypto_wallets_updated_at'
  ) THEN
    CREATE TRIGGER update_crypto_wallets_updated_at
    BEFORE UPDATE ON public.crypto_wallets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- 2) Create crypto_invoices table to map BTCPay invoices to users
CREATE TABLE IF NOT EXISTS public.crypto_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  invoice_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  amount_sats BIGINT,
  amount_fiat NUMERIC,
  fiat_currency TEXT,
  method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

ALTER TABLE public.crypto_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own crypto invoices"
ON public.crypto_invoices
FOR SELECT
USING (auth.uid() = user_id);

-- 3) Helper function to increment crypto wallet balance
CREATE OR REPLACE FUNCTION public.increment_crypto_balance(p_user_id UUID, p_asset TEXT, p_amount_sats BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, COALESCE(p_asset,'BTC'), p_amount_sats, p_amount_sats)
  ON CONFLICT (user_id, asset)
  DO UPDATE SET
    balance_sats = public.crypto_wallets.balance_sats + EXCLUDED.balance_sats,
    available_sats = public.crypto_wallets.available_sats + EXCLUDED.available_sats,
    updated_at = now();
END;
$$;

-- 4) Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crypto_wallets_user_asset ON public.crypto_wallets(user_id, asset);
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_user ON public.crypto_invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_status ON public.crypto_invoices(status);
