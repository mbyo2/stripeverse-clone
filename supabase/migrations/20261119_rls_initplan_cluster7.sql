-- 20261119 — RLS initplan rewrite, cluster 7: aml_screenings, bnpl_plans, compliance_checks, role_requests.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) so Postgres evaluates it once per query (InitPlan).
-- Semantics preserved 1:1 from the live pg_policies dump of 2026-10-24, including roles, command scope and
-- NULL with_check (a FOR ALL policy without WITH CHECK uses its USING expression for checks — recreated
-- without the clause to stay identical). Recorded, NOT changed:
--  * aml_screenings carries TWO admin FOR ALL policies ("Admins can manage AML screenings" with an
--    explicit check, "Admins can manage screenings" without) plus an admin SELECT — same-role overlap.
--  * compliance_checks carries two identical owner SELECT policies (one TO public, one TO authenticated).
--  * role_requests admin policies already carry the 20261110 (admin OR super_admin) widening — preserved.
--  * Admin policies here are admin-only apart from role_requests — no super_admin widening added.
-- Proof: PR10 (others-blindness + admin/super_admin visibility on role_requests) and the strict recheck.

-- ============ aml_screenings (4) ============
DROP POLICY IF EXISTS "Admins can manage AML screenings" ON public.aml_screenings;
CREATE POLICY "Admins can manage AML screenings" ON public.aml_screenings FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can manage screenings" ON public.aml_screenings;
CREATE POLICY "Admins can manage screenings" ON public.aml_screenings FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all AML screenings" ON public.aml_screenings;
CREATE POLICY "Admins can view all AML screenings" ON public.aml_screenings FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their screenings" ON public.aml_screenings;
CREATE POLICY "Users can view their screenings" ON public.aml_screenings FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ bnpl_plans (4) ============
DROP POLICY IF EXISTS "Users can delete own bnpl plans" ON public.bnpl_plans;
CREATE POLICY "Users can delete own bnpl plans" ON public.bnpl_plans FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own bnpl plans" ON public.bnpl_plans;
CREATE POLICY "Users can insert own bnpl plans" ON public.bnpl_plans FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own bnpl plans" ON public.bnpl_plans;
CREATE POLICY "Users can update own bnpl plans" ON public.bnpl_plans FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own BNPL plans" ON public.bnpl_plans;
CREATE POLICY "Users can view their own BNPL plans" ON public.bnpl_plans FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ compliance_checks (4) ============
DROP POLICY IF EXISTS "Admins can manage compliance checks" ON public.compliance_checks;
CREATE POLICY "Admins can manage compliance checks" ON public.compliance_checks FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all compliance checks" ON public.compliance_checks;
CREATE POLICY "Admins can view all compliance checks" ON public.compliance_checks FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their compliance checks" ON public.compliance_checks;
CREATE POLICY "Users can view their compliance checks" ON public.compliance_checks FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own compliance checks" ON public.compliance_checks;
CREATE POLICY "Users can view their own compliance checks" ON public.compliance_checks FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ role_requests (4) ============
DROP POLICY IF EXISTS "Admins can update role requests" ON public.role_requests;
CREATE POLICY "Admins can update role requests" ON public.role_requests FOR UPDATE TO authenticated USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role))) WITH CHECK ((public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all role requests" ON public.role_requests;
CREATE POLICY "Admins can view all role requests" ON public.role_requests FOR SELECT TO authenticated USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users can create their own role requests" ON public.role_requests;
CREATE POLICY "Users can create their own role requests" ON public.role_requests FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own role requests" ON public.role_requests;
CREATE POLICY "Users can view their own role requests" ON public.role_requests FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
