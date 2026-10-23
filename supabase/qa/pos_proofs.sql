-- =====================================================================
-- pos_proofs.sql — post-deploy proofs for
-- 20261030_bitcoin_pos_data.sql (Bitcoin POS data bridge).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a time
-- (the editor mangles long batches). Sections A–B are read-only
-- audits. Section C mutates synthetic rows for two QA users and ends
-- with a cleanup block — run it only against QA accounts, never
-- real users.
--
-- Before section C, substitute the two QA user ids:
--   QA_A = a real auth.users id (merchant A)
--   QA_B = a second real auth.users id (merchant B, the "other")
-- The placeholders below are 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- (QA_A) and 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (QA_B).
--
-- Deposit staging note: btc_deposits rows are inserted directly in
-- exactly the shape btc_record_deposit leaves them, then flipped
-- 'detected' -> 'credited' — the same UPDATE the RPC performs — so
-- the POS match trigger is exercised on its real path. Wallet
-- crediting itself is btc_record_deposit's job and is proven by the
-- bitcoin completion proofs; it is deliberately out of scope here.
-- =====================================================================

-- ── A. Function ACL audit ────────────────────────────────────────
-- EXPECT: every row's proacl names ONLY postgres (owner) and
-- service_role. No anon, no authenticated, no PUBLIC.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       p.proacl::text AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'pos\_%'
 ORDER BY p.proname, signature;

-- Hard assertion form of the same check.
-- EXPECT: a NOTICE 'POS function ACL check passed', no exception.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'pos\_%'
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee <> ALL (ARRAY[
             (SELECT oid FROM pg_roles WHERE rolname = 'postgres'),
             (SELECT oid FROM pg_roles WHERE rolname = 'service_role')])
  ) THEN
    RAISE EXCEPTION 'POS function ACL check FAILED';
  END IF;
  RAISE NOTICE 'POS function ACL check passed';
END $$;

-- ── B. RLS + policy audit ────────────────────────────────────────
-- EXPECT: rowsecurity = true for both tables.
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('pos_payment_requests', 'pos_api_keys')
 ORDER BY tablename;

-- EXPECT: exactly ONE policy row — the merchant SELECT policy on
-- pos_payment_requests. pos_api_keys must have NO policies at all
-- (key hashes never transit PostgREST).
SELECT tablename, policyname, roles, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('pos_payment_requests', 'pos_api_keys')
 ORDER BY tablename, policyname;

-- EXPECT: the expiry cron job exists with schedule '*/5 * * * *'.
SELECT jobname, schedule FROM cron.job WHERE jobname = 'pos-expire-requests';

-- ── C0. Fixtures: two open requests for merchant A, one for B ────
-- (addr strings are fixtures — matching is by (user_id, address)
-- string equality, exactly as in production.)
SELECT public.pos_create_request(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'POS-T1-001', 100.00, 1000,
  10000000.00, 'proof', 'bc1qpos-proof-addr-a', now() + interval '2 hours');

SELECT public.pos_create_request(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'POS-T1-002', 50.00, 500,
  10000000.00, 'proof', 'bc1qpos-proof-addr-a', now() + interval '2 hours');

SELECT public.pos_create_request(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'POS-T1-001', 100.00, 1000,
  10000000.00, 'proof', 'bc1qpos-proof-addr-b', now() + interval '2 hours');
-- EXPECT: three rows returned, all status 'awaiting_payment'.
-- (Same reference string for A and B is fine — references are
-- unique per merchant, not globally.)

-- Duplicate reference for the SAME merchant + a different amount
-- must be refused by the unique constraint.
-- EXPECT: ERROR 23505 (the edge turns this into a crafted message).
SELECT public.pos_create_request(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'POS-T1-001', 101.00, 1010,
  10000000.00, 'proof', 'bc1qpos-proof-addr-a', now() + interval '2 hours');

-- ── C1. Key hashing ──────────────────────────────────────────────
-- EXPECT: 64 hex chars, equal to the published SHA-256 of 'abc',
-- and never equal to the input.
SELECT public.pos_hash_api_key('abc') AS hash_abc,
       public.pos_hash_api_key('abc') =
         'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
         AS matches_published_vector,
       public.pos_hash_api_key('abc') <> 'abc' AS hash_ne_plain;

