-- Fix: AdminUsers page (/admin/users) showed admins only their own profile.
--
-- Root cause: public.profiles has never had an admin SELECT policy. The only
-- SELECT policy ever created on it (20250701103927) is
--   "Users can view their own profile"  USING (auth.uid() = id)
-- so the page's unfiltered `SELECT * FROM profiles` returned exactly one row
-- (the caller's own) even for admins, and every other user was invisible.
-- public.user_roles was NOT the problem: it has has_role-gated admin policies
-- ("Admins can view all roles", 20260421154308) and public.has_role() is a
-- SECURITY DEFINER helper, so the role controls kept working for the one
-- visible user.
--
-- Fix: add an admin SELECT policy on profiles using the same SECURITY DEFINER
-- has_role() pattern used across this schema. The check stays inside the
-- definer function (opaque to the RLS rewriter) — deliberately NO inline
-- EXISTS/subquery against user_roles in the policy itself, which is the
-- pattern that caused infinite-recursion failures in the sister project.
-- Non-admins are unaffected: the existing own-profile policy still applies
-- and this policy only adds visibility for callers holding the admin role,
-- so plain users still cannot enumerate other users' profiles.
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Defensive re-assertion (idempotent, definitions identical to
-- 20260421154308): the AdminUsers list also reads every user_roles row to
-- render role badges. Live state has drifted from repo migrations before
-- (lost UNIQUE constraints, stray policies), so guarantee the two SELECT
-- policies the page depends on exist exactly as intended. No semantics
-- change where they are already present and correct: users still see only
-- their own role rows; admins see all.
DROP POLICY IF EXISTS "Users can view their own role" ON public.user_roles;
CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
ON public.user_roles FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
