-- =====================================================================
-- p2p_phase1c_gaps_proofs.sql — post-deploy proofs for
-- 20261030_p2p_phase1c_gaps.sql (Phase 1c live-gap fixes: the
-- `p2p-evidence` storage bucket + policies, and the admin SELECT
-- policy on p2p_payment_methods).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a
-- time (the editor mangles long batches). Sections A–C are
-- read-only audits. Sections S + P create synthetic fixture rows
-- for QA users and end with a cleanup block — run ONLY against QA
-- accounts, never real users.
--
-- Substitute FOUR ids before running:
--   QA_A     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (advertiser)
--   QA_B     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (taker/buyer)
--   QA_C     'cccccccc-cccc-cccc-cccc-cccccccccccc' (stranger)
--   QA_ADMIN 'dddddddd-dddd-dddd-dddd-dddddddddddd' (a user WITH
--            an 'admin' row in public.user_roles)
-- Fixture row ids are fixed literals (AD/ORDER/DISPUTE/GHOST
-- below), so the harness paths are exact.
--
-- WHAT PURE SQL CAN AND CANNOT PROVE HERE — stated honestly:
-- Sections A–C prove the deployed CONFIGURATION: the bucket row
-- (private, size cap, mime list), the exact policy inventory on
-- storage.objects and p2p_payment_methods, and that no UPDATE /
-- DELETE policy exists for the bucket. Section P proves the LOGIC:
-- the policy participant predicate, copied verbatim from the
-- migration with a literal subject in place of auth.uid(), is
-- evaluated against real fixture rows and must return the truth
-- table below. Section C also calls public.has_role() directly
-- (it takes an explicit user id) to prove the admin wiring.
-- What SQL CANNOT prove is the storage API's end-to-end behaviour
-- with real JWTs: an actual file upload being admitted/refused,
-- createSignedUrl(path, 600) minting for a SELECT-admitted caller
-- and refusing for a stranger, and the storage server enforcing
-- file_size_limit / allowed_mime_types on the upload bytes
-- (including what Content-Type iPhone HEIC photos arrive with).
-- Those join the post-deploy smoke list and are NOT proven here.
--
-- TRUTH TABLE (participant predicate, subject × path):
--   QA_A × chat/<ORDER>/…      true    QA_B × proof/<ORDER>/…   true
--   QA_A × disputes/<DISP>/…   true    QA_B × disputes/<DISP>/… true
--   QA_C × chat/<ORDER>/…      false   QA_C × disputes/<DISP>/… false
--   QA_A × chat/<GHOST>/…      false   (order does not exist)
--   QA_A × 'receipt.png'       false   (no folder segments)
--   QA_A × misc/<ORDER>/…      false   (unknown folder kind)
-- Admin predicate (has_role): QA_ADMIN true; QA_A / QA_C false.
-- =====================================================================

-- ── A. Bucket audit ──────────────────────────────────────────────
-- EXPECT: exactly 1 row: public = false, file_size_limit =
-- 10485760, allowed_mime_types = the 10-type list (9 image formats
-- + application/pdf; image/svg+xml deliberately absent).
SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'p2p-evidence';

-- Hard assertion form of the same check.
-- EXPECT: a NOTICE 'p2p-evidence bucket check passed', no exception.
DO $$
DECLARE
  v_row storage.buckets%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM storage.buckets WHERE id = 'p2p-evidence';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'p2p-evidence bucket check FAILED: bucket missing';
  END IF;
  IF v_row.public THEN
    RAISE EXCEPTION 'p2p-evidence bucket check FAILED: bucket is public';
  END IF;
  IF v_row.file_size_limit IS DISTINCT FROM 10485760 THEN
    RAISE EXCEPTION 'p2p-evidence bucket check FAILED: file_size_limit is %',
      v_row.file_size_limit;
  END IF;
  IF NOT ('application/pdf' = ANY (v_row.allowed_mime_types))
     OR NOT ('image/jpeg' = ANY (v_row.allowed_mime_types))
     OR NOT ('image/png' = ANY (v_row.allowed_mime_types)) THEN
    RAISE EXCEPTION 'p2p-evidence bucket check FAILED: core mime types missing';
  END IF;
  IF 'image/svg+xml' = ANY (v_row.allowed_mime_types) THEN
    RAISE EXCEPTION 'p2p-evidence bucket check FAILED: svg must stay excluded';
  END IF;
  RAISE NOTICE 'p2p-evidence bucket check passed';
END $$;

