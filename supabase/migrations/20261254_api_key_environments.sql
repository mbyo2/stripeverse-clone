-- API key environments, connector config support and the Zambia
-- mobile-money gate (CEO-approved design, 2026-11-09).
--
-- What this adds:
--   1. api_keys.rotation_grace_until — set on the replaced key during
--      rotation; the key keeps working until that instant (it is also
--      written to expires_at, which authentication already enforces).
--   2. merchant_accounts.mobile_money_enabled — the business-level
--      "Mobile money" toggle. A trigger enforces the Zambia-only rule
--      in the database itself: the toggle can never be true for a
--      business whose saved country is not Zambia, no matter which
--      client writes the row (defence in depth behind the UI gate
--      and the config endpoint's own computation).
--   3. payment_links.environment — 'live' | 'test' marker so sandbox
--      links created through the developer API are segregated from
--      production links and can never settle real money (the hosted
--      checkout refuses them; settlement is simulated via the API).
--   4. developer_webhooks.environment — endpoints are registered per
--      environment; sandbox events only reach sandbox endpoints.
--   5. developer_invoices — invoices created through the developer
--      API, one row per environment, never mixed. Sandbox invoices
--      settle only through the simulation endpoint; no row in this
--      table ever touches a wallet, a ledger or a chain.

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS rotation_grace_until TIMESTAMPTZ;

ALTER TABLE public.merchant_accounts
  ADD COLUMN IF NOT EXISTS mobile_money_enabled BOOLEAN NOT NULL DEFAULT false;

-- Zambia check on the free-text country the app saves in address jsonb.
CREATE OR REPLACE FUNCTION public.business_country_is_zambia(p_address JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(coalesce(p_address ->> 'country', ''))) IN ('zambia', 'zm', 'zmb');
$$;

CREATE OR REPLACE FUNCTION public.enforce_mobile_money_country()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.mobile_money_enabled AND NOT public.business_country_is_zambia(NEW.address) THEN
    IF TG_OP = 'INSERT' OR NOT OLD.mobile_money_enabled THEN
      -- A fresh attempt to switch the toggle on for a non-Zambian
      -- business is refused outright.
      RAISE EXCEPTION 'mobile_money_zambia_only'
        USING HINT = 'Mobile money can only be enabled for businesses registered in Zambia.';
    END IF;
    -- The business was enabled and its country moved away from
    -- Zambia: the toggle turns itself off rather than leaving an
    -- entitled row behind or blocking the country change.
    NEW.mobile_money_enabled := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_mobile_money_country ON public.merchant_accounts;
CREATE TRIGGER trg_enforce_mobile_money_country
BEFORE INSERT OR UPDATE ON public.merchant_accounts
FOR EACH ROW EXECUTE FUNCTION public.enforce_mobile_money_country();

ALTER TABLE public.payment_links
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
ALTER TABLE public.payment_links
  DROP CONSTRAINT IF EXISTS payment_links_environment_check;
ALTER TABLE public.payment_links
  ADD CONSTRAINT payment_links_environment_check CHECK (environment IN ('test', 'live'));

ALTER TABLE public.developer_webhooks
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live';
ALTER TABLE public.developer_webhooks
  DROP CONSTRAINT IF EXISTS developer_webhooks_environment_check;
ALTER TABLE public.developer_webhooks
  ADD CONSTRAINT developer_webhooks_environment_check CHECK (environment IN ('test', 'live'));

CREATE TABLE IF NOT EXISTS public.developer_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_id UUID REFERENCES public.api_keys(id) ON DELETE SET NULL,
  environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('test', 'live')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ZMW',
  description TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'expired', 'cancelled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_developer_invoices_user_env
  ON public.developer_invoices(user_id, environment, created_at DESC);
ALTER TABLE public.developer_invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own developer invoices" ON public.developer_invoices;
CREATE POLICY "Users view own developer invoices"
ON public.developer_invoices FOR SELECT TO authenticated
USING (auth.uid() = user_id);
-- No client write policy: only the service role (developer API) writes.
GRANT SELECT ON public.developer_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.developer_invoices TO service_role;
