-- Fix the owner-admin grant: the live grant_owner_admin() trigger checks
-- lower(NEW.email) = 'mbyowo3@gmail.com' — a misspelling (missing the "t")
-- of the owner's real email, so the automatic superadmin grant could
-- never fire. Corrected to mbyotwo3@gmail.com.
--
-- Context (2026-10-21): the owner's original account was deleted in the
-- Lovable-era mock purge (2026-10-20). The account was recreated via the
-- dashboard on 2026-10-21 and granted 'admin' directly; this fix restores
-- the standing rule for any future recreation. Verified live the same
-- day: trigger on_auth_user_owner_admin already points at this function,
-- so replacing the body is sufficient.

CREATE OR REPLACE FUNCTION public.grant_owner_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF lower(NEW.email) = 'mbyotwo3@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
