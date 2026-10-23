-- =====================================================================
-- superadmin_foundation_proofs.sql — post-deploy proofs for
-- 20261104_superadmin_roles_enum.sql +
-- 20261105_superadmin_foundation.sql (superadmin foundation:
-- super_admin tier, role-management supremacy, role-change audit,
-- admin read paths, admin directory RPC, per-feature P2P roles,
-- account freeze core).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a
-- time (the editor mangles long batches and does not preserve
-- SET ROLE across Runs — so every RLS/RPC case below is a single
-- DO block that sets the JWT claims and switches role
-- transaction-locally inside itself). Run the two migrations FIRST
-- (20261104's five ALTER TYPE statements each in their OWN Run),
-- then this file top to bottom.
--
-- Substitute FIVE ids before running (real auth.users ids):
--   OWNER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
--           -> the superadmin account (mbyotwo3@gmail.com,
--              f9cf338f-dc77-403b-b2ec-e609951c8440). Its live
--              'admin' + 'super_admin' rows are the subject of the
--              supremacy proofs — never substituted with a QA user.
--   ADMIN = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
--           -> a QA user the fixtures grant plain 'admin' to.
--   QA_A  = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (plain user;
--              freeze + audit-trail target)
--   QA_B  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (plain user;
--              role-grant target / bystander)
--   QA_C  = 'cccccccc-cccc-cccc-cccc-cccccccccccc' (plain user the
--              fixtures grant 'p2p_admin' to)
-- QA_A / QA_B / QA_C / ADMIN must be disposable QA accounts.
--
-- WHAT PURE SQL CANNOT PROVE — stated honestly:
-- * The edge-function freeze wiring (which functions call the
--   shared guard) is TypeScript; it is covered by
--   tests/admin/accountFreeze.test.ts for the guard itself and by
--   code inspection for the call sites. P11 proves the exact DB
--   read the guard performs (profiles.is_frozen for the target).
-- * The p2p edge function's isAdmin role set is likewise TS; P12
--   proves the DB helper (public.p2p_is_admin) it mirrors.
-- =====================================================================

-- ── S0. Fixture cleanup from any previous proof run ──────────────
-- EXPECT: success.
DELETE FROM public.wallets
 WHERE id IN ('a1111111-1111-4111-8111-111111111111',
              'b1111111-1111-4111-8111-111111111111');

DELETE FROM public.accounts
 WHERE id = 'dacc0000-0000-4000-8000-000000000001';

DELETE FROM public.user_roles
 WHERE user_id IN ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc');

DELETE FROM public.role_audit
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
    OR changed_by IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');

UPDATE public.profiles SET is_frozen = false, frozen_at = NULL, frozen_reason = NULL
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- ── S1. Fixtures (as postgres): profiles, roles, wallets ─────────
-- Owner role rows are inserted defensively (the migration already
-- granted super_admin live; ON CONFLICT keeps this a no-op there).
INSERT INTO public.profiles (id, first_name, last_name, phone)
VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Proof', 'Admin', '0977000001'),
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proof', 'A', '0977000002'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proof', 'B', '0977000003'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Proof', 'C', '0977000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin'),
       ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'super_admin'),
       ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'admin'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'p2p_admin')
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.wallets (id, user_id, currency, balance, status, account_id)
VALUES ('a1111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', 0, 'active', NULL),
       ('b1111111-1111-4111-8111-111111111111',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'USD', 0, 'active', NULL)
ON CONFLICT (id) DO NOTHING;

