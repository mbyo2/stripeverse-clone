-- Applied live 2026-11-28 (CEO-approved) BEFORE this file was committed — drift catch-up.
-- Fixes the privilege escalation in public.validate_role_change: it authorized
-- on the caller-supplied p_changed_by and never checked auth.uid(), while
-- EXECUTE was granted to authenticated. Any signed-in user could self-promote
-- to super_admin. Proven live (def + proacl), fixed live, re-proven: legit
-- promote_user_role path still works; audit log showed no prior exploitation.

CREATE OR REPLACE FUNCTION public.validate_role_change(
  p_user_id uuid,
  p_new_role text,
  p_changed_by uuid,
  p_reason text DEFAULT 'Role change request'::text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  current_role TEXT;
  is_authorized BOOLEAN := false;
  role_is_valid BOOLEAN := false;
  role_is_elevated BOOLEAN := false;
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_changed_by IS NOT NULL AND p_changed_by <> v_caller THEN
    RAISE EXCEPTION 'Changed-by must match the authenticated caller';
  END IF;
  SELECT role::text INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
  LIMIT 1;
  SELECT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = p_new_role
  ) INTO role_is_valid;
  role_is_elevated := p_new_role IN (
    'admin', 'super_admin', 'p2p_admin',
    'support_admin', 'compliance_admin', 'finance_admin'
  );
  IF role_is_valid AND v_caller <> p_user_id THEN
    IF public.has_role(v_caller, 'super_admin'::app_role) THEN
      is_authorized := true;
    ELSIF public.has_role(v_caller, 'admin'::app_role) AND NOT role_is_elevated THEN
      is_authorized := true;
    END IF;
  END IF;
  PERFORM public.log_security_event(
    p_user_id,
    'role_change_attempt',
    jsonb_build_object(
      'old_role', current_role,
      'new_role', p_new_role,
      'changed_by', v_caller,
      'changed_by_supplied', p_changed_by,
      'authorized', is_authorized,
      'reason', p_reason,
      'role_is_elevated', role_is_elevated,
      'self_change_blocked', CASE WHEN v_caller = p_user_id THEN true ELSE false END,
      'security_patch_version', '3.1-validate-role-change-auth-uid'
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 9 END
  );
  INSERT INTO public.role_audit (
    user_id, old_role, new_role, changed_by, reason, approved
  ) VALUES (
    p_user_id, current_role, p_new_role, v_caller, p_reason, is_authorized
  );
  IF is_authorized THEN
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_new_role::app_role);
  END IF;
  RETURN is_authorized;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_role_change(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_role_change(uuid, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.validate_role_change(uuid, text, uuid, text) FROM authenticated;
