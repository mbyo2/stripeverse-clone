-- 20261118 — RLS initplan rewrite, cluster 6: fraud_rules, kyc_verifications, merchant_kyb_applications.
-- Every bare auth.uid() in qual/with_check is wrapped as (SELECT auth.uid()) so Postgres can hoist it
-- into an InitPlan evaluated once per query instead of once per row. Semantics preserved 1:1 from the
-- live pg_policies dump of 2026-10-24, including roles and command scope. Recorded, NOT changed:
--  * kyc_verifications carries two identical owner SELECT policies ("Users can view their own KYC" and
--    "Users can view their own KYC verification") — harmless OR breadth, both rewritten as-is.
--  * fraud_rules "Admins can manage all fraud rules" (FOR ALL) overlaps "Admins can view fraud rules"
--    (SELECT) — same-role overlap, no widening.
--  * fraud_rules admin policies are admin-only (no super_admin) — preserved as-is; any widening is a
--    separate policy decision.
--  * fraud_rules business policies keep their merchant_id IN (SELECT ... FROM merchant_accounts) shape
--    (proven acyclic; merchant_accounts policies do not reference fraud_rules), inner uid wrapped too.
-- Proof: PR9 (blindness + admin-visibility) and the strict bare-uid recheck return clean after relay.

-- ============ fraud_rules (6) ============
DROP POLICY IF EXISTS "Admins can manage all fraud rules" ON public.fraud_rules;
CREATE POLICY "Admins can manage all fraud rules" ON public.fraud_rules FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view fraud rules" ON public.fraud_rules;
CREATE POLICY "Admins can view fraud rules" ON public.fraud_rules FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Business users can delete their fraud rules" ON public.fraud_rules;
CREATE POLICY "Business users can delete their fraud rules" ON public.fraud_rules FOR DELETE TO authenticated USING ((public.has_role((SELECT auth.uid()), 'business'::app_role) AND (merchant_id IN (SELECT merchant_accounts.id FROM merchant_accounts WHERE (merchant_accounts.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "Business users can manage their fraud rules" ON public.fraud_rules;
CREATE POLICY "Business users can manage their fraud rules" ON public.fraud_rules FOR INSERT TO authenticated WITH CHECK ((public.has_role((SELECT auth.uid()), 'business'::app_role) AND (merchant_id IN (SELECT merchant_accounts.id FROM merchant_accounts WHERE (merchant_accounts.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "Business users can update their fraud rules" ON public.fraud_rules;
CREATE POLICY "Business users can update their fraud rules" ON public.fraud_rules FOR UPDATE TO authenticated USING ((public.has_role((SELECT auth.uid()), 'business'::app_role) AND (merchant_id IN (SELECT merchant_accounts.id FROM merchant_accounts WHERE (merchant_accounts.user_id = (SELECT auth.uid())))))) WITH CHECK ((public.has_role((SELECT auth.uid()), 'business'::app_role) AND (merchant_id IN (SELECT merchant_accounts.id FROM merchant_accounts WHERE (merchant_accounts.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "Business users can view their fraud rules" ON public.fraud_rules;
CREATE POLICY "Business users can view their fraud rules" ON public.fraud_rules FOR SELECT TO authenticated USING ((public.has_role((SELECT auth.uid()), 'business'::app_role) AND ((merchant_id IS NULL) OR (merchant_id IN (SELECT merchant_accounts.id FROM merchant_accounts WHERE (merchant_accounts.user_id = (SELECT auth.uid())))))));

-- ============ kyc_verifications (5) ============
DROP POLICY IF EXISTS "Admins can update KYC verifications" ON public.kyc_verifications;
CREATE POLICY "Admins can update KYC verifications" ON public.kyc_verifications FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all KYC verifications" ON public.kyc_verifications;
CREATE POLICY "Admins can view all KYC verifications" ON public.kyc_verifications FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can insert their own KYC" ON public.kyc_verifications;
CREATE POLICY "Users can insert their own KYC" ON public.kyc_verifications FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own KYC" ON public.kyc_verifications;
CREATE POLICY "Users can view their own KYC" ON public.kyc_verifications FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own KYC verification" ON public.kyc_verifications;
CREATE POLICY "Users can view their own KYC verification" ON public.kyc_verifications FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ merchant_kyb_applications (5) ============
DROP POLICY IF EXISTS "kyb_admin_select_all" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_admin_select_all" ON public.merchant_kyb_applications FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "kyb_admin_update_all" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_admin_update_all" ON public.merchant_kyb_applications FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "kyb_insert_own" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_insert_own" ON public.merchant_kyb_applications FOR INSERT TO authenticated WITH CHECK ((user_id = (SELECT auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text])));

DROP POLICY IF EXISTS "kyb_select_own" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_select_own" ON public.merchant_kyb_applications FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "kyb_update_own_while_open" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_update_own_while_open" ON public.merchant_kyb_applications FOR UPDATE TO authenticated USING ((user_id = (SELECT auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'rejected'::text]))) WITH CHECK ((user_id = (SELECT auth.uid())) AND (status = ANY (ARRAY['draft'::text, 'submitted'::text])));
