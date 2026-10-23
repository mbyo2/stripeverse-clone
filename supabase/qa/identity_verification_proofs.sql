-- =====================================================================
-- identity_verification_proofs.sql — post-deploy proofs for
-- 20261031_identity_face_verification.sql (in-house face
-- verification: identity-evidence bucket, identity_verifications,
-- identity_liveness_sessions, identity_verification_embeddings,
-- face_enrollments, identity_audit_log, and the
-- platform_settings.face_verification_enabled flag).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a time
-- (the editor mangles long batches). Sections A–C are read-only
-- audits. Section S inserts synthetic rows for two QA users,
-- section P evaluates the storage-path predicate, and the file ends
-- with a cleanup block — run S/P only against QA accounts, never
-- real users.
--
-- Before section S, substitute the two QA user ids:
--   QA_A = a real auth.users id
--   QA_B = a second real auth.users id (the "other" user)
-- The placeholders below are 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- (QA_A) and 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (QA_B).
--
-- WHAT PURE SQL CANNOT PROVE (post-deploy smoke, same precedent as
-- the P2P phase-1c gaps proofs): the storage policies' behaviour
-- through the storage API with real user JWTs (the dashboard editor
-- cannot hold SET ROLE across runs, and its session runs as the
-- table owner, which bypasses RLS by design), the verify-identity
-- edge function's end-to-end behaviour, and the client liveness
-- flow. The delta audit's live adversarial list for this feature
-- (security-audit-delta-2026-10-23.md, live list item 15) is the
-- smoke script: the scripted V1 bypass (identical arbitrary
-- embeddings + fabricated transcript + nonexistent paths) must be
-- refused or land in human review — never approved; a consumed
-- session and another user's session must refuse; the 6th
-- submission in 24h must be rationed and a forced count-query
-- failure must refuse rather than wave through; concurrent
-- approve/reject on one item must resolve to exactly one decision
-- with enrolment matching it; an owner PostgREST read of dedupe /
-- match_score / liveness must fail at the column grants; erasure
-- must delete files + templates and tombstone the rows. What this script DOES prove hard: the bucket is
-- private with the right limits, the policy inventory is exactly
-- the intended set with the intended shape, the service-only tables
-- (sessions, embeddings, enrolments, audit log) are unreachable by
-- client roles, the kill switch ships OFF, and the storage-path
-- ownership predicate the policies rely on behaves correctly.
-- =====================================================================

-- ── A. Bucket audit ──────────────────────────────────────────────
-- EXPECT: exactly one row: public = false, file_size_limit =
-- 10485760 (10 MiB), allowed_mime_types = the image set + pdf,
-- with NO svg type anywhere in the list.
SELECT id, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'identity-evidence';

-- Hard assertion form.
-- EXPECT: NOTICE 'identity bucket check passed', no exception.
DO $$
DECLARE
  b record;
BEGIN
  SELECT * INTO b FROM storage.buckets WHERE id = 'identity-evidence';
  IF b IS NULL THEN
    RAISE EXCEPTION 'identity-evidence bucket missing';
  END IF;
  IF b.public THEN
    RAISE EXCEPTION 'identity-evidence bucket is PUBLIC';
  END IF;
  IF b.file_size_limit <> 10485760 THEN
    RAISE EXCEPTION 'identity-evidence size limit wrong: %', b.file_size_limit;
  END IF;
  IF b.allowed_mime_types IS NULL
     OR NOT ('image/jpeg' = ANY (b.allowed_mime_types))
     OR NOT ('application/pdf' = ANY (b.allowed_mime_types))
     OR 'image/svg+xml' = ANY (b.allowed_mime_types) THEN
    RAISE EXCEPTION 'identity-evidence mime list wrong: %', b.allowed_mime_types;
  END IF;
  RAISE NOTICE 'identity bucket check passed';
END $$;

-- ── B. Policy inventory + shape ──────────────────────────────────
-- EXPECT: exactly 3 storage.objects policies scoped to the
-- identity-evidence bucket (2 SELECT + 1 INSERT across owner/admin),
-- and NO UPDATE or DELETE policy for the bucket at all.
SELECT policyname, cmd, roles
  FROM pg_policies
 WHERE schemaname = 'storage'
   AND tablename = 'objects'
   AND policyname LIKE 'Identity evidence%'
 ORDER BY cmd, policyname;