-- ── P1. The owner holds super_admin ──────────────────────────────
-- EXPECT: NOTICE 'P1 PASS ...'.
DO $$
BEGIN
  IF NOT public.has_role('dddddddd-dddd-dddd-dddd-dddddddddddd', 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'P1 FAIL: owner does not hold super_admin';
  END IF;
  IF NOT public.has_role('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin'::app_role) THEN
    RAISE EXCEPTION 'P1 FAIL: owner lost the admin role (additive-only violated)';
  END IF;
  RAISE NOTICE 'P1 PASS: owner holds super_admin AND admin (additive)';
END $$;

-- ── P2. A plain admin CANNOT delete the owner's role rows ────────
-- The console path is a direct table DELETE under the admin's JWT.
-- EXPECT: NOTICE 'P2 PASS ...' (both deletes affect 0 rows; the
-- owner's rows survive — checked under the same admin session via
-- the admin SELECT policy).
DO $$
DECLARE v_deleted integer; v_left integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  DELETE FROM public.user_roles
   WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND role = 'admin';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'P2 FAIL: plain admin deleted the owner admin row';
  END IF;

  DELETE FROM public.user_roles
   WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' AND role = 'super_admin';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'P2 FAIL: plain admin deleted the owner super_admin row';
  END IF;

  SELECT count(*) INTO v_left FROM public.user_roles
   WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     AND role IN ('admin', 'super_admin');
  IF v_left <> 2 THEN
    RAISE EXCEPTION 'P2 FAIL: owner role rows changed (visible count %)', v_left;
  END IF;
  RAISE NOTICE 'P2 PASS: plain admin cannot delete the owner role rows';
END $$;

-- ── P3. A plain admin CANNOT grant an elevated role ──────────────
-- EXPECT: NOTICE 'P3 PASS ...' (insert refused with 42501 by the
-- WITH CHECK of the manage policy).
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.user_roles (user_id, role)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P3 FAIL: plain admin granted the admin role';
  END IF;
  RAISE NOTICE 'P3 PASS: plain admin cannot grant an elevated role';
END $$;

-- ── P4. A plain admin CAN still grant a base role ────────────────
-- EXPECT: NOTICE 'P4 PASS ...' (base-role management unchanged).
DO $$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'beta_tester');
  SELECT count(*) INTO v_n FROM public.user_roles
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND role = 'beta_tester';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P4 FAIL: base-role grant by plain admin did not land';
  END IF;
  RAISE NOTICE 'P4 PASS: plain admin still grants base roles';
END $$;

-- ── P5. The super_admin CAN grant and remove an elevated role ────
-- EXPECT: NOTICE 'P5 PASS ...'.
DO $$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin');
  SELECT count(*) INTO v_n FROM public.user_roles
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND role = 'admin';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P5 FAIL: super_admin grant of admin did not land';
  END IF;
  DELETE FROM public.user_roles
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND role = 'admin';
  SELECT count(*) INTO v_n FROM public.user_roles
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND role = 'admin';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'P5 FAIL: super_admin removal of admin did not land';
  END IF;
  RAISE NOTICE 'P5 PASS: super_admin grants and removes elevated roles';
END $$;

-- ── P6. Console-path role changes are audited (trigger) ──────────
-- A direct table write by the owner (exactly what /admin/users
-- does) must leave role_audit rows for BOTH the insert and the
-- delete, attributed to the owner.
-- EXPECT: NOTICE 'P6 PASS ...'.
DO $$
DECLARE v_ins integer; v_del integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'beta_tester');
  DELETE FROM public.user_roles
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND role = 'beta_tester';
  -- audit rows are read back as postgres after this block segment;
  -- within the owner session they are visible via the audit SELECT
  -- policy (admin/super_admin).
  SELECT count(*) INTO v_ins FROM public.role_audit
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND new_role = 'beta_tester' AND old_role IS NULL
     AND changed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  SELECT count(*) INTO v_del FROM public.role_audit
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND old_role = 'beta_tester' AND new_role IS NULL
     AND changed_by = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  IF v_ins < 1 OR v_del < 1 THEN
    RAISE EXCEPTION 'P6 FAIL: trigger audit rows missing (ins %, del %)', v_ins, v_del;
  END IF;
  RAISE NOTICE 'P6 PASS: console-path role changes write role_audit rows';
END $$;