-- ── C2. RLS isolation (as the authenticated role) ────────────────
-- Run these statements in order in the SAME editor session (the
-- role + claims are session-level so the one-statement-at-a-time
-- rule still holds).
-- EXPECT: merchant A sees exactly their 2 requests…
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', false);
SELECT merchant_reference, status FROM public.pos_payment_requests
 ORDER BY merchant_reference;
-- …and NO api key rows at all (no policy exists — not even own).
SELECT count(*) AS api_key_rows_visible FROM public.pos_api_keys;
SET ROLE NONE;
SELECT set_config('request.jwt.claims', '', false);
-- EXPECT above: 2 request rows (POS-T1-001, POS-T1-002), count 0.

-- ── C3. Exact-match preference beats FIFO ────────────────────────
-- Two open requests on A's address: 001 expects 1000 (older),
-- 002 expects 500 (newer). A 500-sat deposit must settle 002 (exact
-- amount wins over oldest-first).
INSERT INTO public.btc_deposits
  (user_id, address, txid, vout, amount_sats, confirmations, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bc1qpos-proof-addr-a',
   'pos-proof-tx-exact', 0, 500, 1, 'detected');
UPDATE public.btc_deposits SET status = 'credited', credited_at = now()
 WHERE txid = 'pos-proof-tx-exact';
-- EXPECT: POS-T1-002 = 'paid' with sats_received 500; POS-T1-001
-- still 'awaiting_payment'.
SELECT merchant_reference, status, sats_received, txid
  FROM public.pos_payment_requests
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 ORDER BY merchant_reference;

-- ── C4. Classification math: underpaid and overpaid ──────────────
-- 001 expects 1000; pay 999 → underpaid.
INSERT INTO public.btc_deposits
  (user_id, address, txid, vout, amount_sats, confirmations, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bc1qpos-proof-addr-a',
   'pos-proof-tx-under', 0, 999, 1, 'detected');
UPDATE public.btc_deposits SET status = 'credited', credited_at = now()
 WHERE txid = 'pos-proof-tx-under';

-- B's request expects 1000; pay 1001 → overpaid. (Also proves the
-- match never crosses merchants: same address shape, other user.)
INSERT INTO public.btc_deposits
  (user_id, address, txid, vout, amount_sats, confirmations, status)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bc1qpos-proof-addr-b',
   'pos-proof-tx-over', 0, 1001, 3, 'detected');
UPDATE public.btc_deposits SET status = 'credited', credited_at = now()
 WHERE txid = 'pos-proof-tx-over';

-- EXPECT: A/001 'underpaid' (999 of 1000); B/001 'overpaid'
-- (1001 of 1000), confirmations_at_detection = 3 on B's row,
-- btc_zmw_rate_at_payment = 10000000.00 on both.
SELECT user_id, merchant_reference, status, sats_received,
       confirmations_at_detection, btc_zmw_rate_at_payment, paid_at IS NOT NULL AS has_paid_at
  FROM public.pos_payment_requests
 WHERE merchant_reference LIKE 'POS-T1-%'
 ORDER BY user_id, merchant_reference;

-- ── C5. Deposit with no open request changes nothing ─────────────
INSERT INTO public.btc_deposits
  (user_id, address, txid, vout, amount_sats, confirmations, status)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bc1qpos-proof-addr-none',
   'pos-proof-tx-stray', 0, 777, 1, 'detected');
UPDATE public.btc_deposits SET status = 'credited', credited_at = now()
 WHERE txid = 'pos-proof-tx-stray';
-- EXPECT: 'no_open_request', and A's request statuses unchanged
-- from C4 (the stray deposit behaved exactly like a normal deposit).
SELECT public.pos_apply_deposit_match(id) AS stray_result
  FROM public.btc_deposits WHERE txid = 'pos-proof-tx-stray';

-- Re-matching an already-matched deposit is a no-op.
-- EXPECT: 'already_matched'.
SELECT public.pos_apply_deposit_match(id) AS rematch_result
  FROM public.btc_deposits WHERE txid = 'pos-proof-tx-exact';

