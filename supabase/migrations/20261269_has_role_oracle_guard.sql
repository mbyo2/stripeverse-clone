-- Workstream A (auth & session audit, 2026-11-15): close the has_role role oracle.
--
-- FINDING (proven live before this fix): public.has_role(user_id, required_role)
-- is SECURITY DEFINER with EXECUTE granted to anon AND authenticated, and it
-- answered about ANY user id. With only the publishable anon key, an attacker
-- could confirm whether an arbitrary uuid holds admin / super_admin:
--   POST /rest/v1/rpc/has_role {"user_id": "<super_admin id>", "required_role": "super_admin"} -> true
--   POST /rest/v1/rpc/has_role {"user_id": "<random uuid>", "required_role": "super_admin"} -> false
-- (Same oracle existed on Doc'O Clock via has_role / has_admin_scope.)
--
-- The anon/authenticated EXECUTE grants are KEPT on purpose: RLS policies
-- evaluated for anon callers (e.g. the public institution directory) call
-- this helper, and revoking the grants would break those policies. The
-- oracle closes inside the function instead: a caller may only ask about
-- themselves, unless they are a platform admin/super_admin, or the call
-- comes from a trusted server context (service_role JWT, or no JWT at all:
-- pg_cron / triggers / direct SQL). Everyone else gets the answer about
-- the CALLER (which they could already learn by asking about themselves),
-- never about the requested user -- so an unauthenticated probe always
-- returns false.
--
-- Callers audited before this change (all preserved):
--   * RLS policies and in-DB helpers call has_role(auth.uid(), ...) -- self.
--   * Edge functions (requireAdmin) call it via the service-role client --
--     service_role JWT, trusted branch.
--   * Admin RPCs (admin_create_receiving_partner etc.) check
--     has_role(p_actor_id, 'admin') -- service_role-only EXECUTE, trusted.
--   * Lab/billing helpers check has_role(p_user_id/v_cashier/viewer_id, ...)
--     where the id is auth.uid() (self) or the caller was already proven an
--     admin by the enclosing function (admin carve-out below).
--   * No client or edge function asks about another non-admin user's role.
--
-- IMPLEMENTATION WARNING (learned live 2026-11-15, do not "simplify" back):
-- the first version of this guard was a LANGUAGE sql function whose CASE
-- referenced the bare parameter name `user_id` inside a query over
-- public.user_roles. In SQL-language functions an unqualified name that
-- matches a column resolves to the COLUMN, so the CASE returned each row's
-- own user_id and the function degenerated to "does ANYONE hold this role"
-- for admin and service_role callers -- which silently opened requireAdmin
-- to every authenticated user (proven live: data-backup returned 200 for
-- a plain user minutes after the first deploy). The guard is therefore
-- PL/pgSQL: the effective id is resolved into a local variable OUTSIDE
-- any query, where `user_id` can only mean the parameter, and the final
-- lookup compares against that variable. The parameter names are
-- unchanged, so PostgREST named-argument callers are unaffected.
--
-- CREATE OR REPLACE preserves the existing EXECUTE grants (anon,
-- authenticated, service_role).

-- Helper mirroring Doc'O Clock's public.is_service_role(): true only when
-- the request carries a service_role JWT.
CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
$function$;

GRANT EXECUTE ON FUNCTION public.is_service_role() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_role(user_id uuid, required_role app_role)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_target uuid;
BEGIN
  -- Resolve the effective subject OUTSIDE any query (see warning above):
  -- bare `user_id` inside a query over user_roles would mean the column.
  v_target := CASE
    -- Trusted server context: service_role JWT, or no JWT at all
    -- (pg_cron / trigger / direct SQL). Honour the requested id.
    WHEN public.is_service_role() OR auth.jwt() IS NULL THEN user_id
    -- The caller asking about themselves.
    WHEN auth.uid() = user_id THEN user_id
    -- A platform admin / super_admin asking about someone else.
    WHEN EXISTS (
      SELECT 1 FROM public.user_roles a
      WHERE a.user_id = auth.uid()
        AND a.role IN ('admin'::app_role, 'super_admin'::app_role)
    ) THEN user_id
    -- Everyone else: answer about the caller, never about the
    -- requested user. An unauthenticated probe therefore always
    -- returns false.
    ELSE auth.uid()
  END;
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = v_target
      AND ur.role = required_role
  );
END;
$function$;

COMMENT ON FUNCTION public.has_role(uuid, app_role) IS
  'Role check, oracle-hardened 2026-11-15 (workstream A): answers about the requested user only for the user themselves, a platform admin/super_admin, or trusted server context (service_role / no JWT). All other callers get the answer about themselves. PL/pgSQL by design: the effective id resolves into a local variable outside any query, because the bare parameter name collides with the user_roles.user_id column in SQL-language functions.';
