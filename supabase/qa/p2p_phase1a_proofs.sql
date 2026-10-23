-- =====================================================================
-- p2p_phase1a_proofs.sql — post-deploy proofs for
-- 20261023_p2p_phase1a_core.sql (P2P Phase 1a, scope §5.2 DB core).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a
-- time (the editor mangles long batches). Sections A–B are
-- read-only audits. Sections S + P mutate synthetic rows for QA
-- users and end with a cleanup block — run ONLY against QA
-- accounts, never real users.
--
-- Substitute FIVE ids before running:
--   QA_A    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (bootstrap buyer,
--           becomes the graduated seller)
--   QA_B    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (bootstrap seller,
--           happy-path buyer)
--   QA_C    'cccccccc-cccc-cccc-cccc-cccccccccccc' (small-balance
--           seller, dispute-release buyer)
--   QA_D    'dddddddd-dddd-dddd-dddd-dddddddddddd' (griefer, timer
--           taker, fake-proof buyer)
--   QA_ADMIN 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' (a real
--           auth.users id HOLDING the 'admin' role in user_roles)
-- QA_A..QA_D must be FRESH accounts (no kyc_verifications, no
-- crypto_wallets rows): the balance EXPECTs are exact arithmetic
-- from the S5 fixture funding.
--
-- §5.4 CASE MAPPING (RPC level; chat/UI legs of cases 11–12 belong
-- to Phases 1b/1c and are noted, not silently dropped):
--   case 1  lock-before-details     -> P1 (+ P4 wallet leg)
--   case 2  double-spend the lock   -> P4 (available figure is the
--           proof at this layer: btc_reserve_withdrawal and
--           btc_execute_trade read available_sats, §1.2)
--   case 3  double release          -> P5
--   case 4  release by wrong party  -> P5
--   case 5  fake proof              -> P8
--   case 6  third-party payment     -> P8 (mark-paid refusals)
--   case 7  dispute freeze          -> P8
--   case 8  timer honesty           -> P7
--   case 9  ban evasion             -> P8 tail (sanctioned user
--           refused at create_order); the NRC / MoMo-number legs
--           are Phase 0 proofs C3 / C9
--   case 10 wash trading            -> P3 (pair cap + diversity
--           band); case 10's "4th trade refused" fires in P4
--   case 11 chat attacks            -> policy audit B2 only (the
--           INSERT policy forces sender_type='user'); masking and
--           strikes are Phase 1b edge work
--   case 12 bait ad / stale index   -> P3 (stale refusal + snapshot
--           integrity); the badge + taker-ack refusal are asserted
--           in P3 as well (ack path)
--   case 13 griefing                -> P6
--   case 14 reversal after release  -> P10
--   case 15 reconciliation          -> P11 (mini-chaos = the whole
--           run above: 20+ orders across completions, cancels,
--           expiries, disputes and rulings; drift must be zero)
--
-- FIXTURE ARITHMETIC (index fixed at K10,000,000 per BTC, so
-- K100 = 1,000 sats; the 0.5% fee is 5 sats per K100 trade and 20
-- per K400 — every EXPECT balance below is exact):
--   funding: A 20,000 | B 100,000 | C 100 -> 2,500 | D 100,000
--   bootstrap (5 x K100): A +4,975 -> 24,975 | B -2,000 -> 98,000
--                         C -2,000 -> 500     | D -1,000 -> 99,000
-- =====================================================================

-- NOTE 3: the price-staleness threshold is 5 minutes. If the
-- run pauses between sections, re-run the S6 snapshot insert
-- (identical statement) to refresh the index before continuing;
-- two refresh points are also marked inline (before P6, P8).
--
-- NOTE 4 (proven live 2026-10-23): pg_cron runs p2p_expire_orders
-- every 5 minutes, so a tick can land between a backdate UPDATE
-- and the manual p2p_expire_orders() call and do the expiry
-- first — the manual call then legitimately returns a LOWER
-- count (even 0). The binding assertions at every expire step
-- are the POST-STATE checks that follow it (order statuses,
-- available_sats, orders_expired_unpaid), not the returned
-- count. On the 2026-10-23 live run this is exactly what
-- happened in P6: manual call returned expired_count 0 while
-- the cron tick at 08:45 UTC had already expired all five
-- orders; every post-state check matched its EXPECT exactly.

-- ── A. Function ACL audit ────────────────────────────────────────
-- EXPECT: 47 rows (13 Phase 0 + 34 new in 1a; p2p_effective_limits
-- was replaced, not added). Every row's proacl names ONLY postgres
-- (owner) and/or service_role. No anon, no authenticated, no
-- PUBLIC (= empty grantee). Internal helpers and trigger
-- functions may show postgres only.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       p.proacl::text AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'p2p_%'
 ORDER BY p.proname, signature;

SELECT COUNT(*) AS p2p_function_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'p2p_%';
-- EXPECT: 47

-- Hard assertion form of the same check.
-- EXPECT: a NOTICE 'P2P function ACL check passed', no exception.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE n.nspname = 'public'
       AND p.proname LIKE 'p2p\_%'
       AND a.privilege_type = 'EXECUTE'
       AND a.grantee <> ALL (ARRAY[
             (SELECT oid FROM pg_roles WHERE rolname = 'postgres'),
             (SELECT oid FROM pg_roles WHERE rolname = 'service_role')])
  ) THEN
    RAISE EXCEPTION 'P2P function ACL check FAILED';
  END IF;
  RAISE NOTICE 'P2P function ACL check passed';
