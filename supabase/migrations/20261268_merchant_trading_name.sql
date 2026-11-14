-- Trading name for merchant accounts (CEO decision 2026-11-14):
-- the Business portal shows the merchant's TRADING name, not the
-- legally registered business name. The platform owner's portal
-- shows "BMaGlass Pay" while the merchant_accounts row keeps the
-- registered name ("MABVUTO BANDA SCIENCE, INFORMATION TECHNICAL
-- CONSULTANCY") exactly as registered.
--
--   trading_name (nullable): the name shown in the Business portal
--     (header, dashboard, Business Profile card). When NULL/blank
--     the portal falls back to business_name, so every other
--     merchant is unaffected — only merchants that set a trading
--     name see a different display name.
--
-- The portal reads through the merchant_accounts_safe view, so the
-- view is recreated with the new column. Grants and security_invoker
-- are re-asserted exactly as the 20261257 fix left them: SELECT to
-- authenticated only, anon has NO access, security_invoker = true.

ALTER TABLE public.merchant_accounts
ADD COLUMN IF NOT EXISTS trading_name TEXT;

COMMENT ON COLUMN public.merchant_accounts.trading_name IS
  'Name shown in the Business portal (header, dashboard, profile). Falls back to business_name when NULL/blank. The registered legal name stays in business_name.';

-- trading_name goes LAST: CREATE OR REPLACE VIEW matches columns by
-- position, so inserting it mid-list renames business_type (42P16).
CREATE OR REPLACE VIEW public.merchant_accounts_safe AS
SELECT
  id,
  user_id,
  business_name,
  business_type,
  registration_number,
  tax_id,
  address,
  contact_info,
  verification_documents,
  status,
  api_key_masked,
  webhook_secret_masked,
  webhook_url,
  created_at,
  updated_at,
  trading_name
FROM public.merchant_accounts;

GRANT SELECT ON public.merchant_accounts_safe TO authenticated;
ALTER VIEW public.merchant_accounts_safe SET (security_invoker = true);