-- ── P7. RPC guards: validate_role_change + promote_user_role ─────
-- (a) validate as plain admin on an elevated role returns FALSE and
--     changes nothing. (b) promote as plain admin raises the
--     supremacy message. (c) promote as super_admin succeeds and
--     replaces the target's roles; promoting back restores 'user'.
-- EXPECT: NOTICE 'P7 PASS ...'.
DO $$
DECLARE v_ok boolean; v_blocked boolean := false; v_n integer;
BEGIN
  -- (a) as ADMIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_ok := public.validate_role_change(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'proof P7a');
  IF v_ok THEN
    RAISE EXCEPTION 'P7 FAIL: validate_role_change authorised an admin grant by a plain admin';
  END IF;

  -- (b) as ADMIN
  BEGIN
    PERFORM public.promote_user_role(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin'::app_role, 'proof P7b');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := SQLERRM LIKE '%Only a super admin can grant%';
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P7 FAIL: promote_user_role let a plain admin grant admin';
  END IF;

  -- (c) as OWNER
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
  v_ok := public.promote_user_role(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin'::app_role, 'proof P7c');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'P7 FAIL: super_admin promote to admin returned false';
  END IF;
  v_ok := public.promote_user_role(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'user'::app_role, 'proof P7c restore');
  IF NOT v_ok THEN
    RAISE EXCEPTION 'P7 FAIL: super_admin promote back to user returned false';
  END IF;
  SELECT count(*) INTO v_n FROM public.user_roles
   WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND role = 'user';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P7 FAIL: target roles not restored to user';
  END IF;
  RAISE NOTICE 'P7 PASS: RPC guards enforce supremacy; super_admin promote works';
END $$;

-- ── P8. Oversight reads: admin sees, cannot write; users isolated ─
-- EXPECT: NOTICE 'P8 PASS ...'.
DO $$
DECLARE v_n integer; v_updated integer; v_bal numeric;
BEGIN
  -- Admin reads another user's wallet.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO v_n FROM public.wallets
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'P8 FAIL: admin cannot read another user wallet';
  END IF;

  -- Admin tries to WRITE that wallet: no UPDATE policy admits them.
  UPDATE public.wallets SET balance = 999
   WHERE id = 'a1111111-1111-4111-8111-111111111111';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'P8 FAIL: admin updated another user wallet';
  END IF;

  -- A plain user still cannot see the other user's wallet at all.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.wallets
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'P8 FAIL: plain user can read another user wallet';
  END IF;

  -- And the balance really is untouched (read as the wallet owner).
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  SELECT balance INTO v_bal FROM public.wallets
   WHERE id = 'a1111111-1111-4111-8111-111111111111';
  IF v_bal <> 0 THEN
    RAISE EXCEPTION 'P8 FAIL: fixture wallet balance changed (%)', v_bal;
  END IF;
  RAISE NOTICE 'P8 PASS: oversight is read-only; user isolation unchanged';
END $$;

-- ── P9. admin_list_users: refused for users, works for admins ────
-- EXPECT: NOTICE 'P9 PASS ...'.
DO $$
DECLARE v_blocked boolean := false; v_n integer; v_email text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM * FROM public.admin_list_users();
  EXCEPTION WHEN OTHERS THEN
    v_blocked := SQLERRM LIKE '%Only an admin can list platform users%';
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P9 FAIL: non-admin listed platform users';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  SELECT count(*) INTO v_n FROM public.admin_list_users();
  IF v_n < 1 THEN
    RAISE EXCEPTION 'P9 FAIL: admin_list_users returned no rows for an admin';
  END IF;
  SELECT email INTO v_email FROM public.admin_list_users()
   WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  IF v_email IS NULL OR position('@' in v_email) = 0 THEN
    RAISE EXCEPTION 'P9 FAIL: owner email not returned by admin_list_users';
  END IF;
  RAISE NOTICE 'P9 PASS: admin_list_users refuses users, returns directory for admins';
END $$;

-- ── P10. Freeze guards: actor must be staff; super_admin immune ──
-- EXPECT: NOTICE 'P10 PASS ...'. (This is also regression R2: the
-- freeze machinery cannot target the super_admin.)
DO $$
DECLARE v_blocked boolean := false; v_immune boolean := false;
BEGIN
  -- Non-admin actor.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.admin_set_user_frozen(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true, 'proof P10');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := SQLERRM LIKE '%Only an admin can freeze%';
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P10 FAIL: non-admin froze an account';
  END IF;

  -- Admin actor, super_admin target.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  BEGIN
    PERFORM public.admin_set_user_frozen(
      'dddddddd-dddd-dddd-dddd-dddddddddddd', true, 'proof P10');
  EXCEPTION WHEN OTHERS THEN
    v_immune := SQLERRM LIKE '%cannot be frozen%';
  END;
  IF NOT v_immune THEN
    RAISE EXCEPTION 'P10 FAIL: a super_admin account was frozen';
  END IF;
  RAISE NOTICE 'P10 PASS: freeze refuses non-admins and never targets a super_admin';
END $$;

-- ── P11. Freeze lifecycle: flag, audit, send-path read, unfreeze ─
-- EXPECT: NOTICE 'P11 PASS ...'.
DO $$
DECLARE v_res jsonb; v_flag boolean; v_n integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- Freeze QA_A.
  v_res := public.admin_set_user_frozen(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true, 'proof P11 freeze');
  IF COALESCE((v_res ->> 'is_frozen')::boolean, false) <> true THEN
    RAISE EXCEPTION 'P11 FAIL: freeze RPC did not report is_frozen true';
  END IF;

  -- The exact read the edge freeze guard performs (service role):
  SELECT is_frozen INTO v_flag FROM public.profiles
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'P11 FAIL: profiles.is_frozen is not true after freeze';
  END IF;

  -- The audit row the /audit-logs page reads.
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'account_frozen'
     AND record_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'P11 FAIL: account_frozen audit_logs row missing';
  END IF;

  -- The frozen user cannot clear their own flag: their profile
  -- UPDATE runs, but the column guard restores the frozen values.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  UPDATE public.profiles SET is_frozen = false
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  PERFORM set_config('request.jwt.claims',
    '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}', true);
  SELECT is_frozen INTO v_flag FROM public.profiles
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_flag IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'P11 FAIL: frozen user cleared their own freeze flag';
  END IF;

  -- Unfreeze restores normal state.
  v_res := public.admin_set_user_frozen(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false, NULL);
  SELECT is_frozen INTO v_flag FROM public.profiles
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_flag IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'P11 FAIL: unfreeze did not clear the flag';
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_logs
   WHERE action = 'account_unfrozen'
     AND record_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'P11 FAIL: account_unfrozen audit_logs row missing';
  END IF;
  RAISE NOTICE 'P11 PASS: freeze lifecycle + audit + self-unfreeze guard';
END $$;

-- ── P12. Per-feature role: p2p_admin passes the P2P admin helper ─
-- The DB helper public.p2p_is_admin is the mirror of the p2p edge
-- function's isAdmin (admin / super_admin / p2p_admin). It is
-- service-role-only: authenticated callers are refused at the ACL.
-- EXPECT: NOTICE 'P12 PASS ...'.
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  IF public.p2p_is_admin('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') THEN
    RAISE EXCEPTION 'P12 FAIL: plain user passes p2p_is_admin';
  END IF;
  IF NOT public.p2p_is_admin('cccccccc-cccc-cccc-cccc-cccccccccccc') THEN
    RAISE EXCEPTION 'P12 FAIL: p2p_admin does not pass p2p_is_admin';
  END IF;
  IF NOT public.p2p_is_admin('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') THEN
    RAISE EXCEPTION 'P12 FAIL: admin does not pass p2p_is_admin';
  END IF;
  IF NOT public.p2p_is_admin('dddddddd-dddd-dddd-dddd-dddddddddddd') THEN
    RAISE EXCEPTION 'P12 FAIL: super_admin does not pass p2p_is_admin';
  END IF;

  PERFORM set_config('request.jwt.claims',
    '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.p2p_is_admin('cccccccc-cccc-cccc-cccc-cccccccccccc');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P12 FAIL: p2p_is_admin is callable by authenticated clients';
  END IF;
  RAISE NOTICE 'P12 PASS: p2p_is_admin accepts staff tiers, refuses plain users, service-role only';
END $$;

-- ── P13. A p2p_admin passes the dispute-resolution actor check ───
-- p2p_resolve_dispute's first gate is p2p_is_admin(p_admin_id).
-- With a nonexistent dispute id, a STAFF caller must get past the
-- actor gate and fail later with 'Dispute not found', while a
-- plain user must fail AT the gate. (p2p_apply_sanction on main
-- carries no in-DB actor check — service_role ACL only; the
-- dispute resolver is the checkable surface.)
-- EXPECT: NOTICE 'P13 PASS ...'.
DO $$
DECLARE v_msg text := ''; v_gate boolean := false;
BEGIN
  BEGIN
    PERFORM public.p2p_resolve_dispute(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      '99999999-9999-4999-8999-999999999999',
      'release_to_buyer', 'proof P13', NULL, NULL, 'proof-p13-key');
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_msg LIKE '%Only an admin can rule on a dispute%' THEN
    RAISE EXCEPTION 'P13 FAIL: p2p_admin was refused at the dispute actor gate';
  END IF;
  IF v_msg NOT LIKE '%Dispute not found%' THEN
    RAISE EXCEPTION 'P13 FAIL: unexpected resolver error for p2p_admin: %', v_msg;
  END IF;

  v_msg := '';
  BEGIN
    PERFORM public.p2p_resolve_dispute(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '99999999-9999-4999-8999-999999999999',
      'release_to_buyer', 'proof P13', NULL, NULL, 'proof-p13-key-2');
  EXCEPTION WHEN OTHERS THEN
    v_gate := SQLERRM LIKE '%Only an admin can rule on a dispute%';
  END;
  IF NOT v_gate THEN
    RAISE EXCEPTION 'P13 FAIL: plain user was not refused at the dispute actor gate';
  END IF;
  RAISE NOTICE 'P13 PASS: dispute actor gate accepts p2p_admin, refuses plain users';
END $$;

-- ── R1. REGRESSION (additive-only): normal user flows unchanged ───
-- (a) The owner, acting as an ordinary user under his own JWT,
--     creates a sub-account and reads/updates his own profile —
--     super_admin changed none of it. (b) A plain QA user creates
--     their own wallet exactly as before (20261103 policy) and
--     reads their own profile. (c) The owner is NOT frozen.
-- EXPECT: NOTICE 'R1 PASS ...'.
DO $$
DECLARE v_n integer; v_flag boolean; v_acct uuid;
BEGIN
  -- (a) owner as normal user
  PERFORM set_config('request.jwt.claims',
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.accounts (user_id, name, kind, status)
  VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Proof regression', 'custom', 'active')
  RETURNING id INTO v_acct;
  UPDATE public.profiles SET first_name = first_name
   WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAIL: owner cannot update own profile';
  END IF;
  SELECT is_frozen INTO v_flag FROM public.profiles
   WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  IF v_flag IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'R1 FAIL: owner profile is frozen';
  END IF;

  -- (b) plain QA user as normal user
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EUR', 0, 'active', NULL);
  SELECT count(*) INTO v_n FROM public.wallets
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' AND currency = 'EUR';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAIL: plain user own wallet creation changed';
  END IF;
  SELECT count(*) INTO v_n FROM public.profiles
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAIL: plain user cannot read own profile';
  END IF;
  RAISE NOTICE 'R1 PASS: owner and plain-user normal flows unchanged (additive-only)';
END $$;

-- ── Z1. Residue-free cleanup ──────────────────────────────────────
-- Removes every fixture artifact this file created. The owner's own
-- role rows are NOT touched (they are the production grant, not
-- fixtures). At relay, ADMIN/QA_A/QA_B/QA_C are disposable QA
-- accounts scheduled for full deletion at programme end.
DELETE FROM public.wallets
 WHERE id IN ('a1111111-1111-4111-8111-111111111111',
              'b1111111-1111-4111-8111-111111111111')
    OR (user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND currency = 'EUR' AND account_id IS NULL);

DELETE FROM public.accounts
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   AND name = 'Proof regression';

DELETE FROM public.audit_logs
 WHERE record_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND action IN ('account_frozen', 'account_unfrozen');

DELETE FROM public.user_roles
 WHERE user_id IN ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc');

DELETE FROM public.role_audit
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
    OR changed_by IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- ── Z2. Residue check — EXPECT: residue = 0 ──────────────────────
SELECT
  (SELECT count(*) FROM public.wallets
    WHERE id IN ('a1111111-1111-4111-8111-111111111111',
                 'b1111111-1111-4111-8111-111111111111')) +
  (SELECT count(*) FROM public.user_roles
    WHERE user_id IN ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc')) +
  (SELECT count(*) FROM public.role_audit
    WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
       OR changed_by IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         'cccccccc-cccc-cccc-cccc-cccccccccccc',
                         'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                         'dddddddd-dddd-dddd-dddd-dddddddddddd')) +
  (SELECT count(*) FROM public.audit_logs
    WHERE record_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND action IN ('account_frozen', 'account_unfrozen'))
  AS residue;
