-- =====================================================================
-- p2p_t1_hold_proofs.sql — post-deploy proofs for
-- 20261029_p2p_t1_withdrawal_hold.sql (T+1 P2P withdrawal-hold
-- enforcement in btc_reserve_withdrawal; scope §3.8 amendment,
-- Phase 1a header finding 5).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a
-- time (the editor mangles long batches). Section A is a read-only
-- audit. Sections S + P mutate synthetic rows for QA users and end
-- with a cleanup block — run ONLY against QA accounts, never real
-- users. Anon/authenticated EXECUTE probes (expect 42501) belong
-- to the post-relay live-proof stage, as in Phase 0/1a.
--
-- Substitute TWO ids before running:
--   QA_T1    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (hold user)
--   QA_PLAIN 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (control user,
--            BTC but NO P2P holds — proves zero behaviour change)
-- Both must be FRESH accounts (no crypto_wallets, btc_withdrawals
-- or p2p_withdrawal_holds rows): every EXPECT below is exact
-- arithmetic from the S fixtures.
--
-- WHAT IS BEING PROVEN (the reservable formula):
--   reservable = crypto_wallets.available_sats
--                - p2p_unmatured_withdrawal_hold_sats(user)
-- and the reservation consumes amount + fee from reservable.
-- In-flight reservations are already debited out of available_sats
-- at their own reserve time, so they are NOT subtracted twice.
-- Trades (btc_execute_trade), internal transfers and further P2P
-- orders do NOT consult the hold figure and are untouched by this
-- change — asserted by construction (the change is confined to
-- btc_reserve_withdrawal; the build report carries the grep
-- evidence). No trade fixtures are built here, per the brief.
--
-- FIXTURE ARITHMETIC (sats; fees are passed to the RPC explicitly,
-- so no network fee estimation is involved):
--   QA_T1    funded 100,000 | 100,000; hold row 60,000 held,
--            matures +24h  =>  reservable 40,000.
--   QA_PLAIN funded  50,000 |  50,000; no holds
--            =>  reservable 50,000 (unchanged behaviour).
-- =====================================================================

-- ── A. Function ACL audit ────────────────────────────────────────
-- EXPECT: exactly 1 row (the 6-argument M1 signature; no 5-arg
-- overload may exist), proacl naming ONLY postgres (owner) and
-- service_role. No anon, no authenticated, no PUBLIC.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       p.proacl::text AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'btc_reserve_withdrawal'
 ORDER BY signature;

-- Hard assertion form of the same check.
-- EXPECT: a NOTICE 'btc_reserve_withdrawal ACL check passed',
-- no exception.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public'
       AND p.proname = 'btc_reserve_withdrawal'
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee <> ALL (ARRAY[
             (SELECT oid FROM pg_roles WHERE rolname = 'postgres'),
             (SELECT oid FROM pg_roles WHERE rolname = 'service_role')])
  ) THEN
    RAISE EXCEPTION 'btc_reserve_withdrawal ACL check FAILED';
  END IF;
  RAISE NOTICE 'btc_reserve_withdrawal ACL check passed';
END $$;

-- ── S. Fixtures (QA users only) ──────────────────────────────────

-- S1. BTC funding (direct inserts, mirroring the Phase 1a S5
-- crypto_wallets shape).
INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BTC', 100000, 100000),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BTC', 50000, 50000)
ON CONFLICT (user_id, asset) DO NOTHING;

-- S2. The T+1 hold on QA_T1 (direct insert mirroring the Phase 1a
-- release insert's column list; production rows also carry the
-- releasing order's id in order_id — NULL here, the column is
-- nullable and the hold maths does not read it).
INSERT INTO public.p2p_withdrawal_holds (user_id, order_id, asset, amount_minor, matures_at)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL, 'BTC', 60000,
        now() + interval '24 hours');