-- ── C6. Expiry sweep ─────────────────────────────────────────────
-- Stage an open request already past its expiry (direct insert —
-- the RPC refuses past expiries by design) plus confirm the sweep
-- leaves settled requests alone.
INSERT INTO public.pos_payment_requests
  (user_id, merchant_reference, fiat_amount_zmw, sats_expected,
   btc_zmw_rate, rate_source, deposit_address, expires_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'POS-T1-OLD', 10.00, 100,
   10000000.00, 'proof', 'bc1qpos-proof-addr-a', now() - interval '1 hour');
SELECT public.pos_expire_requests() AS expired_count;
-- EXPECT: expired_count >= 1; POS-T1-OLD is 'expired'; the paid /
-- underpaid / overpaid rows from C3–C4 kept their statuses.
SELECT merchant_reference, status FROM public.pos_payment_requests
 WHERE merchant_reference LIKE 'POS-T1-%' ORDER BY merchant_reference;

-- ── C7. Cancel discipline ────────────────────────────────────────
SELECT public.pos_create_request(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'POS-T1-CXL', 10.00, 100,
  10000000.00, 'proof', 'bc1qpos-proof-addr-a', now() + interval '2 hours');
SELECT status FROM public.pos_cancel_request(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.pos_payment_requests
    WHERE merchant_reference = 'POS-T1-CXL'));
-- EXPECT: 'cancelled'.

-- Cancelling a settled request must refuse.
-- EXPECT: a NOTICE 'paid-cancel refused as expected', no exception.
DO $$
BEGIN
  BEGIN
    PERFORM public.pos_cancel_request(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      (SELECT id FROM public.pos_payment_requests
        WHERE merchant_reference = 'POS-T1-002'));
    RAISE EXCEPTION 'paid-cancel was NOT refused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'paid-cancel was NOT refused' THEN RAISE; END IF;
    RAISE NOTICE 'paid-cancel refused as expected: %', SQLERRM;
  END;
END $$;

-- Merchant B cannot cancel merchant A's request.
-- EXPECT: a NOTICE 'cross-merchant cancel refused as expected'.
DO $$
BEGIN
  BEGIN
    PERFORM public.pos_cancel_request(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      (SELECT id FROM public.pos_payment_requests
        WHERE merchant_reference = 'POS-T1-CXL'));
    RAISE EXCEPTION 'cross-merchant cancel was NOT refused';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'cross-merchant cancel was NOT refused' THEN RAISE; END IF;
    RAISE NOTICE 'cross-merchant cancel refused as expected: %', SQLERRM;
  END;
END $$;

-- ── C8. API key lifecycle ────────────────────────────────────────
SELECT id, label, key_prefix, revoked FROM public.pos_create_api_key(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proof till key',
  public.pos_hash_api_key('bmp_pos_proof-plain-key'), 'bmp_pos_proof-pl');
-- EXPECT: one row, revoked = false; the stored hash (check below)
-- is the SHA-256 of the plain key, never the plain key itself.
SELECT key_hash = public.pos_hash_api_key('bmp_pos_proof-plain-key')
         AS hash_matches,
       key_hash <> 'bmp_pos_proof-plain-key' AS hash_ne_plain,
       length(key_hash) = 64 AS hash_len_ok
  FROM public.pos_api_keys
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT public.pos_revoke_api_key(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.pos_api_keys
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
SELECT revoked, revoked_at IS NOT NULL AS has_revoked_at
  FROM public.pos_api_keys
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: revoked = true, has_revoked_at = true.

-- ── CLEANUP (run last; verifies itself) ──────────────────────────
DELETE FROM public.pos_payment_requests
 WHERE merchant_reference LIKE 'POS-T1-%';
DELETE FROM public.pos_api_keys
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DELETE FROM public.btc_deposits WHERE txid LIKE 'pos-proof-%';
-- EXPECT: 0, 0, 0.
SELECT
  (SELECT count(*) FROM public.pos_payment_requests
    WHERE merchant_reference LIKE 'POS-T1-%') AS requests_left,
  (SELECT count(*) FROM public.pos_api_keys
    WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')) AS keys_left,
  (SELECT count(*) FROM public.btc_deposits
    WHERE txid LIKE 'pos-proof-%') AS deposits_left;