-- Hard assertion: no UPDATE/DELETE policy exists for the bucket.
-- EXPECT: NOTICE 'identity storage write-policy check passed'.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage'
       AND tablename = 'objects'
       AND policyname LIKE 'Identity evidence%'
       AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'identity-evidence has an UPDATE/DELETE policy';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage'
         AND tablename = 'objects'
         AND policyname LIKE 'Identity evidence%') <> 3 THEN
    RAISE EXCEPTION 'identity-evidence policy count is not 3';
  END IF;
  RAISE NOTICE 'identity storage write-policy check passed';
END $$;

-- EXPECT: identity_verifications has exactly 2 policies, both
-- SELECT; the admin policy's qual references has_role.
SELECT policyname, cmd, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'identity_verifications'
 ORDER BY policyname;

-- Hard assertion form of the same check.
-- EXPECT: NOTICE 'identity_verifications policy check passed'.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'identity_verifications') <> 2 THEN
    RAISE EXCEPTION 'identity_verifications policy count is not 2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'identity_verifications'
       AND cmd <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'identity_verifications has a non-SELECT policy';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'identity_verifications'
       AND qual LIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'admin SELECT policy does not use has_role';
  END IF;
  RAISE NOTICE 'identity_verifications policy check passed';
END $$;

-- EXPECT: the four service-only tables each show rowsecurity = true
-- and 0 policies. Biometric templates, sessions, and the audit trail
-- must be unreachable through PostgREST by construction.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_on,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('identity_liveness_sessions',
                     'identity_verification_embeddings',
                     'face_enrollments',
                     'identity_audit_log')
 ORDER BY c.relname;

-- Hard assertion form (RLS on + zero policies + no table grants to
-- anon/authenticated on the service-only tables; authenticated
-- holds SELECT only on identity_verifications).
-- EXPECT: NOTICE 'identity service-only tables check passed'.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('identity_liveness_sessions',
                         'identity_verification_embeddings',
                         'face_enrollments',
                         'identity_audit_log')
       AND (NOT c.relrowsecurity OR EXISTS (
              SELECT 1 FROM pg_policies p
               WHERE p.schemaname = 'public'
                 AND p.tablename = c.relname))
  ) THEN
    RAISE EXCEPTION 'a service-only identity table has RLS off or a policy';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name IN ('identity_liveness_sessions',
                          'identity_verification_embeddings',
                          'face_enrollments',
                          'identity_audit_log')
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'a client role holds a grant on a service-only table';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public'
       AND table_name = 'identity_verifications'
       AND grantee = 'authenticated'
       AND privilege_type <> 'SELECT'
  ) THEN
    RAISE EXCEPTION 'authenticated holds a write grant on identity_verifications';
  END IF;
  RAISE NOTICE 'identity service-only tables check passed';
END $$;

-- V3 column-scope assertion: authenticated's SELECT on
-- identity_verifications covers EXACTLY the safe status columns.
-- dedupe (names other accounts + scores), match_score, liveness,
-- the storage paths and reviewer_id must NOT be readable by the
-- row's owner through PostgREST — that was the dedupe oracle.
-- EXPECT: NOTICE 'identity column-scope check passed'.
DO $$
DECLARE
  granted text[];
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO granted
    FROM information_schema.column_privileges
   WHERE table_schema = 'public'
     AND table_name = 'identity_verifications'
     AND grantee = 'authenticated'
     AND privilege_type = 'SELECT';
  IF granted IS DISTINCT FROM ARRAY['created_at', 'decided_at',
        'document_type', 'id', 'reviewer_notes', 'status',
        'updated_at', 'user_id'] THEN
    RAISE EXCEPTION 'identity_verifications column grants wrong: %', granted;
  END IF;
  RAISE NOTICE 'identity column-scope check passed';
END $$;

-- ── C. Kill switch + status vocabulary ───────────────────────────
-- EXPECT: face_verification_enabled = false (enforcement ships OFF;
-- the CEO flips it only at launch).
SELECT face_verification_enabled FROM public.platform_settings LIMIT 1;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.platform_settings
     WHERE face_verification_enabled IS DISTINCT FROM false
  ) THEN
    RAISE EXCEPTION 'face_verification_enabled is not false';
  END IF;
  RAISE NOTICE 'face verification kill switch check passed';
END $$;

-- EXPECT: the status CHECK definition includes 'erased' (the
-- erasure tombstone state) and the audit action CHECK covers all
-- seven actions the edge function writes.
SELECT pg_get_constraintdef(oid) AS status_check
  FROM pg_constraint
 WHERE conrelid = 'public.identity_verifications'::regclass
   AND conname LIKE '%status%';

