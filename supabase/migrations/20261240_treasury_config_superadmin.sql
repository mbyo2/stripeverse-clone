-- ---------------------------------------------------------------------
-- 20261240 — crypto_treasury_config: raise the gate from the admin
-- tier to super_admin ONLY (CEO decision 2026-10-27, least
-- privilege — the follow-on to the Treasury & Reports console fix).
--
-- The Admin Dashboard's "Treasury" tab (AdminTreasuryConfig — the
-- crypto payout-treasury Safe configuration) reads and writes this
-- table directly. Its only policy, "Admins manage treasury config"
-- (rewritten in the cluster-15 initplan pass, 20261127), admitted
-- any admin. The CEO ruled the feature super_admin-only, UI and
-- data layer alike; the tab now renders only for super_admin
-- (roleVisibility.ts) and this migration makes the table match.
--
-- PERMISSIVE-OR CHECK (live-verified 2026-10-27 before applying):
-- pg_policies showed EXACTLY ONE policy on this table — the FOR
-- ALL "Admins manage treasury config" for authenticated. It is
-- dropped and replaced below; no other permissive policy survives
-- to OR the old access back in. Anon holds table grants (project
-- default) but has never had a policy on this table, so RLS
-- denies anon outright, before and after.
--
-- The gate is public.has_role — the SECURITY DEFINER helper every
-- role policy in this project uses (20261105 superadmin
-- foundation) — in the (SELECT auth.uid()) initplan form of the
-- cluster-15 rewrite of this very policy. has_role is opaque to
-- the RLS rewriter, so there is no recursion risk.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Admins manage treasury config" ON public.crypto_treasury_config;

CREATE POLICY "Super admins manage treasury config"
  ON public.crypto_treasury_config FOR ALL TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'super_admin'::app_role))
  WITH CHECK (public.has_role((SELECT auth.uid()), 'super_admin'::app_role));