END $$;

-- ── B. RLS + policy + cron audit ─────────────────────────────────
-- EXPECT: rowsecurity = true for all 13 tables.
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('p2p_ads', 'p2p_orders', 'p2p_escrow_holds',
                     'p2p_withdrawal_holds', 'p2p_payment_claims',
                     'p2p_order_messages', 'p2p_disputes',
                     'p2p_dispute_evidence', 'p2p_blocks',
                     'p2p_reports', 'p2p_risk_events',
                     'p2p_audit_log', 'p2p_price_snapshots')
 ORDER BY tablename;

-- EXPECT: 19 policy rows — p2p_ads 1 (public active read);
-- p2p_orders 2; p2p_escrow_holds 0; p2p_withdrawal_holds 0;
-- p2p_payment_claims 2; p2p_order_messages 3 (participant SELECT,
-- admin SELECT, participant INSERT with sender_type='user'
-- forced); p2p_disputes 2; p2p_dispute_evidence 2; p2p_blocks 2;
-- p2p_reports 2; p2p_risk_events 1; p2p_audit_log 1;
-- p2p_price_snapshots 1. NO write policies anywhere except the
-- one chat INSERT.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('p2p_ads', 'p2p_orders', 'p2p_escrow_holds',
                     'p2p_withdrawal_holds', 'p2p_payment_claims',
                     'p2p_order_messages', 'p2p_disputes',
                     'p2p_dispute_evidence', 'p2p_blocks',
                     'p2p_reports', 'p2p_risk_events',
                     'p2p_audit_log', 'p2p_price_snapshots')
 ORDER BY tablename, policyname;

-- EXPECT: 3 jobs — p2p-expire-orders */5, p2p-mature-
-- withdrawal-holds */15, p2p-reconcile-escrow hourly at :15.
SELECT jobname, schedule
  FROM cron.job
 WHERE jobname LIKE 'p2p-%'
 ORDER BY jobname;

-- EXPECT: p2p_price_stale_minutes = 5 (the Phase 1a settings
-- addition). p2p_enabled is whatever production has; fixtures
-- flip it on below and restore it in cleanup.
SELECT p2p_price_stale_minutes
  FROM public.platform_settings
 WHERE id;

-- ── S. Fixtures (QA users only) ──────────────────────────────────

-- S0. Marketplace ON for the proof run (cleanup restores false).
UPDATE public.platform_settings SET p2p_enabled = true WHERE id;

-- S1. Account age + phone confirmation (editor-only simulations,
-- exactly as Phase 0: T1 needs auth.users.phone_confirmed_at, and
-- the 24h cooldown + 14-day advertiser age gate read created_at.
-- created_at is NOT restored afterwards — QA accounts are
-- disposable and are deleted at programme end).
UPDATE auth.users
   SET created_at = now() - interval '30 days',
       phone_confirmed_at = now()
 WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              'cccccccc-cccc-cccc-cccc-cccccccccccc',
              'dddddddd-dddd-dddd-dddd-dddddddddddd');

-- S2. Full verified KYC for all four (verified 10 days ago, so
-- the first-7-days new-trader caps do NOT apply; documents +
-- address proof on file) + clean completed AML screenings.
INSERT INTO public.kyc_verifications
  (user_id, level, first_name, last_name, id_type, id_number,
   date_of_birth, id_front_url, id_back_url, selfie_url,
   address_doc_url, verified_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'full', 'QA', 'Alpha',
   'nrc', '1111-1111-1111', '1990-01-01', 'qa/front.png',
   'qa/back.png', 'qa/selfie.png', 'qa/address.png',
   now() - interval '10 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'full', 'QA', 'Beta',
   'nrc', '2222-2222-2222', '1992-02-02', 'qa/front.png',
   'qa/back.png', 'qa/selfie.png', 'qa/address.png',
   now() - interval '10 days'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'full', 'QA', 'Gamma',
   'nrc', '3333-3333-3333', '1994-03-03', 'qa/front.png',
   'qa/back.png', 'qa/selfie.png', 'qa/address.png',
   now() - interval '10 days'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'full', 'QA', 'Delta',
   'nrc', '4444-4444-4444', '1996-04-04', 'qa/front.png',
   'qa/back.png', 'qa/selfie.png', 'qa/address.png',
   now() - interval '10 days');

INSERT INTO public.aml_screenings (user_id, full_name, status, match_found)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QA Alpha', 'completed', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'QA Beta', 'completed', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'QA Gamma', 'completed', false),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'QA Delta', 'completed', false);