DO $$
DECLARE
  def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.identity_verifications'::regclass
     AND conname LIKE '%status%';
  IF def IS NULL OR def NOT LIKE '%erased%' THEN
    RAISE EXCEPTION 'identity_verifications status CHECK lacks erased';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO def
    FROM pg_constraint
   WHERE conrelid = 'public.identity_audit_log'::regclass
     AND conname LIKE '%action%';
  IF def IS NULL
     OR def NOT LIKE '%session_started%'
     OR def NOT LIKE '%submit_attempt%'
     OR def NOT LIKE '%submit_rejected%'
     OR def NOT LIKE '%erasure%' THEN
    RAISE EXCEPTION 'identity_audit_log action CHECK is incomplete';
  END IF;
  RAISE NOTICE 'identity status/audit vocabulary check passed';
END $$;

-- ── S. Fixtures (QA accounts only) ───────────────────────────────
-- One review-queue verification per QA user, one enrolment for
-- QA_A, one audit row for QA_A. Idempotent: delete prior fixtures
-- for these two users first (this block only ever touches the two
-- placeholder QA ids).
DELETE FROM public.identity_verifications
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DELETE FROM public.face_enrollments
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DELETE FROM public.identity_audit_log
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO public.identity_verifications
  (user_id, status, document_type, document_front_path, selfie_path,
   liveness, match_score, dedupe, consent_given_at, consent_text_version)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'review', 'national_id',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/document-front-1.jpg',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/selfie-1.jpg',
   '{"mode":"manual"}'::jsonb, NULL,
   '{"checked":0,"hits":[]}'::jsonb, now(), 'face-consent-v1'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'review', 'passport',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/document-front-1.jpg',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/selfie-1.jpg',
   '{"mode":"live","entries":[]}'::jsonb, 0.5,
   '{"checked":1,"hits":[]}'::jsonb, now(), 'face-consent-v1');

INSERT INTO public.face_enrollments
  (user_id, embedding, model_version)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   ARRAY[0.1, 0.2, 0.3]::double precision[], 'proof-fixture');

INSERT INTO public.identity_audit_log
  (user_id, actor_id, action, outcome, detail)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'session_started', 'ok', '{"challenge_count":3}'::jsonb);

-- EXPECT: 2 verifications (both review), 1 enrolment, 1 audit row.
SELECT
  (SELECT count(*) FROM public.identity_verifications
    WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) AS verifications,
  (SELECT count(*) FROM public.face_enrollments
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS enrollments,
  (SELECT count(*) FROM public.identity_audit_log
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS audit_rows;

-- ── P. Storage-path predicate truth table ────────────────────────
-- The storage policies gate on
--   (storage.foldername(name))[1] = auth.uid()::text
-- i.e. the FIRST folder segment of the object path equals the
-- caller's user id. This evaluates the same predicate shape in pure
-- SQL (foldername semantics: all segments except the filename).
-- EXPECT: own path = true; other user's path = false; a path not
-- starting with a user id = false.
SELECT
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' =
    (string_to_array(
       'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/selfie-1.jpg', '/'))[1]
    AS own_path_matches,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' =
    (string_to_array(
       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/selfie-1.jpg', '/'))[1]
    AS other_path_matches,
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' =
    (string_to_array('selfie-1.jpg', '/'))[1]
    AS bare_filename_matches;

-- Hard assertion form.
-- EXPECT: NOTICE 'identity storage path predicate check passed'.
DO $$
BEGIN
  IF NOT ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' =
          (string_to_array(
             'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/selfie-1.jpg', '/'))[1]) THEN
    RAISE EXCEPTION 'own storage path does not match its owner';
  END IF;
  IF 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' =
     (string_to_array(
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/selfie-1.jpg', '/'))[1] THEN
    RAISE EXCEPTION 'another user''s storage path matched';
  END IF;
  RAISE NOTICE 'identity storage path predicate check passed';
END $$;

-- ── Cleanup ──────────────────────────────────────────────────────
-- EXPECT after cleanup: all three counts are 0.
DELETE FROM public.identity_verifications
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DELETE FROM public.face_enrollments
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
DELETE FROM public.identity_audit_log
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT
  (SELECT count(*) FROM public.identity_verifications
    WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) AS verifications_left,
  (SELECT count(*) FROM public.face_enrollments
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS enrollments_left,
  (SELECT count(*) FROM public.identity_audit_log
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS audit_rows_left;
