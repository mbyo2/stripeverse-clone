-- Workstream D (2026-11-15): open redirect via payment_links.redirect_url.
--
-- A merchant's own RLS policy ("Users manage own payment links", ALL on
-- own rows) lets a payment link be created/updated by direct PostgREST,
-- bypassing the developer-api validation that requires an absolute
-- http(s) URL of at most 2048 characters. Live-proven 2026-11-15: two
-- probe links were inserted directly with redirect_url
-- 'https://evil.example.test/phish?x=1' and 'javascript:alert(...)',
-- and payment-link-checkout's describe action returned both verbatim to
-- the buyer; the checkout pages render the value as <a href>.
--
-- This CHECK enforces the same rule the API already enforces, at the
-- database layer, so no write path can store a non-http(s) redirect.
-- A merchant-chosen https destination is still the merchant's own
-- store URL (same model as any payment-link return URL); the client
-- guard in src/utils/safeRedirect.ts is the second layer for the
-- scheme-abuse case on rows written before this constraint.
alter table public.payment_links
  add constraint payment_links_redirect_url_https_ck
  check (redirect_url is null or redirect_url ~ '^https?://');