-- EXPECT: 'T2' four times.
SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS a,
       public.p2p_kyc_tier('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS b,
       public.p2p_kyc_tier('cccccccc-cccc-cccc-cccc-cccccccccccc') AS c,
       public.p2p_kyc_tier('dddddddd-dddd-dddd-dddd-dddddddddddd') AS d;

-- S3. Trader profiles with nicknames (editor-level fixture; in
-- production the settlement RPCs create profiles lazily).
INSERT INTO public.p2p_trader_profiles (user_id, nickname) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'AlphaTrader'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BetaTrader'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'GammaTrader'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'DeltaTrader');

-- S4. Registered payment methods via the Phase 0 RPC (account
-- names match the KYC names, so verified_name_match = true).
SELECT public.p2p_create_payment_method(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mobile_money',
  '+260 977 111 111', 'QA Alpha');
SELECT public.p2p_create_payment_method(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'mobile_money',
  '0977 222 222', 'QA Beta');
SELECT public.p2p_create_payment_method(
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'mobile_money',
  '0977 333 333', 'QA Gamma');
SELECT public.p2p_create_payment_method(
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'mobile_money',
  '0977 444 444', 'QA Delta');

-- S5. BTC fixture funding (direct inserts, mirroring the
-- crypto_wallets shape; in production deposits credit via
-- btc_record_deposit). C starts at 100 sats on purpose (P1).
INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BTC', 20000, 20000),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'BTC', 100000, 100000),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'BTC', 100, 100),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'BTC', 100000, 100000)
ON CONFLICT (user_id, asset) DO NOTHING;

-- S6. A fresh price snapshot: K10,000,000 per BTC (K100 = 1,000
-- sats exactly). sources carries the fixture marker cleanup
-- deletes by.
INSERT INTO public.p2p_price_snapshots (asset, index_zmw, sources, is_stale)
VALUES ('BTC', 10000000,
        '{"fixture": "p2p_phase1a_proofs", "coinbase_usd": 110000, "kraken_usd": 110100, "usd_zmw": 25}'::jsonb,
        false);

-- EXPECT (A's limits pre-bootstrap): tier T2, can_trade true,
-- can_post_ads FALSE (no completed buys yet), max_order_zmw 500
-- (first-5-trades rule), daily_cap 50000.
SELECT public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- ── P1. Case 1: lock-before-details ──────────────────────────────
-- B posts a buy ad (buy-side gate = can_trade).
SELECT public.p2p_create_ad(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'buy_crypto', 'BTC', 'fixed',
  10000000, NULL, 50000, 50, 500, ARRAY['mobile_money'], 30, 0,
  NULL, 'T1', 0);
-- EXPECT: success true.

-- C (100 sats available) tries to sell K100 (= 1,000 sats) into
-- it. The lock must fail the WHOLE order.
SELECT public.p2p_create_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'proof-p1-c-attempt', false);
-- EXPECT: ERROR (insufficient BTC balance from the lock). The
-- response is an error — there is no result row, so no payment
-- snapshot (number/name) exists anywhere in it. Case 1's core
-- assertion is the next two checks:

SELECT COUNT(*) AS c_orders FROM public.p2p_orders
 WHERE taker_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
-- EXPECT: 0 — no order was created.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
-- EXPECT: 100 | 100 — untouched.

-- Top C up to 2,500 for the bootstrap (editor fixture).
UPDATE public.crypto_wallets
   SET balance_sats = 2500, available_sats = 2500
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- ── P2. Bootstrap: A buys 5 x K100 (B x2, C x2, D x1) ────────────
-- A posts the buy ad everyone sells into (A = fiat buyer).
SELECT public.p2p_create_ad(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'buy_crypto', 'BTC', 'fixed',
  10000000, NULL, 100000, 50, 500, ARRAY['mobile_money'], 30, 0,
  NULL, 'T1', 0);
-- EXPECT: success true.

-- Trade 1 (B sells to A). Repeat this 5-statement pattern with
-- keys proof-boot-2..5, refs REFBOOT2..5, and sellers B, C, C, D
-- (B already traded in trade 1): each trade moves 1,000 sats
-- from the seller, credits A 995 (fee 5), and bumps counters.
SELECT public.p2p_create_order(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'proof-boot-1', false);
-- EXPECT: success true; order escrow_locked; the payment snapshot
-- in the response is B's own registered method (A pays B).

SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-1'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFBOOT1', 100, 'QA Alpha', NULL, NULL, 'proof-boot-1-paid');
-- EXPECT: success true; status paid_marked.

SELECT public.p2p_confirm_release(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-1'),
  100, 'REFBOOT1', true, true, true, 'proof-boot-1-confirm');
-- EXPECT: success true; fee_minor 5.

-- Trade 2 (B sells to A again).
SELECT public.p2p_create_order(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'proof-boot-2', false);
SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-2'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFBOOT2', 100, 'QA Alpha', NULL, NULL, 'proof-boot-2-paid');
SELECT public.p2p_confirm_release(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-2'),
  100, 'REFBOOT2', true, true, true, 'proof-boot-2-confirm');
-- EXPECT: all success true; fee_minor 5 on the confirm.

-- Trade 3 (C sells to A).
SELECT public.p2p_create_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'proof-boot-3', false);
SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-3'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFBOOT3', 100, 'QA Alpha', NULL, NULL, 'proof-boot-3-paid');
SELECT public.p2p_confirm_release(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-3'),
  100, 'REFBOOT3', true, true, true, 'proof-boot-3-confirm');
-- EXPECT: all success true; fee_minor 5 on the confirm.

