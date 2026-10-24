-- MoonPay card on-ramp (buy BTC with a card): tracking layer.
--
-- MoonPay delivers purchased BTC directly to the user's OWN platform
-- deposit address (btc_address_assignments, assigned by btc-onchain);
-- the existing deposit-detection pipeline credits the wallet when the
-- deposit lands. This table is TRACKING / RECONCILIATION ONLY:
--   - `moonpay-session` writes one 'initiated' row per widget session
--     (external_reference = our reference, sent to MoonPay as
--     externalTransactionId and echoed back on every webhook).
--   - `moonpay-webhook` updates rows from verified MoonPay events.
--     A webhook NEVER credits a wallet or touches a balance.
--   - Webhooks for references we never issued are recorded
--     defensively with user_id NULL and source 'webhook_unmatched'
--     so reconciliation can see them without inventing an owner.
--
-- KILL SWITCH: platform_settings.moonpay_enabled, in the style of
-- payoneer_enabled (20261202). Default FALSE — the rail stays dark
-- until the CEO adds the MoonPay keys and flips it on; the session
-- function refuses with a crafted "coming soon" response while it is
-- false, and with `not_configured` while the keys are absent.
--
-- FIAT: MoonPay does NOT support ZMW. Sessions default to USD
-- (EUR / GBP also allowed); ZMW is refused in the session function.
--
-- RLS: a signed-in user may READ their own rows only (initplan style
-- (select auth.uid())). There are deliberately NO insert/update/delete
-- policies for client roles — writes happen only through the
-- service-role edge functions.

-- ── Kill switch ──────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS moonpay_enabled boolean NOT NULL DEFAULT false;

-- ── Tracking ledger ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.moonpay_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The session's owner; NULL only on defensive webhook rows for
  -- references we never issued (source 'webhook_unmatched').
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- OUR reference (a random UUID minted by moonpay-session) — sent to
  -- MoonPay as externalTransactionId and the reconciliation key for
  -- every webhook. On unmatched webhook rows where MoonPay sent no
  -- externalTransactionId, the MoonPay transaction id stands in.
  external_reference TEXT NOT NULL UNIQUE,
  -- MoonPay's own transaction id, recorded once known.
  moonpay_transaction_id TEXT UNIQUE,
  -- The user's own platform BTC deposit address the BTC is sent to.
  deposit_address TEXT NOT NULL,
  -- Fiat the customer pays with. MoonPay has no ZMW — USD default.
  fiat_currency TEXT NOT NULL DEFAULT 'USD',
  fiat_amount NUMERIC,
  crypto_currency TEXT NOT NULL DEFAULT 'BTC',
  -- BTC amount (MoonPay quoteCurrencyAmount), once executed.
  crypto_amount NUMERIC,
  fee_amount NUMERIC,
  -- On-chain transaction id once MoonPay has sent the BTC.
  crypto_transaction_id TEXT,
  -- Lifecycle: initiated (session created) → waiting_payment /
  -- pending / waiting_authorization → completed / failed (terminal).
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'waiting_payment', 'pending', 'waiting_authorization', 'completed', 'failed')),
  -- MoonPay's raw status string, exactly as last reported.
  raw_status TEXT,
  failure_reason TEXT,
  environment TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox', 'production')),
  source TEXT NOT NULL DEFAULT 'session'
    CHECK (source IN ('session', 'webhook_unmatched')),
  last_webhook_event TEXT,
  last_webhook_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moonpay_transactions_status
  ON public.moonpay_transactions (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moonpay_transactions_user
  ON public.moonpay_transactions (user_id, created_at DESC);

ALTER TABLE public.moonpay_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own MoonPay transactions" ON public.moonpay_transactions;
CREATE POLICY "Users can view their own MoonPay transactions"
  ON public.moonpay_transactions FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- No INSERT / UPDATE / DELETE policies: client roles cannot write
-- this table at all. The service role (edge functions) bypasses RLS
-- and is the only writer.
