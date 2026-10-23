-- =====================================================================
-- 20261105_superadmin_foundation.sql — Superadmin foundation, part 2
-- of 2 (run AFTER 20261104_superadmin_roles_enum.sql, whose five
-- ALTER TYPE statements must each be relayed in their OWN editor Run
-- before anything here executes).
--
-- CEO directive (2026-10-23): the superadmin is in charge of
-- everything, must be able to access all platform accounts, and will
-- later appoint people in charge of each feature. A read-only audit
-- the same day found: no superadmin tier (the owner was a plain
-- 'admin', removable by any other admin via /admin/users); role
-- changes wrote no audit rows on the console path; admins had NO read
-- path to user wallets / accounts / payment_links / crypto_wallets /
-- btc_deposits; no account freeze existed; no per-feature roles.
--
-- ADDITIVE-ONLY GUARANTEE (CEO confirmation, binding): the owner
-- account mbyotwo3@gmail.com (uid f9cf338f-dc77-403b-b2ec-e609951c8440)
-- remains a fully normal user of the app. super_admin is an ADDED
-- user_roles row; his existing 'admin' row and every own-row policy
-- are untouched, and nothing in this migration blocks, redirects or
-- degrades any existing user workflow. Every policy below either
-- widens ADMIN visibility or constrains ADMIN role management —
-- plain-user own-row behaviour is provably unchanged (regression
-- block in supabase/qa/superadmin_foundation_proofs.sql).
--
-- RECONCILIATION (2026-10-23): §8 was rewritten after the
-- delta-audit remediation (20261102_delta_audit_remediation.sql)
-- merged and went LIVE. Its three P2P RPC bodies are the delta
-- bodies with only the in-DB admin check swapped to
-- public.p2p_is_admin(...) — see §8 for the detail. Relay order
-- is unchanged: 20261104 (each ALTER TYPE in its OWN editor Run)
-- before this file, and this file only ever AFTER 20261102.
--
-- Sections:
--   1. super_admin grant (sole initial holder, idempotent)
--   2. Role-management supremacy (user_roles write policy)
--   3. Admin read-path extensions for the tier (profiles/roles/audit)
--   4. promote_user_role / validate_role_change guards
--   5. Role-change audit trigger -> public.role_audit
--   6. admin_list_users() directory RPC
--   7. Admin oversight SELECT policies (wallets, accounts,
--      payment_links, crypto_wallets, btc_deposits) — read-only
--   8. Per-feature roles: p2p_is_admin() + the delta P2P RPC gates
--      (p2p_apply_sanction / p2p_resolve_review / p2p_resolve_dispute)
--   9. Account freeze: profiles columns + column guard +
--      admin_set_user_frozen()
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. super_admin GRANT — sole initial holder, idempotent.
-- Anchored to the uid (not the email) and guarded on the auth user
-- existing, so a relay against the wrong project fails safe (inserts
-- nothing) instead of erroring halfway.
-- ---------------------------------------------------------------------
INSERT INTO public.user_roles (user_id, role)
SELECT 'f9cf338f-dc77-403b-b2ec-e609951c8440'::uuid, 'super_admin'::public.app_role
WHERE EXISTS (
  SELECT 1 FROM auth.users WHERE id = 'f9cf338f-dc77-403b-b2ec-e609951c8440'::uuid
)
ON CONFLICT (user_id, role) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. ROLE-MANAGEMENT SUPREMACY — replace the "Admins can manage
-- roles" write policy on user_roles (20260421154308 definition was:
-- any admin can write ANY row, including deleting the owner's).
--
-- Elevated roles — 'admin', 'super_admin' and the four per-feature
-- admin roles — may be granted or removed ONLY by a super_admin.
-- Plain admins keep managing the base roles exactly as before
-- ('user', 'business', 'beta_tester', 'moderator').
--
-- How the single FOR ALL policy expresses it: USING is evaluated
-- against the EXISTING row (SELECT/UPDATE/DELETE), WITH CHECK against
-- the PROPOSED row (INSERT/UPDATE). A plain admin therefore cannot
-- see-for-write, update or delete any row carrying an elevated role
-- (the owner's rows are invisible to their writes), and cannot create
-- or promote a row INTO an elevated role. has_role() is SECURITY
-- DEFINER (opaque to the RLS rewriter) — the established
-- recursion-safe pattern for this table.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND role NOT IN (
        'admin'::public.app_role, 'super_admin'::public.app_role,
        'p2p_admin'::public.app_role, 'support_admin'::public.app_role,
        'compliance_admin'::public.app_role, 'finance_admin'::public.app_role
      )
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND role NOT IN (
        'admin'::public.app_role, 'super_admin'::public.app_role,
        'p2p_admin'::public.app_role, 'support_admin'::public.app_role,
        'compliance_admin'::public.app_role, 'finance_admin'::public.app_role
      )
    )
  );