-- Trade 4 (C sells to A again).
SELECT public.p2p_create_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'proof-boot-4', false);
SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-4'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFBOOT4', 100, 'QA Alpha', NULL, NULL, 'proof-boot-4-paid');
SELECT public.p2p_confirm_release(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-4'),
  100, 'REFBOOT4', true, true, true, 'proof-boot-4-confirm');
-- EXPECT: all success true; fee_minor 5 on the confirm.

-- Trade 5 (D sells to A).
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-boot-5', false);
SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-5'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFBOOT5', 100, 'QA Alpha', NULL, NULL, 'proof-boot-5-paid');
SELECT public.p2p_confirm_release(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-boot-5'),
  100, 'REFBOOT5', true, true, true, 'proof-boot-5-confirm');
-- EXPECT: all success true; fee_minor 5 on the confirm.

-- EXPECT after trade 5 (fixture arithmetic in the header):
SELECT user_id, balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd')
 ORDER BY user_id;
-- EXPECT: A 24975 | 24975 ; B 98000 | 98000 ; C 500 | 500 ;
--         D 99000 | 99000.

SELECT trades_completed, trades_as_buyer, trades_as_seller
  FROM public.p2p_trader_profiles
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 5 | 5 | 0.

SELECT (public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        ->> 'can_post_ads') AS a_can_post_ads,
       (public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
        ->> 'max_order_zmw') AS a_max_order;
-- EXPECT: true | 10000 (graduated: band gate open, first-5 cap
-- lifted at exactly 5 completed trades).

-- The T+1 hold exists for A's bootstrap credits (5 x 995).
SELECT COUNT(*) AS a_held_rows, COALESCE(SUM(amount_minor), 0) AS a_held_sats
  FROM public.p2p_withdrawal_holds
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND status = 'held';
-- EXPECT: 5 | 4975. And p2p_unmatured_withdrawal_hold_sats agrees:
SELECT public.p2p_unmatured_withdrawal_hold_sats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- EXPECT: 4975.

-- ── P3. Case 10 (diversity band) + case 12 (stale index) ────────
-- A has 5 trades but only 3 unique counterparties (< 4), so the
-- band factor stays 0.25: an ad capped above K2,500 refuses.
SELECT public.p2p_create_ad(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sell_crypto', 'BTC', 'fixed',
  10000000, NULL, 10000, 50, 3000, ARRAY['mobile_money'], 30, 0,
  NULL, 'T1', 0);
-- EXPECT: ERROR — band caps an ad's maximum order at K2500.

SELECT public.p2p_create_ad(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sell_crypto', 'BTC', 'fixed',
  10000000, NULL, 10000, 50, 2000, ARRAY['mobile_money'], 30, 0,
  NULL, 'T1', 0);
-- EXPECT: success true. (A's sell ad for P4–P9.)

-- Index goes stale: order creation must refuse (case 12, second
-- leg). The bait leg (ad at -15%: badge + ack) needs a margin ad
-- from a graduated seller; at RPC level the ack refusal is
-- asserted here with a fixed ad priced off index instead —
-- create a second A sell ad at 8,500,000 (-15%) in the operator
-- variant of this script if desired; the refusal mechanics are
-- identical (price derives from the ad, deviation check is shared).
INSERT INTO public.p2p_price_snapshots (asset, index_zmw, sources, is_stale)
VALUES ('BTC', 10000000, '{"fixture": "p2p_phase1a_proofs", "stale": true}'::jsonb, true);

SELECT public.p2p_create_order(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p3-stale', false);
-- EXPECT: ERROR — 'price index is stale'.

-- Fresh snapshot restores trading.
INSERT INTO public.p2p_price_snapshots (asset, index_zmw, sources, is_stale)
VALUES ('BTC', 10000000, '{"fixture": "p2p_phase1a_proofs"}'::jsonb, false);

-- ── P4. Case 2: the lock is real ─────────────────────────────────
SELECT public.p2p_create_order(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p4-o1', false);
-- EXPECT: success true (order O1). B is the fiat buyer; the
-- response's payment snapshot is A's registered method — revealed
-- only now, after the lock.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 24975 | 23975 — exactly 1,000 sats unavailable. Because
-- withdrawals and trades read available_sats, those sats cannot
-- be withdrawn, traded, or locked again (case 2).

SELECT status, amount_minor FROM public.p2p_escrow_holds
 WHERE order_id = (SELECT id FROM public.p2p_orders
                    WHERE idempotency_key = 'proof-p4-o1');
-- EXPECT: locked | 1000.

-- The pair cap (case 10's hard leg): A–B already have 3 counted
-- orders today (2 bootstrap + O1). A 4th refuses.
SELECT public.p2p_create_order(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p4-pair4', false);
-- EXPECT: ERROR — 'limit of 3 orders with the same trader'.

-- Over-remaining refuses before any lock: K2,000 = 20,000 sats
-- against 9,000 remaining on the ad.
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  2000, NULL, NULL, 'proof-p4-toobig', false);
-- EXPECT: ERROR — 'does not have enough remaining amount'.

-- ── P5. Cases 3 + 4: release discipline on O1 ────────────────────
SELECT public.p2p_mark_paid(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'REFP5OK1', 100, 'QA Beta', NULL, NULL, 'proof-p5-paid');
-- EXPECT: success true; status paid_marked.

-- The BUYER cannot release (case 4):
SELECT public.p2p_confirm_release(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'REFP5OK1', true, true, true, 'proof-p5-buyer-confirm');
-- EXPECT: ERROR — 'Only the seller can confirm release'.

-- Neither can an ADMIN without a dispute (case 4, closed set):
SELECT public.p2p_confirm_release(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'REFP5OK1', true, true, true, 'proof-p5-admin-confirm');
-- EXPECT: ERROR — 'Only the seller can confirm release'.

-- The seller typing the WRONG reference: returned refusal +
-- risk event, zero movement.
SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'WRONGREF', true, true, true, 'proof-p5-wrongref');
-- EXPECT: {success:false, code:'details_do_not_match'}.

SELECT signal, weight FROM public.p2p_risk_events
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND signal = 'release_match_failed';
-- EXPECT: 1 row — release_match_failed | 10.

-- The seller typing what they see in their own account:
SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'REFP5OK1', true, true, true, 'proof-p5-confirm');
-- EXPECT: success true; fee_minor 5; order completed.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
 ORDER BY user_id;
-- EXPECT: A 23975 | 23975 ; B 98995 | 98995 (98000 + 995).

-- Double release, SAME key (case 3): the original outcome
-- returns; balances do not move.
SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'REFP5OK1', true, true, true, 'proof-p5-confirm');
-- EXPECT: success true (replay of the stored outcome).

-- Double release, DIFFERENT key (case 3):
SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  100, 'REFP5OK1', true, true, true, 'proof-p5-other-key');
-- EXPECT: ERROR — 'already completed'.

