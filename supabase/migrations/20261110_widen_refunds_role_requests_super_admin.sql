-- =====================================================================
-- 20261110_widen_refunds_role_requests_super_admin.sql
--
-- Follow-up to 20261105_superadmin_foundation.sql, found by the
-- superadmin UI build (2026-10-23): three policies still test
-- has_role(auth.uid(), 'admin') EXACT-match only, so an operator
-- holding super_admin WITHOUT admin would be locked out of the
-- refunds console and the role-request inbox:
--
--   refunds       "Admins manage all refunds"          (ALL)
--   role_requests "Admins can view all role requests"  (SELECT)
--   role_requests "Admins can update role requests"    (UPDATE)
--
-- Live policy definitions were enumerated verbatim before this fix
-- (pg_policies, 2026-10-23): the three policies above are the ONLY
-- role-referencing policies on either table; the remaining five
-- (refund settle/create/view-own, request create/view-own) are
-- owner-scoped and untouched.
--
-- Fix: recreate each policy with the foundation's widening pattern
-- (admin OR super_admin), preserving name, command, roles and —
-- for the FOR ALL policy, whose WITH CHECK was NULL (Postgres then
-- applies USING as the check) — the effective check expression.
-- =====================================================================

DROP POLICY IF EXISTS "Admins manage all refunds" ON public.refunds;
CREATE POLICY "Admins manage all refunds"
  ON public.refunds FOR ALL
  TO public
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all role requests" ON public.role_requests;
CREATE POLICY "Admins can view all role requests"
  ON public.role_requests FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Admins can update role requests" ON public.role_requests;
CREATE POLICY "Admins can update role requests"
  ON public.role_requests FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role));