-- ── B. storage.objects policy inventory for the bucket ───────────
-- EXPECT: exactly 3 rows — one INSERT (participants upload), two
-- SELECT (participants view, admins view) — all TO authenticated.
-- No UPDATE, no DELETE, no ALL, nothing for anon or public.
SELECT policyname, cmd, roles, qual, with_check
  FROM pg_policies
 WHERE schemaname = 'storage'
   AND tablename = 'objects'
   AND (qual ILIKE '%p2p-evidence%' OR with_check ILIKE '%p2p-evidence%')
 ORDER BY cmd, policyname;

-- Hard assertion form.
-- EXPECT: a NOTICE 'storage policy inventory check passed'.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND (qual ILIKE '%p2p-evidence%' OR with_check ILIKE '%p2p-evidence%')
     ) <> 3 THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: expected exactly 3 bucket policies';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (qual ILIKE '%p2p-evidence%' OR with_check ILIKE '%p2p-evidence%')
       AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: an UPDATE/DELETE policy exists — evidence must be immutable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (qual ILIKE '%p2p-evidence%' OR with_check ILIKE '%p2p-evidence%')
       AND ('anon' = ANY (roles) OR 'public' = ANY (roles))
  ) THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: anon/public role admitted';
  END IF;
  -- INSERT policy must carry the participant predicate fragments.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'P2P evidence: participants can upload to their trades'
       AND cmd = 'INSERT'
       AND with_check ILIKE '%advertiser_id%'
       AND with_check ILIKE '%taker_id%'
       AND with_check ILIKE '%chat%'
       AND with_check ILIKE '%proof%'
       AND with_check ILIKE '%disputes%'
  ) THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: INSERT participant policy missing or altered';
  END IF;
  -- Participant SELECT policy likewise.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'P2P evidence: participants can view their trade files'
       AND cmd = 'SELECT'
       AND qual ILIKE '%advertiser_id%'
       AND qual ILIKE '%taker_id%'
  ) THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: SELECT participant policy missing or altered';
  END IF;
  -- Admin SELECT policy must gate on has_role, not profiles.role.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND policyname = 'P2P evidence: admins can view all files'
       AND cmd = 'SELECT'
       AND qual ILIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'storage policy inventory FAILED: admin SELECT policy missing or not has_role-gated';
  END IF;
  RAISE NOTICE 'storage policy inventory check passed';
END $$;

-- ── C. p2p_payment_methods policy inventory + admin wiring ───────
-- EXPECT: exactly 2 rows, both SELECT TO authenticated: the
-- pre-existing Phase 0 own-row policy (qual on auth.uid() =
-- user_id, UNTOUCHED by the gaps migration) and the new admin
-- policy (qual on has_role).
SELECT policyname, cmd, roles, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'p2p_payment_methods'
 ORDER BY policyname;

-- Hard assertion form.
-- EXPECT: a NOTICE 'payment methods policy check passed'.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename = 'p2p_payment_methods'
     ) <> 2 THEN
    RAISE EXCEPTION 'payment methods policy check FAILED: expected exactly 2 policies';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'p2p_payment_methods'
       AND policyname = 'Users can view their own payment methods'
       AND cmd = 'SELECT'
       AND qual ILIKE '%auth.uid()%'
       AND qual ILIKE '%user_id%'
       AND qual NOT ILIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'payment methods policy check FAILED: Phase 0 own-row policy missing or altered';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'p2p_payment_methods'
       AND policyname = 'Admins can view all P2P payment methods'
       AND cmd = 'SELECT'
       AND qual ILIKE '%has_role%'
  ) THEN
    RAISE EXCEPTION 'payment methods policy check FAILED: admin policy missing or not has_role-gated';
  END IF;
  RAISE NOTICE 'payment methods policy check passed';
END $$;

-- The admin helper itself, called directly (it takes an explicit
-- user id, so this is a real behavioural check of the user_roles
-- wiring the policies depend on).
-- EXPECT: one row: admin_is_admin = true, a_is_admin = false,
-- c_is_admin = false.
SELECT public.has_role('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin'::app_role) AS admin_is_admin,
       public.has_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'::app_role) AS a_is_admin,
       public.has_role('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin'::app_role) AS c_is_admin;

-- ── S. Fixtures (QA users only) ──────────────────────────────────
-- One ad (QA_A), one order on it (advertiser QA_A, taker QA_B),
-- one open dispute on that order (opened by QA_B), and QA_B's
-- registered payment method (the row the console needs to read).
-- Literal ids keep the Section P paths exact.

INSERT INTO public.p2p_ads (
  id, owner_id, side, asset, price_type, fixed_price_zmw,
  total_amount_minor, min_order_zmw, max_order_zmw, status)