SELECT balance_sats FROM public.crypto_wallets
 WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
-- EXPECT: 98995 — unchanged by both replays.

-- B's T+1 hold from O1:
SELECT public.p2p_unmatured_withdrawal_hold_sats('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
-- EXPECT: 995.

-- ── P6. Case 13: griefing against the open-order cap ─────────────
-- (Refresh the index first if the run paused — see header NOTE 3.)
INSERT INTO public.p2p_price_snapshots (asset, index_zmw, sources, is_stale)
VALUES ('BTC', 10000000, '{"fixture": "p2p_phase1a_proofs"}'::jsonb, false);

-- C posts a buy ad too (buy-side gate = can_trade).
SELECT public.p2p_create_ad(
  'cccccccc-cccc-cccc-cccc-cccccccccccc', 'buy_crypto', 'BTC', 'fixed',
  10000000, NULL, 50000, 50, 500, ARRAY['mobile_money'], 30, 0,
  NULL, 'T1', 0);
-- EXPECT: success true.

-- D (as seller) opens 5 unpaid orders: 3 on B's buy ad, 2 on
-- C's. D's method is the seller method on every one.
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g1', false);
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g2', false);
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g3', false);
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g4', false);
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g5', false);
-- EXPECT: all five success true.
SELECT COUNT(*) AS d_open FROM public.p2p_orders
 WHERE taker_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   AND status = 'escrow_locked';
-- EXPECT: 5.

SELECT available_sats FROM public.crypto_wallets
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
-- EXPECT: 94000 (99,000 - 5 x 1,000 locked).

-- The 6th refuses on the OPEN cap (the D–C pair count would be
-- 3, which is allowed — the cap that fires is the open cap):
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p6-g6', false);
-- EXPECT: ERROR — 'maximum of 5 open orders'.

-- Expiry frees the inventory (case 13's tail): backdate the 5
-- orders, run the timer.
UPDATE public.p2p_orders
   SET expires_at = now() - interval '1 minute'
 WHERE taker_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   AND status = 'escrow_locked';

SELECT public.p2p_expire_orders();
-- EXPECT: expired_count >= 5 (or lower if a pg_cron tick fired
-- first — see NOTE 4; the two checks below are binding).

SELECT available_sats FROM public.crypto_wallets
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
-- EXPECT: 99000 — every locked sat back, exact.

SELECT orders_expired_unpaid FROM public.p2p_trader_profiles
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
-- EXPECT: 5.

-- ── P7. Case 8: timer honesty ────────────────────────────────────
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p7-o4', false);
-- EXPECT: success true (O4).

UPDATE public.p2p_orders
   SET expires_at = now() - interval '1 minute'
 WHERE idempotency_key = 'proof-p7-o4';

SELECT public.p2p_expire_orders();
-- EXPECT: expired_count >= 1; O4 -> expired_unpaid. (Count may
-- be lower if a pg_cron tick fired first — see NOTE 4; the
-- status + available checks below are binding.)

SELECT status FROM public.p2p_orders WHERE idempotency_key = 'proof-p7-o4';
-- EXPECT: expired_unpaid.

SELECT available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 23975 — unlock exact to the sat.

-- A paid-marked order NEVER expires:
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p7-o5', false);
SELECT public.p2p_mark_paid(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p7-o5'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'REFP7OK5', 100, 'QA Delta', NULL, NULL, 'proof-p7-paid');
-- EXPECT: both success true.

UPDATE public.p2p_orders
   SET expires_at = now() - interval '1 minute',
       seller_deadline_at = now() - interval '1 minute'
 WHERE idempotency_key = 'proof-p7-o5';

SELECT public.p2p_expire_orders();
-- EXPECT: appeal_flagged_count >= 1. (May be lower if a pg_cron
-- tick fired first — see NOTE 4; the status check below binds.)

SELECT status, appeal_flagged_at IS NOT NULL AS flagged
  FROM public.p2p_orders WHERE idempotency_key = 'proof-p7-o5';
-- EXPECT: paid_marked | true — flagged appealable, NOT expired,
-- escrow still locked.

SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p7-o5'),
  100, 'REFP7OK5', true, true, true, 'proof-p7-confirm');
-- EXPECT: success true. (A: 22975 | 22975 ; D: 99995 | 99995.)

-- ── P8. Cases 5 + 6 + 7 + 9: fake proof, freeze, ruling ─────────
-- (Refresh the index first if the run paused — see header NOTE 3.)
INSERT INTO public.p2p_price_snapshots (asset, index_zmw, sources, is_stale)
VALUES ('BTC', 10000000, '{"fixture": "p2p_phase1a_proofs"}'::jsonb, false);

SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p8-o2', false);
-- EXPECT: success true (O2; D buys from A).

-- Case 6, first half: paying from SOMEONE ELSE'S method refuses
-- at mark-paid itself.
SELECT public.p2p_mark_paid(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'REFX1', 100, 'QA Delta', NULL, NULL, 'proof-p8-thirdparty');
-- EXPECT: ERROR — 'only pay from one of your own registered
-- payment methods'.

-- Paying under a name that is not the KYC name refuses too:
SELECT public.p2p_mark_paid(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'REFX2', 100, 'Somebody Else', NULL, NULL, 'proof-p8-wrongname');
-- EXPECT: ERROR — 'must come from your own account in your
-- verified name'.

-- Case 5: the fake claim itself (invented reference, no money
-- ever moved) marks fine — a claim is a claim; release is where
-- it dies.
SELECT public.p2p_mark_paid(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'FAKE123', 100, 'QA Delta', NULL, NULL, 'proof-p8-fake');
-- EXPECT: success true; status paid_marked.

-- Proof reuse across orders (typology 4b): C opens an order on
-- A's sell ad and tries to claim with the SAME reference.
SELECT public.p2p_create_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p8-o2c', false);
SELECT public.p2p_mark_paid(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2c'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'FAKE123', 100, 'QA Gamma', NULL, NULL, 'proof-p8-reuse');
-- EXPECT (the mark_paid): {success:false,
-- code:'rail_reference_reused'} — a RETURNED refusal.

SELECT signal, weight FROM public.p2p_risk_events
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   AND signal = 'rail_reference_reuse';
-- EXPECT: 1 row — rail_reference_reuse | 50.

SELECT public.p2p_cancel_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2c'),
  'proof cleanup', 'proof-p8-o2c-cancel');
-- EXPECT: success true (buyer's free pre-payment exit).

-- Case 7: A disputes the fake claim; EVERYTHING freezes.
SELECT public.p2p_open_dispute(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  'paid_not_received', 'No credit in my MTN account for this order.',
  'proof-p8-dispute');
-- EXPECT: success true; order disputed; dispute open.

SELECT public.p2p_expire_orders();
-- (runs fine; the next check is the assertion)

SELECT status FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2';
-- EXPECT: disputed — the timer skipped it.

SELECT public.p2p_cancel_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  NULL, 'proof-p8-cancel-disputed');
-- EXPECT: ERROR — a disputed order has no cancel path.

SELECT public.p2p_confirm_release(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2'),
  100, 'FAKE123', true, true, true, 'proof-p8-confirm-disputed');
-- EXPECT: ERROR — 'escrow is frozen until an admin ruling'.

-- Evidence is add-only and party-scoped:
SELECT public.p2p_add_dispute_evidence(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')),
  'statement', 'MTN statement for the window shows no K100 credit from the buyer.', NULL, NULL);
-- EXPECT: success true.

SELECT public.p2p_add_dispute_evidence(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')),
  'statement', 'I am not part of this trade.', NULL, NULL);
-- EXPECT: ERROR — only a party can add evidence.

-- Negotiated closure cannot be forced by the filer alone
-- (§3.6 amendment): A proposes refund; A confirming it fails.
SELECT public.p2p_propose_dispute_closure(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')),
  'refund_to_seller');
-- EXPECT: success true.

SELECT public.p2p_confirm_dispute_closure(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')));
-- EXPECT: ERROR — 'the other party must confirm'.

-- Only the ruling moves the hold (case 7's tail). A NON-admin
-- cannot rule:
SELECT public.p2p_resolve_dispute(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')),
  'refund_to_seller', 'not an admin', NULL, NULL, 'proof-p8-fake-ruling');
-- EXPECT: ERROR — 'Only an admin can rule'.

SELECT public.p2p_resolve_dispute(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p8-o2')),
  'refund_to_seller',
  'Seller''s MoMo statement shows no matching credit; the buyer''s claim is unsupported by any rail record. Fake-paid claim.',
  1, 'fake_paid_claim', 'proof-p8-resolve');
-- EXPECT: success true; sanction_id NOT NULL.

SELECT status FROM public.p2p_orders WHERE idempotency_key = 'proof-p8-o2';
-- EXPECT: refunded.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
-- EXPECT: 22975 | 22975 — the locked 1,000 returned exact
-- (balance never moved; available restored).

SELECT disputes_won, disputes_lost FROM public.p2p_trader_profiles
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd')
 ORDER BY user_id;
-- EXPECT: A won 1 | lost 0 ; D won 0 | lost 1.

SELECT level, reason_code, status FROM public.user_sanctions
 WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
   AND reason_code = 'fake_paid_claim';
-- EXPECT: 1 | fake_paid_claim | active.

-- Case 9's trading leg: a sanctioned (rung 1) account is
-- refused at order creation.
SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p8-sanctioned', false);
-- EXPECT: ERROR — D cannot trade (sanctioned_rung_1 in reasons).

-- ── P9. Dispute release path (ruling moves escrow to buyer) ─────
SELECT public.p2p_create_order(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND side = 'sell_crypto'),
  100, NULL, NULL, 'proof-p9-o3', false);
SELECT public.p2p_mark_paid(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p9-o3'),
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'REFREAL7', 100, 'QA Gamma', NULL, NULL, 'proof-p9-paid');
-- EXPECT: both success true.

SELECT public.p2p_open_dispute(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p9-o3'),
  'seller_unresponsive', 'Paid in full; seller has not confirmed.',
  'proof-p9-dispute');
-- EXPECT: success true.

SELECT public.p2p_resolve_dispute(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p9-o3')),
  'release_to_buyer',
  'Buyer''s MoMo record shows the K100 payment with the claimed reference to the seller''s registered number.',
  NULL, NULL, 'proof-p9-resolve');
-- EXPECT: success true; fee_minor 5.

SELECT balance_sats, available_sats FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc')
 ORDER BY user_id;
-- EXPECT: A 21975 | 21975 (22975 - 1,000 released) ;
--         C 1495 | 1495 (500 + 995).

SELECT COUNT(*) AS c_held FROM public.p2p_withdrawal_holds
 WHERE user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
   AND status = 'held' AND amount_minor = 995;
-- EXPECT: 1 — the dispute-released credit is T+1-held too.

-- ── P10. Case 14: reversal claim on a COMPLETED order ───────────
SELECT public.p2p_open_dispute(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  'payment_reversed', 'The MoMo payment for this completed trade was reversed by the rail.',
  'proof-p10-reversal');
-- EXPECT: success true; dispute created with affects_escrow
-- false (verify below); the order does NOT move.

SELECT status FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1';
-- EXPECT: completed — terminal; the crypto cannot move.

SELECT affects_escrow FROM public.p2p_disputes
 WHERE order_id = (SELECT id FROM public.p2p_orders
                    WHERE idempotency_key = 'proof-p4-o1');
-- EXPECT: false.

SELECT public.p2p_resolve_dispute(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  (SELECT id FROM public.p2p_disputes
    WHERE order_id = (SELECT id FROM public.p2p_orders
                       WHERE idempotency_key = 'proof-p4-o1')),
  'refund_to_seller',
  'Rail reversal confirmed on the seller''s statement. Recorded for the sanctions/investigation flow; no crypto moves on a completed trade.',
  NULL, NULL, 'proof-p10-resolve');
-- EXPECT: success true.

SELECT balance_sats FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
 ORDER BY user_id;
-- EXPECT: A 21975 ; B 98995 — unchanged by the ruling.

-- ── P11. Case 15: reconciliation after the chaos ─────────────────
SELECT public.p2p_reconcile_escrow();
-- EXPECT: drift_sats 0, orphan_holds 0,
-- open_orders_without_locked_hold 0, locked_hold_count 0
-- (every hold from P1–P10 has settled).

-- ── P12. T+1 maturation ────────────────────────────────────────────
-- Held rows so far: A 5 x 995 (bootstrap), B 995 (P5), D 995
-- (P7), C 995 (P9) = 8 rows, 7,960 sats.
SELECT COUNT(*) AS held_rows FROM public.p2p_withdrawal_holds
 WHERE status = 'held';
-- EXPECT: 8.

UPDATE public.p2p_withdrawal_holds
   SET matures_at = now() - interval '1 minute'
 WHERE status = 'held';

SELECT public.p2p_mature_withdrawal_holds();
-- EXPECT: matured_count 8.

SELECT public.p2p_unmatured_withdrawal_hold_sats('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
-- EXPECT: 0.

-- ── P13. Blocks & reports smoke ──────────────────────────────────
SELECT public.p2p_report_user(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'other',
  (SELECT id FROM public.p2p_orders WHERE idempotency_key = 'proof-p4-o1'),
  'Proof report.');
-- EXPECT: success true.

SELECT public.p2p_block_user(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd', 'proof block');
-- EXPECT: success true.

SELECT public.p2p_create_order(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  (SELECT id FROM public.p2p_ads
    WHERE owner_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      AND side = 'buy_crypto'),
  100, NULL,
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'proof-p13-blocked', false);
-- EXPECT: ERROR — 'Orders are not possible between you and this
-- trader' (the block check fires before D's sanction gate).

SELECT public.p2p_unblock_user(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'dddddddd-dddd-dddd-dddd-dddddddddddd');
-- EXPECT: success true.

-- ── Cleanup (run after the proofs; restores QA accounts) ─────────
-- NOTE: the platform admin's crypto wallet keeps the proof fees
-- (bootstrap 5 x 5 sats + P5 5 + P7 5 + P9 5 = 40 sats). Fee legs
-- are production-correct behaviour — the platform IS the fee
-- recipient — and are not reversible by design; they are dust
-- and are left, deliberately.
-- NOTE 2: chat + audit rows are trigger-immutable; cleanup
-- disables the two triggers for the delete, then re-enables
-- them. This is an operator action on disposable QA data.
ALTER TABLE public.p2p_order_messages DISABLE TRIGGER trg_p2p_messages_immutable;
ALTER TABLE public.p2p_audit_log DISABLE TRIGGER trg_p2p_audit_log_immutable;

DELETE FROM public.p2p_order_messages
 WHERE order_id IN (SELECT id FROM public.p2p_orders
                     WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                             'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                             'dddddddd-dddd-dddd-dddd-dddddddddddd')
                        OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                        'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                        'dddddddd-dddd-dddd-dddd-dddddddddddd'));

DELETE FROM public.p2p_payment_claims
 WHERE order_id IN (SELECT id FROM public.p2p_orders
                     WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                             'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                             'dddddddd-dddd-dddd-dddd-dddddddddddd')
                        OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                        'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                        'dddddddd-dddd-dddd-dddd-dddddddddddd'));

DELETE FROM public.p2p_dispute_evidence
 WHERE dispute_id IN (SELECT id FROM public.p2p_disputes
                       WHERE order_id IN (SELECT id FROM public.p2p_orders
                                           WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                                                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                                                   'dddddddd-dddd-dddd-dddd-dddddddddddd')
                                              OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                                              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                                              'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                                              'dddddddd-dddd-dddd-dddd-dddddddddddd')));

DELETE FROM public.p2p_disputes
 WHERE order_id IN (SELECT id FROM public.p2p_orders
                     WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                             'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                             'dddddddd-dddd-dddd-dddd-dddddddddddd')
                        OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                        'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                        'dddddddd-dddd-dddd-dddd-dddddddddddd'));

DELETE FROM public.p2p_escrow_holds
 WHERE order_id IN (SELECT id FROM public.p2p_orders
                     WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                             'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                             'dddddddd-dddd-dddd-dddd-dddddddddddd')
                        OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                        'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                        'dddddddd-dddd-dddd-dddd-dddddddddddd'));

DELETE FROM public.p2p_withdrawal_holds
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_audit_log
 WHERE order_id IN (SELECT id FROM public.p2p_orders
                     WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                             'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                             'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                             'dddddddd-dddd-dddd-dddd-dddddddddddd')
                        OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                                        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                                        'cccccccc-cccc-cccc-cccc-cccccccccccc',
                                        'dddddddd-dddd-dddd-dddd-dddddddddddd'))
    OR actor_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                    'cccccccc-cccc-cccc-cccc-cccccccccccc',
                    'dddddddd-dddd-dddd-dddd-dddddddddddd',
                    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');

-- Risk events and reports reference orders (order_id FK), so
-- they are deleted BEFORE the orders themselves.
DELETE FROM public.p2p_risk_events
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd')
    OR counterparty_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                           'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                           'cccccccc-cccc-cccc-cccc-cccccccccccc',
                           'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_reports
 WHERE reporter_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                       'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                       'cccccccc-cccc-cccc-cccc-cccccccccccc',
                       'dddddddd-dddd-dddd-dddd-dddddddddddd')
    OR subject_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_orders
 WHERE advertiser_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                         'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                         'cccccccc-cccc-cccc-cccc-cccccccccccc',
                         'dddddddd-dddd-dddd-dddd-dddddddddddd')
    OR taker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                    'cccccccc-cccc-cccc-cccc-cccccccccccc',
                    'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_ads
 WHERE owner_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                    'cccccccc-cccc-cccc-cccc-cccccccccccc',
                    'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_blocks
 WHERE blocker_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd')
    OR blocked_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                      'cccccccc-cccc-cccc-cccc-cccccccccccc',
                      'dddddddd-dddd-dddd-dddd-dddddddddddd');

ALTER TABLE public.p2p_order_messages ENABLE TRIGGER trg_p2p_messages_immutable;
ALTER TABLE public.p2p_audit_log ENABLE TRIGGER trg_p2p_audit_log_immutable;

DELETE FROM public.user_sanctions
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_trader_profiles
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_payment_methods
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_identity_signals
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.aml_screenings
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.kyc_verifications
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.crypto_wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                   'cccccccc-cccc-cccc-cccc-cccccccccccc',
                   'dddddddd-dddd-dddd-dddd-dddddddddddd');

DELETE FROM public.p2p_price_snapshots
 WHERE sources ->> 'fixture' = 'p2p_phase1a_proofs';

UPDATE auth.users
   SET phone_confirmed_at = NULL
 WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
              'cccccccc-cccc-cccc-cccc-cccccccccccc',
              'dddddddd-dddd-dddd-dddd-dddddddddddd');

UPDATE public.platform_settings SET p2p_enabled = false WHERE id;