-- ---------------------------------------------------------------------
-- 3. TIER READ EXTENSIONS — the pre-existing admin view policies
-- named only 'admin'. The owner keeps his 'admin' row, so nothing
-- changes for him today; these re-assertions make a super_admin-only
-- holder equally able to use the console tomorrow. Same policy names,
-- widened check, own-row policies untouched.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admins can view all role audits" ON public.role_audit;
CREATE POLICY "Admins can view all role audits"
  ON public.role_audit FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ---------------------------------------------------------------------
-- 4. RPC GUARDS — promote_user_role / validate_role_change.
-- Same signatures and same replace-all-roles semantics as the current
-- definitions (20250922130725 / 20250918172911); only the
-- authorisation changes:
--   * super_admin may grant/remove ANY role (including elevated).
--   * plain admin may grant/remove BASE roles only; attempts on
--     elevated roles are refused (validate returns false and logs;
--     promote raises).
--   * nobody may change their OWN roles (unchanged).
--   * an invalid role label is refused, never cast-blindly.
-- validate_role_change keeps its security-event + role_audit logging;
-- the section-5 trigger additionally trails the physical row changes.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_role_change(p_user_id uuid, p_new_role text, p_changed_by uuid, p_reason text DEFAULT 'Role change request'::text)
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
BEGIN
  -- Get current role of target user
  SELECT role::text INTO current_role
  FROM public.user_roles
  WHERE user_id = p_user_id
  LIMIT 1;

  -- The proposed role must be a real app_role label.
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

  -- Authorisation (self-changes are never authorised):
  --   super_admin  -> any role, for other users.
  --   plain admin  -> base roles only, for other users.
  IF role_is_valid AND p_changed_by IS NOT NULL AND p_changed_by != p_user_id THEN
    IF public.has_role(p_changed_by, 'super_admin'::app_role) THEN
      is_authorized := true;
    ELSIF public.has_role(p_changed_by, 'admin'::app_role) AND NOT role_is_elevated THEN
      is_authorized := true;
    END IF;
  END IF;

  -- Enhanced security event logging (as before)
  PERFORM public.log_security_event(
    p_user_id,
    'role_change_attempt',
    jsonb_build_object(
      'old_role', current_role,
      'new_role', p_new_role,
      'changed_by', p_changed_by,
      'authorized', is_authorized,
      'reason', p_reason,
      'role_is_elevated', role_is_elevated,
      'self_change_blocked', CASE WHEN p_changed_by = p_user_id THEN true ELSE false END,
      'security_patch_version', '3.0-superadmin'
    ),
    NULL,
    NULL,
    CASE WHEN is_authorized THEN 1 ELSE 9 END
  );

  -- Log the role change attempt (as before)
  INSERT INTO public.role_audit (
    user_id,
    old_role,
    new_role,
    changed_by,
    reason,
    approved
  ) VALUES (
    p_user_id,
    current_role,
    p_new_role,
    p_changed_by,
    p_reason,
    is_authorized
  );

  -- If authorized, make the change
  IF is_authorized THEN
    -- Delete old role(s)
    DELETE FROM public.user_roles WHERE user_id = p_user_id;
    -- Insert new role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_new_role::app_role);
  END IF;

  RETURN is_authorized;
END;
$$;

