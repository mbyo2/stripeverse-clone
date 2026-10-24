-- 20261120 — RLS initplan rewrite, cluster 8: two_factor_auth, user_roles, vendor_crypto_wallets, webhooks.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24, including NULL with_check on UPDATE/ALL policies (recreated without the
-- clause — Postgres then applies the USING expression as the check, identical behaviour). Recorded:
--  * two_factor_auth and user_roles each carry duplicate owner SELECT policies (harmless OR breadth).
--  * user_roles "Admins can manage roles" is the superadmin-foundation SUPREMACY policy: super_admin
--    unrestricted; a plain admin may manage only rows whose role is NOT one of the privileged roles.
--    Preserved exactly — has_role is SECURITY DEFINER, so the self-reference cannot recurse (proven by
--    the foundation proofs P1–P13 and re-proven by PR11 below).
-- Proof: PR11 (has_role regression + role visibility + others-blindness) and the strict recheck.

-- ============ two_factor_auth (4) ============
DROP POLICY IF EXISTS "Users can insert their own 2FA settings" ON public.two_factor_auth;
CREATE POLICY "Users can insert their own 2FA settings" ON public.two_factor_auth FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can read their own 2FA settings" ON public.two_factor_auth;
CREATE POLICY "Users can read their own 2FA settings" ON public.two_factor_auth FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own 2FA settings" ON public.two_factor_auth;
CREATE POLICY "Users can update their own 2FA settings" ON public.two_factor_auth FOR UPDATE TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own 2FA settings" ON public.two_factor_auth;
CREATE POLICY "Users can view their own 2FA settings" ON public.two_factor_auth FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ user_roles (4) ============
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING ((public.has_role((SELECT auth.uid()), 'super_admin'::app_role) OR (public.has_role((SELECT auth.uid()), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role, 'p2p_admin'::app_role, 'support_admin'::app_role, 'compliance_admin'::app_role, 'finance_admin'::app_role]))))) WITH CHECK ((public.has_role((SELECT auth.uid()), 'super_admin'::app_role) OR (public.has_role((SELECT auth.uid()), 'admin'::app_role) AND (role <> ALL (ARRAY['admin'::app_role, 'super_admin'::app_role, 'p2p_admin'::app_role, 'support_admin'::app_role, 'compliance_admin'::app_role, 'finance_admin'::app_role])))));

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
CREATE POLICY "Users can view their own role" ON public.user_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ vendor_crypto_wallets (4) ============
DROP POLICY IF EXISTS "Vendors delete own crypto wallets" ON public.vendor_crypto_wallets;
CREATE POLICY "Vendors delete own crypto wallets" ON public.vendor_crypto_wallets FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Vendors insert own crypto wallets" ON public.vendor_crypto_wallets;
CREATE POLICY "Vendors insert own crypto wallets" ON public.vendor_crypto_wallets FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Vendors update own crypto wallets" ON public.vendor_crypto_wallets;
CREATE POLICY "Vendors update own crypto wallets" ON public.vendor_crypto_wallets FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Vendors view own crypto wallets" ON public.vendor_crypto_wallets;
CREATE POLICY "Vendors view own crypto wallets" ON public.vendor_crypto_wallets FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ============ webhooks (4) ============
DROP POLICY IF EXISTS "Users can delete their own webhook configs" ON public.webhooks;
CREATE POLICY "Users can delete their own webhook configs" ON public.webhooks FOR DELETE TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own webhook configs" ON public.webhooks;
CREATE POLICY "Users can insert their own webhook configs" ON public.webhooks FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own webhook configs" ON public.webhooks;
CREATE POLICY "Users can update their own webhook configs" ON public.webhooks FOR UPDATE TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own webhook configs" ON public.webhooks;
CREATE POLICY "Users can view their own webhook configs" ON public.webhooks FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);
