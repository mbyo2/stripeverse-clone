-- Harden table privileges on merchant_accounts and the tables the API-key
-- build touched (api_keys, developer_invoices, developer_webhooks,
-- payment_links) — 2026-11-09.
--
-- Findings (introspected live before this migration):
--   * merchant_accounts: `anon` held blanket table grants (INSERT, UPDATE,
--     DELETE, TRUNCATE, REFERENCES, TRIGGER) plus column-level INSERT/
--     UPDATE/REFERENCES on every column, and `authenticated` held TRUNCATE.
--     TRUNCATE bypasses RLS entirely, so the anon grant was a live exposure
--     on a business-records table (same family fixed in the 2026-10-30
--     audits). No code path reads or writes merchant_accounts as anon:
--     the settings UI runs as the signed-in user, every edge function
--     uses the service role.
--   * merchant_accounts: `authenticated` had NO table-level SELECT and
--     column-level SELECT withheld on api_key, webhook_secret and
--     mobile_money_enabled. Postgres denies a SELECT that names a column
--     the role cannot read, so the BusinessSettings UI's select('*') read
--     failed with 42501 and the form silently fell back to defaults
--     (proven live with a QA business). The fix restores the standing
--     grant template for authenticated — SELECT, INSERT, UPDATE, DELETE
--     with RLS as the row-level gate — and removes TRUNCATE.
--   * api_keys, developer_invoices, developer_webhooks: `anon` held the
--     full blanket grant set INCLUDING TRUNCATE, and `authenticated` held
--     TRUNCATE. No anon policy exists on these tables and no code path
--     uses them as anon. developer_invoices is SELECT-only for
--     authenticated by policy, so its write grants are stripped too.
--   * payment_links: `anon` held the full blanket set including TRUNCATE,
--     but anon SELECT is legitimate — the "Public can view active payment
--     links" policy backs the guest checkout. Anon keeps SELECT only.
--     `authenticated` loses TRUNCATE.
--
-- service_role already holds the full grant set on all five tables and is
-- untouched. All grants on these tables were granted by `postgres`, so the
-- revokes below are effective (verified live after applying).

-- merchant_accounts: anon gets nothing, authenticated gets the template set.
REVOKE ALL PRIVILEGES ON TABLE public.merchant_accounts FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.merchant_accounts FROM authenticated;
GRANT SELECT ON TABLE public.merchant_accounts TO authenticated;

-- api_keys: managed by their owner (authenticated, RLS ALL policy) and by
-- the developer API (service role). Anon gets nothing.
REVOKE ALL PRIVILEGES ON TABLE public.api_keys FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.api_keys FROM authenticated;

-- developer_invoices: created by the developer API (service role);
-- owners only ever view their own (SELECT policy). Anon gets nothing,
-- authenticated keeps SELECT only.
REVOKE ALL PRIVILEGES ON TABLE public.developer_invoices FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.developer_invoices FROM authenticated;

-- developer_webhooks: managed by their owner (authenticated, RLS ALL
-- policy) and the developer API (service role). Anon gets nothing.
REVOKE ALL PRIVILEGES ON TABLE public.developer_webhooks FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.developer_webhooks FROM authenticated;

-- payment_links: anon keeps SELECT for the public guest-checkout read;
-- every write privilege goes. Authenticated loses TRUNCATE.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.payment_links FROM anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON TABLE public.payment_links FROM authenticated;