CREATE OR REPLACE FUNCTION public.promote_user_role(
  p_target_user_id uuid,
  p_new_role app_role,
  p_reason text DEFAULT 'Role promotion'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Caller identity comes from the JWT, never from a parameter.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Prevent self-promotion for security (unchanged)
  IF auth.uid() = p_target_user_id THEN
    RAISE EXCEPTION 'Cannot promote yourself';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only administrators can promote users';
  END IF;

  -- Elevated roles are a super_admin grant (supremacy rule).
  IF p_new_role IN (
       'admin'::app_role, 'super_admin'::app_role, 'p2p_admin'::app_role,
       'support_admin'::app_role, 'compliance_admin'::app_role, 'finance_admin'::app_role
     )
     AND NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can grant or remove an admin-level role';
  END IF;

  -- Use the secure role change function
  RETURN public.validate_role_change(
    p_target_user_id,
    p_new_role::text,
    auth.uid(),
    p_reason
  );
END;
$$;

-- ACL re-assertion (CREATE OR REPLACE preserves grants, restated for
-- the record and for fresh-environment rebuilds; the 20260505153440
-- sweep revoked PUBLIC EXECUTE schema-wide and granted these back to
-- authenticated — keep exactly that posture).
REVOKE ALL ON FUNCTION public.validate_role_change(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_role_change(uuid, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.validate_role_change(uuid, text, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.promote_user_role(uuid, app_role, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_user_role(uuid, app_role, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.promote_user_role(uuid, app_role, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 5. ROLE-CHANGE AUDIT TRIGGER — every physical change to user_roles
-- lands in public.role_audit, whichever path made it: the /admin/users
-- console (direct table writes), promote_user_role /
-- validate_role_change, or a future grant UI. (Attempts made through
-- validate_role_change are ALSO logged by that function with its
-- approved flag — the trigger rows are the physical-change trail;
-- reason marks the source so the two are distinguishable.)
-- The function is SECURITY DEFINER so the insert succeeds regardless
-- of the caller's role_audit grants; EXECUTE is revoked from all
-- client roles per the project convention (triggers fire regardless).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.role_audit (user_id, old_role, new_role, changed_by, reason, approved)
    VALUES (NEW.user_id, NULL, NEW.role::text, auth.uid(), 'user_roles row inserted', true);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.role_audit (user_id, old_role, new_role, changed_by, reason, approved)
    VALUES (NEW.user_id, OLD.role::text, NEW.role::text, auth.uid(), 'user_roles row updated', true);
    RETURN NEW;
  ELSE -- DELETE
    INSERT INTO public.role_audit (user_id, old_role, new_role, changed_by, reason, approved)
    VALUES (OLD.user_id, OLD.role::text, NULL, auth.uid(), 'user_roles row deleted', true);
    RETURN OLD;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.log_role_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_role_change() FROM anon;
REVOKE ALL ON FUNCTION public.log_role_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_user_roles_audit ON public.user_roles;
CREATE TRIGGER trg_user_roles_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.log_role_change();

-- ---------------------------------------------------------------------
-- 6. ADMIN DIRECTORY RPC — the console needs profile + email; emails
-- live in auth.users, which no client role can read. SECURITY DEFINER
-- with the admin check INSIDE the function (the p2p RPC pattern):
-- EXECUTE is open to authenticated, and the function itself raises
-- for anyone who is not an admin / super_admin.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only an admin can list platform users';
  END IF;

  RETURN QUERY
  SELECT p.id, u.email::text, p.first_name, p.last_name, p.phone, p.created_at
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  ORDER BY p.created_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_users() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ---------------------------------------------------------------------
-- 7. ADMIN OVERSIGHT READ PATHS — SELECT-only policies for admins and
-- super_admins on the five account tables the audit found unreadable.
-- No INSERT/UPDATE/DELETE is granted to admins on any of them: money
-- still moves only through the audited service-role paths, and
-- protect_wallet_balance still neutralises balance writes under a
-- user JWT. These policies are purely additive — each table's
-- existing own-row policies are untouched.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin oversight can view all wallets" ON public.wallets;
CREATE POLICY "Admin oversight can view all wallets"
  ON public.wallets FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admin oversight can view all accounts" ON public.accounts;
CREATE POLICY "Admin oversight can view all accounts"
  ON public.accounts FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admin oversight can view all payment links" ON public.payment_links;
CREATE POLICY "Admin oversight can view all payment links"
  ON public.payment_links FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admin oversight can view all crypto wallets" ON public.crypto_wallets;
CREATE POLICY "Admin oversight can view all crypto wallets"
  ON public.crypto_wallets FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

DROP POLICY IF EXISTS "Admin oversight can view all btc deposits" ON public.btc_deposits;
CREATE POLICY "Admin oversight can view all btc deposits"
  ON public.btc_deposits FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- ---------------------------------------------------------------------
-- 8. PER-FEATURE ROLES (foundation) — p2p_is_admin is the single
-- P2P admin-verification helper: admin OR super_admin OR p2p_admin.
-- The p2p edge function's isAdmin check is extended to the same set
-- (supabase/functions/p2p/index.ts).
--
-- RECONCILIATION (2026-10-23, after 20261102 merged): the three
-- RPCs below are reproduced from the DELTA-AUDIT bodies in
-- 20261102_delta_audit_remediation.sql (§D4 + §D10) — the versions
-- that are LIVE — with ONLY their in-DB admin verification swapped
-- from has_role(<actor>, 'admin') to public.p2p_is_admin(<actor>):
--   * p2p_apply_sanction  — the D10 supplied-identity check; the
--     NULL-admin system path (automation rungs) is unchanged.
--   * p2p_resolve_review  — the D4 gate line.
--   * p2p_resolve_dispute — the actor gate line; the rest of the
--     delta body (replay handling, the 8-arg sanction call with
--     the verified admin id attached, the single D4 audit row
--     written inside p2p_apply_sanction) is byte-identical.
-- Signatures and ACL blocks are likewise the delta ones, so each
-- CREATE OR REPLACE lands on the exact live signature — no DROP
-- needed, nothing regresses. (The first draft of this section
-- carried the pre-delta phase-1a resolver body — 7-arg sanction
-- call, resolver-written sanction_applied audit row; relaying it
-- after 20261102 would have duplicated that audit row and lost
-- the verified-admin identity. It must not come back.)
-- Deliberately NOT redefined here: p2p_revoke_sanction — 20261102
-- gave it its own in-DB admin check, and it keeps the delta
-- admin-only form; widening it is a separate, explicit decision.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p2p_is_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT public.has_role(p_user_id, 'admin'::app_role)
      OR public.has_role(p_user_id, 'super_admin'::app_role)
      OR public.has_role(p_user_id, 'p2p_admin'::app_role);
$$;

REVOKE ALL ON FUNCTION public.p2p_is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_is_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_is_admin(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_is_admin(uuid) TO service_role;

-- p2p_apply_sanction — delta §D4 + §D10 body; only the
-- supplied-admin verification calls public.p2p_is_admin.
CREATE OR REPLACE FUNCTION public.p2p_apply_sanction(
  p_user_id uuid,
  p_scope text,
  p_level integer,
  p_reason_code text,
  p_detail text,
  p_applied_by text,
  p_duration interval DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_scope NOT IN ('p2p', 'platform') THEN
    RAISE EXCEPTION 'Invalid sanction scope: %', p_scope;
  END IF;
  IF p_level < 0 OR p_level > 4 THEN
    RAISE EXCEPTION 'Invalid sanction level: %', p_level;
  END IF;
  -- Delta-audit D10: a supplied admin identity must be a REAL
  -- admin — verified here, in the database, never trusted from
  -- the caller. NULL means the system path (automation rungs).
  IF p_admin_id IS NOT NULL
     AND NOT public.p2p_is_admin(p_admin_id) THEN
    RAISE EXCEPTION 'Only an admin can apply a sanction';
  END IF;

  INSERT INTO public.user_sanctions (
    user_id, scope, level, reason_code, detail, applied_by, expires_at
  ) VALUES (
    p_user_id, p_scope, p_level, p_reason_code, p_detail, p_applied_by,
    CASE WHEN p_duration IS NULL THEN NULL ELSE now() + p_duration END
  )
  RETURNING id INTO v_id;

  -- Delta-audit D4: the audit row is written HERE, inside the one
  -- function every sanction flows through, so no caller — console,
  -- dispute ruling, or automation — can apply a sanction without
  -- leaving the record.
  PERFORM public.p2p_write_audit(NULL, p_admin_id,
    CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
    'sanction_applied',
    jsonb_build_object('sanction_id', v_id, 'user_id', p_user_id,
                       'scope', p_scope, 'level', p_level,
                       'reason_code', p_reason_code,
                       'applied_by', p_applied_by));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) TO service_role;

-- p2p_resolve_review — delta §D4 body; only the gate calls
-- public.p2p_is_admin.
CREATE OR REPLACE FUNCTION public.p2p_resolve_review(
  p_admin_id uuid,
  p_review_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.p2p_reviews%ROWTYPE;
BEGIN
  IF p_admin_id IS NULL
     OR NOT public.p2p_is_admin(p_admin_id) THEN
    RAISE EXCEPTION 'Only an admin can clear a review';
  END IF;

  UPDATE public.p2p_reviews
     SET status = 'cleared',
         resolved_at = now()
   WHERE id = p_review_id
     AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That review was not found, or has already been cleared';
  END IF;

  PERFORM public.p2p_write_audit(NULL, p_admin_id, 'admin',
    'review_cleared',
    jsonb_build_object('review_id', v_row.id, 'user_id', v_row.user_id,
                       'reason', v_row.reason));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_resolve_review(uuid, uuid) TO service_role;

-- p2p_resolve_dispute — delta §D4 + §D10 body; only the actor
-- gate calls public.p2p_is_admin.
CREATE OR REPLACE FUNCTION public.p2p_resolve_dispute(
  p_admin_id uuid,
  p_dispute_id uuid,
  p_outcome text,
  p_notes text,
  p_sanction_level integer DEFAULT NULL,
  p_sanction_reason_code text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.p2p_disputes%ROWTYPE;
  v_order public.p2p_orders%ROWTYPE;
  v_settled jsonb;
  v_replay jsonb;
  v_loser uuid;
  v_sanction_id uuid;
BEGIN
  IF NOT public.p2p_is_admin(p_admin_id) THEN
    RAISE EXCEPTION 'Only an admin can rule on a dispute';
  END IF;
  IF p_outcome NOT IN ('release_to_buyer', 'refund_to_seller') THEN
    RAISE EXCEPTION 'Invalid ruling outcome: %', p_outcome;
  END IF;
  IF NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Ruling notes are required — state the documentary record the decision rests on';
  END IF;
  IF p_sanction_level IS NOT NULL AND (p_sanction_level < 0 OR p_sanction_level > 4) THEN
    RAISE EXCEPTION 'Invalid sanction level: %', p_sanction_level;
  END IF;

  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;

  IF v_dispute.status <> 'open' THEN
    v_replay := public.p2p_idem_replay(v_dispute.order_id,
      CASE WHEN v_dispute.status = 'ruled_release'
           THEN 'dispute_ruled_release' ELSE 'dispute_ruled_refund' END,
      p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'replayed', true) || v_replay;
    END IF;
    RAISE EXCEPTION 'This dispute has already been ruled';
  END IF;

  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = v_dispute.order_id
   FOR UPDATE;

  v_settled := public.p2p_execute_dispute_outcome(
    v_dispute.order_id, p_dispute_id, p_outcome,
    CASE WHEN p_outcome = 'release_to_buyer' THEN 'ruled_release' ELSE 'ruled_refund' END,
    'admin', p_admin_id, 'admin', true, p_idempotency_key);

  UPDATE public.p2p_disputes
     SET ruled_by = p_admin_id,
         ruling_notes = p_notes,
         updated_at = now()
   WHERE id = p_dispute_id
   RETURNING * INTO v_dispute;

  -- Optional linked sanction (§3.9): applied to the LOSER of the
  -- ruling. Rungs 2+ are human decisions — this is one. The
  -- OKX tariff for a proven non-real-name payment (minimum
  -- 15-day suspension) is a level-1/2 ruling made here.
  IF p_sanction_level IS NOT NULL AND p_sanction_level > 0 THEN
    v_loser := CASE WHEN p_outcome = 'release_to_buyer'
                    THEN v_order.crypto_seller_id ELSE v_order.fiat_buyer_id END;
    v_sanction_id := public.p2p_apply_sanction(
      v_loser, 'p2p', p_sanction_level,
      COALESCE(NULLIF(btrim(COALESCE(p_sanction_reason_code, '')), ''), 'dispute_ruling'),
      p_notes, p_admin_id::text,
      CASE p_sanction_level
        WHEN 1 THEN interval '7 days'
        WHEN 2 THEN interval '90 days'
        ELSE NULL
      END,
      p_admin_id);
    -- No sanction_applied audit row here (delta-audit D4):
    -- p2p_apply_sanction writes its own — now with the ruling
    -- admin's verified identity attached (delta-audit D10).
  END IF;

  RETURN jsonb_build_object('success', true,
                            'order', v_settled -> 'order',
                            'dispute', to_jsonb(v_dispute),
                            'fee_minor', v_settled -> 'fee_minor',
                            'sanction_id', v_sanction_id);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) TO service_role;

-- ---------------------------------------------------------------------
-- 9. ACCOUNT FREEZE (core).
--
-- Shape decision: columns on public.profiles (is_frozen / frozen_at /
-- frozen_reason), NOT a side table. profiles is the one row every
-- account already has; the shared edge helper reads the flag in the
-- same single-row lookup shape the money paths already use, profiles
-- SELECT policies already govern who can see it (own row + admin
-- oversight), and no new RLS surface or join is introduced. Defaults
-- (false / NULL / NULL) make the columns behaviour-neutral for every
-- existing account — including the superadmin's own.
--
-- Column guard: mirroring protect_wallet_balance, a BEFORE UPDATE
-- trigger silently restores the freeze columns whenever the write
-- comes from a user JWT whose holder is not an admin / super_admin —
-- so a user can never unfreeze themselves by updating their own
-- profile row, while the SECURITY DEFINER freeze RPC (whose
-- auth.uid() IS the acting admin) and service-role paths pass.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_frozen boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS frozen_reason text;

CREATE OR REPLACE FUNCTION public.protect_profile_freeze_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    NEW.is_frozen := OLD.is_frozen;
    NEW.frozen_at := OLD.frozen_at;
    NEW.frozen_reason := OLD.frozen_reason;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_freeze_columns() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.protect_profile_freeze_columns() FROM anon;
REVOKE ALL ON FUNCTION public.protect_profile_freeze_columns() FROM authenticated;

DROP TRIGGER IF EXISTS protect_profiles_freeze ON public.profiles;
CREATE TRIGGER protect_profiles_freeze
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_freeze_columns();

-- The freeze switch itself: audited, admin / super_admin only (the
-- actor is auth.uid() — the console calls with the admin's JWT), and
-- it REFUSES to freeze a super_admin: the tier that can unfreeze must
-- never be lockable by a lesser or equal mistake. Every call writes
-- public.audit_logs — the table the /audit-logs page reads.
CREATE OR REPLACE FUNCTION public.admin_set_user_frozen(
  p_user_id uuid,
  p_frozen boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_was_frozen boolean;
BEGIN
  IF v_actor IS NULL
     OR NOT (
       public.has_role(v_actor, 'admin'::public.app_role)
       OR public.has_role(v_actor, 'super_admin'::public.app_role)
     ) THEN
    RAISE EXCEPTION 'Only an admin can freeze or unfreeze an account';
  END IF;

  IF public.has_role(p_user_id, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'A super admin account cannot be frozen';
  END IF;

  SELECT is_frozen INTO v_was_frozen
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found';
  END IF;

  UPDATE public.profiles
     SET is_frozen = p_frozen,
         frozen_at = CASE WHEN p_frozen THEN now() ELSE NULL END,
         frozen_reason = CASE WHEN p_frozen THEN p_reason ELSE NULL END,
         updated_at = now()
   WHERE id = p_user_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (
    v_actor,
    CASE WHEN p_frozen THEN 'account_frozen' ELSE 'account_unfrozen' END,
    'profiles',
    p_user_id::text,
    jsonb_build_object('is_frozen', v_was_frozen),
    jsonb_build_object('is_frozen', p_frozen, 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_frozen', p_frozen
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_user_frozen(uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_user_frozen(uuid, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_user_frozen(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_frozen(uuid, boolean, text) TO service_role;
