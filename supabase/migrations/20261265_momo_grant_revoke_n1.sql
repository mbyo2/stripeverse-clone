-- 20261265_momo_grant_revoke_n1.sql
--
-- N-1 (2026-11-13 Lenco/security verification): revoke the over-broad
-- live grants on the three mobile-money tables.
--
-- Live drift: Supabase platform-default privileges granted anon AND
-- authenticated the FULL privilege set (SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES, TRIGGER) on merchant_momo_connections,
-- momo_collections and momo_platform_charges, while repo migration
-- 20261259 grants only SELECT to authenticated (collections, charges)
-- and ALL to service_role (connections service_role-only).
-- RLS mitigated the exposure (anon reads returned [], forged inserts
-- 401'd), but the grants violated the CEO-approved grant rule and one
-- policy mistake away from exposure. The grantor is postgres (relacl
-- shows `/postgres`), so these REVOKEs take effect — verify with a
-- has_table_privilege / information_schema re-read after applying.
--
-- Intended end state (matches 20261259):
--   merchant_momo_connections: postgres + service_role ALL; anon/authenticated NONE.
--   momo_collections:          postgres + service_role ALL; authenticated SELECT only.
--   momo_platform_charges:     postgres + service_role ALL; authenticated SELECT only.

REVOKE ALL ON public.merchant_momo_connections FROM anon, authenticated;

REVOKE ALL ON public.momo_collections FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.momo_collections FROM authenticated;

REVOKE ALL ON public.momo_platform_charges FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON public.momo_platform_charges FROM authenticated;

-- Re-assert the intended SELECT grants (idempotent no-ops if present).
GRANT SELECT ON public.momo_collections TO authenticated;
GRANT SELECT ON public.momo_platform_charges TO authenticated;
