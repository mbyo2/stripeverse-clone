-- =====================================================================
-- 20261108_drop_legacy_user_roles_write_policies.sql
--
-- Post-proof fix for 20261105_superadmin_foundation.sql §2.
--
-- The foundation replaced the FOR ALL "Admins can manage roles"
-- policy with the supremacy version — but the LIVE table also carried
-- three older per-command policies from an earlier schema generation:
--   "Only admins can insert roles" (INSERT, WITH CHECK admin-only)
--   "Only admins can update roles" (UPDATE, USING admin-only)
--   "Only admins can delete roles" (DELETE, USING admin-only)
-- RLS permissive policies are OR'd, so a plain admin's write on ANY
-- row — including deleting the owner's admin/super_admin rows — kept
-- passing through those policies even though the supremacy policy
-- denied it. Caught by proof P2 of
-- supabase/qa/superadmin_foundation_proofs.sql on 2026-10-23 (the
-- impersonated plain-admin DELETE of the owner's 'admin' row reported
-- ROW_COUNT 1 inside the self-rolling-back proof block; nothing
-- persisted).
--
-- Fix: drop the three legacy policies. Writes on public.user_roles
-- then flow ONLY through "Admins can manage roles" (super_admin
-- unrestricted; plain admins limited to non-elevated roles, exactly
-- as §2 designed). SELECT policies are untouched.
-- =====================================================================

DROP POLICY IF EXISTS "Only admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can delete roles" ON public.user_roles;