VALUES (
  'd3333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'sell_crypto', 'BTC', 'fixed', 1000000,
  100000, 100, 1000, 'paused');

INSERT INTO public.p2p_orders (
  id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
  asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
  status, expires_at)
VALUES (
  'd1111111-1111-4111-8111-111111111111',
  'd3333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'BTC', 1000, 100, 1000000,
  'disputed', now() + interval '1 day');

INSERT INTO public.p2p_disputes (
  id, order_id, opened_by, reason, status)
VALUES (
  'd2222222-2222-4222-8222-222222222222',
  'd1111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'paid_not_received', 'open');

INSERT INTO public.p2p_payment_methods (
  user_id, type, account_number, account_number_norm, account_name, status)
VALUES (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'mobile_money', '0977 000 111',
  public.p2p_normalise_account_number('0977 000 111'),
  'QA Buyer', 'active');

-- ── P. Participant-predicate truth table ─────────────────────────
-- The predicate below is the migration's WITH CHECK / USING body
-- copied verbatim, with a literal subject standing in for
-- auth.uid() and a literal path standing in for `name`. Each
-- SELECT returns one row; `allowed` must match the header's
-- truth table. Run them one at a time, or rely on the hard
-- assertion block at the end of the section.

-- P1. QA_A (advertiser) × chat path. EXPECT: allowed = true.
SELECT (
  (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) OR (
  (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) AS allowed;

-- P2. QA_B (taker) × proof path. EXPECT: allowed = true.
SELECT (
  (storage.foldername('proof/d1111111-1111-4111-8111-111111111111/1700000000000-proof.pdf'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('proof/d1111111-1111-4111-8111-111111111111/1700000000000-proof.pdf'))[2]
       AND (o.advertiser_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' OR o.taker_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
) OR (
  (storage.foldername('proof/d1111111-1111-4111-8111-111111111111/1700000000000-proof.pdf'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('proof/d1111111-1111-4111-8111-111111111111/1700000000000-proof.pdf'))[2]
       AND (o.advertiser_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' OR o.taker_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
) AS allowed;

-- P3. QA_A × disputes path. EXPECT: allowed = true.
SELECT (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) OR (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) AS allowed;

-- P4. QA_B × disputes path. EXPECT: allowed = true.
SELECT (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' OR o.taker_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
) OR (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' OR o.taker_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'))
) AS allowed;

-- P5. QA_C (stranger) × chat path. EXPECT: allowed = false.
SELECT (
  (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' OR o.taker_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'))
) OR (
  (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' OR o.taker_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'))
) AS allowed;

-- P6. QA_C (stranger) × disputes path. EXPECT: allowed = false.
SELECT (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' OR o.taker_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'))
) OR (
  (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf'))[2]
       AND (o.advertiser_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' OR o.taker_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'))
) AS allowed;

-- P7. QA_A × chat path for a nonexistent order. EXPECT: false.
SELECT (
  (storage.foldername('chat/d9999999-9999-4999-8999-999999999999/1700000000000-receipt.png'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('chat/d9999999-9999-4999-8999-999999999999/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) OR (
  (storage.foldername('chat/d9999999-9999-4999-8999-999999999999/1700000000000-receipt.png'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('chat/d9999999-9999-4999-8999-999999999999/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) AS allowed;

-- P8. QA_A × bare filename (no folders). EXPECT: false.
SELECT (
  (storage.foldername('receipt.png'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) OR (
  (storage.foldername('receipt.png'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) AS allowed;

-- P9. QA_A × unknown folder kind with a real order id. EXPECT: false.
SELECT (
  (storage.foldername('misc/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] IN ('chat', 'proof')
  AND EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id::text = (storage.foldername('misc/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) OR (
  (storage.foldername('misc/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[1] = 'disputes'
  AND EXISTS (
    SELECT 1 FROM public.p2p_disputes d
     JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id::text = (storage.foldername('misc/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png'))[2]
       AND (o.advertiser_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' OR o.taker_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'))
) AS allowed;

-- Hard assertion of the whole truth table in one statement.
-- EXPECT: a NOTICE 'predicate truth table check passed'.
DO $$
DECLARE
  v_chat CONSTANT text := 'chat/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png';
  v_proof CONSTANT text := 'proof/d1111111-1111-4111-8111-111111111111/1700000000000-proof.pdf';
  v_disp CONSTANT text := 'disputes/d2222222-2222-4222-8222-222222222222/1700000000000-statement.pdf';
  v_ghost CONSTANT text := 'chat/d9999999-9999-4999-8999-999999999999/1700000000000-receipt.png';
  v_bare CONSTANT text := 'receipt.png';
  v_misc CONSTANT text := 'misc/d1111111-1111-4111-8111-111111111111/1700000000000-receipt.png';
  v_a CONSTANT uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_b CONSTANT uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_c CONSTANT uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
BEGIN
  -- The predicate is written once here as inline SQL per case
  -- (plpgsql has no closures); each IF restates the migration's
  -- participant predicate for one (subject, path) pair.
  IF NOT (
    ((storage.foldername(v_chat))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_chat))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
    OR
    ((storage.foldername(v_chat))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_chat))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P1 (A x chat) must be true'; END IF;

  IF NOT (
    ((storage.foldername(v_proof))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_proof))[2]
                    AND (o.advertiser_id = v_b OR o.taker_id = v_b)))
    OR
    ((storage.foldername(v_proof))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_proof))[2]
                    AND (o.advertiser_id = v_b OR o.taker_id = v_b)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P2 (B x proof) must be true'; END IF;

  IF NOT (
    ((storage.foldername(v_disp))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
    OR
    ((storage.foldername(v_disp))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P3 (A x disputes) must be true'; END IF;

  IF NOT (
    ((storage.foldername(v_disp))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_b OR o.taker_id = v_b)))
    OR
    ((storage.foldername(v_disp))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_b OR o.taker_id = v_b)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P4 (B x disputes) must be true'; END IF;

  IF (
    ((storage.foldername(v_chat))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_chat))[2]
                    AND (o.advertiser_id = v_c OR o.taker_id = v_c)))
    OR
    ((storage.foldername(v_chat))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_chat))[2]
                    AND (o.advertiser_id = v_c OR o.taker_id = v_c)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P5 (C x chat) must be false'; END IF;

  IF (
    ((storage.foldername(v_disp))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_c OR o.taker_id = v_c)))
    OR
    ((storage.foldername(v_disp))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_disp))[2]
                    AND (o.advertiser_id = v_c OR o.taker_id = v_c)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P6 (C x disputes) must be false'; END IF;

  IF (
    ((storage.foldername(v_ghost))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_ghost))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
    OR
    ((storage.foldername(v_ghost))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_ghost))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P7 (A x ghost order) must be false'; END IF;

  IF (
    ((storage.foldername(v_bare))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_bare))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
    OR
    ((storage.foldername(v_bare))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_bare))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P8 (A x bare filename) must be false'; END IF;

  IF (
    ((storage.foldername(v_misc))[1] IN ('chat', 'proof')
     AND EXISTS (SELECT 1 FROM public.p2p_orders o
                  WHERE o.id::text = (storage.foldername(v_misc))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
    OR
    ((storage.foldername(v_misc))[1] = 'disputes'
     AND EXISTS (SELECT 1 FROM public.p2p_disputes d
                  JOIN public.p2p_orders o ON o.id = d.order_id
                  WHERE d.id::text = (storage.foldername(v_misc))[2]
                    AND (o.advertiser_id = v_a OR o.taker_id = v_a)))
  ) THEN RAISE EXCEPTION 'truth table FAILED: P9 (A x unknown folder) must be false'; END IF;

  RAISE NOTICE 'predicate truth table check passed';
END $$;

-- ── Cleanup (run after the proofs; removes the fixtures) ─────────
-- FK order: dispute -> order -> ad; the payment method is
-- independent. No storage.objects rows are created by this script
-- (uploads are a post-deploy storage-API smoke item), so there is
-- nothing to clean in the bucket.
DELETE FROM public.p2p_disputes
 WHERE id = 'd2222222-2222-4222-8222-222222222222';
DELETE FROM public.p2p_payment_methods
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
   AND account_number = '0977 000 111';
DELETE FROM public.p2p_orders
 WHERE id = 'd1111111-1111-4111-8111-111111111111';
DELETE FROM public.p2p_ads
 WHERE id = 'd3333333-3333-4333-8333-333333333333';

-- Post-cleanup verification.
-- EXPECT: one row of zeros.
SELECT
  (SELECT count(*) FROM public.p2p_disputes
    WHERE id = 'd2222222-2222-4222-8222-222222222222') AS disputes_left,
  (SELECT count(*) FROM public.p2p_orders
    WHERE id = 'd1111111-1111-4111-8111-111111111111') AS orders_left,
  (SELECT count(*) FROM public.p2p_ads
    WHERE id = 'd3333333-3333-4333-8333-333333333333') AS ads_left,
  (SELECT count(*) FROM public.p2p_payment_methods
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND account_number = '0977 000 111') AS methods_left;