-- EXPECT: 60000 for QA_T1, 0 for QA_PLAIN.
SELECT public.p2p_unmatured_withdrawal_hold_sats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS t1_held,
       public.p2p_unmatured_withdrawal_hold_sats('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS plain_held;

-- ── P1. Over-band reservation refuses, moves nothing ─────────────
-- 50,000 + 1,000 fee = 51,000 > reservable 40,000, even though the
-- raw available (100,000) would cover it without the hold.
SELECT * FROM public.btc_reserve_withdrawal(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  50000, 1000, 'proof-t1-over-1', NULL);
-- EXPECT: ERROR — 'Part of your Bitcoin is still inside its
-- 24-hour safety hold from a recent P2P trade - that part is not
-- available to withdraw yet'.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 100000 | 100000 — untouched.

SELECT COUNT(*) AS t1_withdrawals FROM public.btc_withdrawals
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 0 — the refusal wrote no row.

-- ── P2. In-band reservation succeeds at the exact boundary ───────
-- 39,000 + 1,000 fee = 40,000 = reservable exactly.
SELECT * FROM public.btc_reserve_withdrawal(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  39000, 1000, 'proof-t1-ok-1', NULL);
-- EXPECT: 1 row — status 'reserved', amount_sats 39000,
-- fee_sats 1000.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 60000 | 60000 (the reservation debited amount + fee
-- from both; the remaining available exactly equals the hold).

-- ── P3. Replay + the drained reservable ──────────────────────────
-- Same key returns the stored row (M1 owner-scoped replay,
-- unchanged with holds present):
SELECT * FROM public.btc_reserve_withdrawal(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  39000, 1000, 'proof-t1-ok-1', NULL);
-- EXPECT: 1 row — the SAME withdrawal_id as P2, 'reserved'.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 60000 | 60000 — the replay moved nothing.

-- And now even 1 sat refuses: available 60,000 - held 60,000 = 0.
SELECT * FROM public.btc_reserve_withdrawal(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  1, 0, 'proof-t1-over-2', NULL);
-- EXPECT: ERROR — the same 24-hour safety hold message.

-- ── P4. Maturation frees the full remainder ──────────────────────
UPDATE public.p2p_withdrawal_holds
   SET matures_at = now() - interval '1 minute'
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND status = 'held';

SELECT public.p2p_mature_withdrawal_holds();
-- EXPECT: matured_count >= 1 (pg_cron also matures every 15
-- minutes, so a slow run may find the row already matured — the
-- binding check is the next one).

SELECT public.p2p_unmatured_withdrawal_hold_sats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS t1_held;
-- EXPECT: 0.

-- The full remaining available now reserves: 59,000 + 1,000 fee.
SELECT * FROM public.btc_reserve_withdrawal(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  59000, 1000, 'proof-t1-ok-2', NULL);
-- EXPECT: 1 row — status 'reserved', amount_sats 59000,
-- fee_sats 1000.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 0 | 0 — fully reserved across P2 + P4, exact.

-- ── P5. Control user: cap semantics + zero change without holds ──
-- The M1 in-transaction daily cap still fires first when armed:
SELECT * FROM public.btc_reserve_withdrawal(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  10000, 0, 'proof-plain-cap', 5000);
-- EXPECT: ERROR — 'Daily withdrawal limit exceeded'.

-- And an ordinary full-balance reservation succeeds exactly as it
-- did before this migration:
SELECT * FROM public.btc_reserve_withdrawal(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
  49000, 1000, 'proof-plain-ok', NULL);
-- EXPECT: 1 row — status 'reserved', amount_sats 49000,
-- fee_sats 1000.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
-- EXPECT: 0 | 0.

-- ── Cleanup (run after the proofs; QA fixtures only) ─────────────
-- NOTE: p2p_mature_withdrawal_holds wrote one global cron audit
-- row (p2p_audit_log, actor 'cron', action
-- 'withdrawal_holds_matured') when P4 matured the fixture hold.
-- It is a truthful record and is left deliberately, like the
-- 40 sats of proof fees in the Phase 1a cleanup.
DELETE FROM public.btc_withdrawals
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.p2p_withdrawal_holds
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
