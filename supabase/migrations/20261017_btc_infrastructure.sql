-- ============================================================================
-- Lightning payments via Breez (server-side).
--
-- The on-chain Bitcoin infrastructure (btc-onchain, btc-watcher,
-- btc_deposit_addresses, btc_onchain_deposits, btc_withdrawals) already
-- exists live via Lovable. This migration adds ONLY what's missing:
-- server-side Lightning payment tracking for the breez-lightning
-- edge function.
--
-- get-breez-config currently only delivers the API key to clients;
-- breez-lightning adds actual invoice creation, payment, and status
-- checks with wallet settlement.
-- ============================================================================

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

-- No DELETE — financial history is the audit trail.
