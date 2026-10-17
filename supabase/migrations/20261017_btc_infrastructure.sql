-- ============================================================================
-- Bitcoin infrastructure: on-chain deposits (xpub) + Lightning (Breez).
--
-- Replaces the BTCPay placeholder. Uses:
--   BTC_XPUB (Supabase secret, mainnet) — HD address derivation (BIP84)
--   BREEZ_API_KEY (Supabase secret) — Lightning via Breez nodeless API
--
-- New tables:
--   1. btc_deposit_addresses — per-user derived addresses (BIP84 m/84'/0'/0'/0/i)
--   2. lightning_payments — Breez invoice/payment tracking
-- ============================================================================

-- 1. Deposit addresses derived from the platform xpub
CREATE TABLE IF NOT EXISTS public.btc_deposit_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  derivation_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, derivation_index)
);

CREATE INDEX IF NOT EXISTS idx_btc_deposit_addresses_user ON public.btc_deposit_addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_btc_deposit_addresses_address ON public.btc_deposit_addresses(address);

ALTER TABLE public.btc_deposit_addresses ENABLE ROW LEVEL SECURITY;

-- Users can view their own deposit addresses; inserts go through the
-- edge function (service role), so no user INSERT policy.
DROP POLICY IF EXISTS "Users view own deposit addresses" ON public.btc_deposit_addresses;
CREATE POLICY "Users view own deposit addresses"
ON public.btc_deposit_addresses FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- 2. Lightning payments via Breez
CREATE TABLE IF NOT EXISTS public.lightning_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  amount_sats BIGINT NOT NULL CHECK (amount_sats > 0),
  breez_invoice_id TEXT,
  bolt11 TEXT,
  payment_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lightning_payments_user ON public.lightning_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_lightning_payments_status ON public.lightning_payments(status);
CREATE INDEX IF NOT EXISTS idx_lightning_payments_breez_id ON public.lightning_payments(breez_invoice_id);

ALTER TABLE public.lightning_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own lightning payments" ON public.lightning_payments;
CREATE POLICY "Users view own lightning payments"
ON public.lightning_payments FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- No DELETE on either table — financial history is the audit trail.
