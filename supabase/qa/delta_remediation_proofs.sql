-- =====================================================================
-- delta_remediation_proofs.sql — post-deploy proofs for
-- 20261102_delta_audit_remediation.sql (delta-audit remediation:
-- D1, D3–D10, D13 on the DB side; E1/E3/E4/E5 are edge-side and are
-- covered by the unit suite + the post-deploy smoke list — see
-- "WHAT PURE SQL CANNOT PROVE" below).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a
-- time (the editor mangles long batches). Sections A–B are audits
-- + RPC behaviour on synthetic rows. Sections S–H create fixture
-- rows for QA users and section Z removes them — run ONLY against
-- QA accounts, never real users.
--
-- Substitute FOUR ids before running (same convention as the
-- phase proofs):
--   QA_A     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' (advertiser /
--            fiat buyer in the fixtures; owns the payment method
--            and the KYC row the D13 checks run against)
--   QA_B     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (taker /
--            crypto seller; sanction target)
--   QA_C     'cccccccc-cccc-cccc-cccc-cccccccccccc' (stranger —
--            party to nothing)
--   QA_ADMIN 'dddddddd-dddd-dddd-dddd-dddddddddddd' (a user WITH an
--            'admin' row in public.user_roles)
-- QA_A / QA_B should be FRESH accounts (no trader-profile counters)
-- so the D5 assertions can use absolute values.
--
-- WOULD HAVE CAUGHT: every check below is written against the
-- ORIGINAL finding — on the pre-remediation schema each section
-- fails in the way the audit described (a stranger replaying a
-- stored outcome, a counter landing on the bystander, a raw
-- duplicate-key error reaching the caller, an admin DELETE path
-- existing at all).
--
-- WHAT PURE SQL CANNOT PROVE — stated honestly:
-- * D1's concurrency claim and D13's race claim are two-session
--   properties. The full two-session procedures are written out in
--   the header of sections D1P / D13P below; section A proves the
--   deployed configuration (the advisory locks are present in the
--   function body, the unique indexes exist). A single editor
--   session cannot race itself.
-- * D3's end-to-end form (a real PostgREST INSERT with a QA user's
--   JWT being refused) belongs to the post-deploy smoke list;
--   section A proves the deployed grants/policies that make the
--   refusal necessary.
-- * D9's in-function assert is unreachable once the CHECK holds —
--   by design (defence in depth). Section H proves the CHECK; the
--   assert's presence is verified in section A (function source).
-- * E1/E3/E4/E5 live in the edge functions; their unit coverage is
--   tests/p2p (692-suite) and their live behaviour joins the smoke
--   list. Nothing in this file pretends otherwise.
-- =====================================================================

-- ── S0. Preconditions ─────────────────────────────────────────────
-- EXPECT: admin_ok = true, a_ok = false, b_ok = false.
SELECT public.has_role('dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin'::app_role) AS admin_ok,
       public.has_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'admin'::app_role) AS a_ok,
       public.has_role('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'admin'::app_role) AS b_ok;

-- ── S1. Fixture ad (buy_crypto: the advertiser is the fiat buyer) ─
INSERT INTO public.p2p_ads
  (id, owner_id, side, asset, price_type, fixed_price_zmw,
   total_amount_minor, min_order_zmw, max_order_zmw, status)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'buy_crypto', 'BTC',
   'fixed', 1000000.00, 100000000, 10.00, 100000.00, 'active');

-- ── S2. Fixture orders + holds + stored outcomes ──────────────────
-- Replay fixtures (D6): terminal orders whose audit rows carry a
-- stored outcome under a known idempotency key, exactly as the
-- original transitions left them.
INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at, cancelled_at)
VALUES
  ('22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'cancelled_unpaid', now() - interval '1 hour', now() - interval '1 hour');

INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at, paid_marked_at)
VALUES
  ('33333333-3333-3333-3333-333333333333',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'paid_marked', now() + interval '1 hour', now() - interval '5 minutes');

INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at, completed_at)
VALUES
  ('44444444-4444-4444-4444-444444444444',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'completed', now() - interval '1 hour', now() - interval '30 minutes');

INSERT INTO public.p2p_audit_log (order_id, actor_id, actor_type, event, detail)
VALUES
  ('22222222-2222-2222-2222-222222222222',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', 'cancelled',
   jsonb_build_object('idempotency_key', 'proof-key-cancel-1',
                      'result', jsonb_build_object('success', true, 'proof', 'cancel-replay'))),
  ('33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', 'paid_marked',
   jsonb_build_object('idempotency_key', 'proof-key-paid-1',
                      'result', jsonb_build_object('success', true, 'proof', 'paid-replay'))),
  ('44444444-4444-4444-4444-444444444444',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'user', 'released',
   jsonb_build_object('idempotency_key', 'proof-key-rel-1',
                      'result', jsonb_build_object('success', true, 'proof', 'release-replay')));

-- D5 fixtures: three live escrow_locked orders in the BUY-AD shape
-- (advertiser QA_A is the fiat buyer; taker QA_B is the crypto
-- seller — the shape where the old code charged the bystander).
INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at)
VALUES
  ('55555555-5555-5555-5555-555555555555',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'escrow_locked', now() + interval '1 hour'),
  ('66666666-6666-6666-6666-666666666666',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'escrow_locked', now() - interval '1 hour'),
  ('77777777-7777-7777-7777-777777777777',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'escrow_locked', now() + interval '1 hour');

INSERT INTO public.p2p_escrow_holds (order_id, seller_id, buyer_id, asset, amount_minor, status)
VALUES
  ('55555555-5555-5555-5555-555555555555',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BTC', 10000, 'locked'),
  ('66666666-6666-6666-6666-666666666666',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BTC', 10000, 'locked'),
  ('77777777-7777-7777-7777-777777777777',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'BTC', 10000, 'locked');

-- ── S3. Dispute fixtures (D7) ─────────────────────────────────────
-- D7 order: completed, with a post-completion payment_reversed
-- dispute (affects_escrow = false). D7B order: disputed, open
-- escrow dispute — used for the linkage and outcome checks.
INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at, completed_at)
VALUES
  ('88888888-8888-8888-8888-888888888888',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'completed', now() - interval '2 hours', now() - interval '1 hour'),
  ('aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'disputed', now() + interval '1 hour', NULL);

INSERT INTO public.p2p_disputes
  (id, order_id, opened_by, reason, affects_escrow, status)
VALUES
  ('99999999-9999-9999-9999-999999999999',
   '88888888-8888-8888-8888-888888888888',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'payment_reversed', false, 'open'),
  ('bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'paid_not_received', true, 'open');

-- ── S4. D13 fixtures: KYC + payment method + claimed reference ────
-- The buyer in the D13 orders is QA_A (the buy-ad advertiser), so
-- the KYC row and the payment method are QA_A's — mark-paid checks
-- method ownership and name attestation against the buyer before
-- it ever reaches the reference check these proofs exercise.
INSERT INTO public.kyc_verifications
  (user_id, level, first_name, last_name, id_type, id_number,
   date_of_birth, id_front_url, id_back_url, selfie_url,
   address_doc_url, verified_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'full', 'Proof', 'Buyer',
   'nrc', '9999-9999-9999', '1990-01-01', 'qa/front.png',
   'qa/back.png', 'qa/selfie.png', 'qa/address.png',
   now() - interval '10 days');

INSERT INTO public.p2p_payment_methods
  (id, user_id, type, account_number, account_number_norm,
   account_name, is_primary, status, verified_name_match)
VALUES
  ('12121212-1212-1212-1212-121212121212',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mobile_money',
   '0977000111', '0977000111', 'Proof Buyer', true, 'active', true);

-- A live order for the mark-paid reuse attempt (buyer QA_A)…
INSERT INTO public.p2p_orders
  (id, ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
   asset, crypto_amount_minor, fiat_amount_zmw, price_zmw,
   payment_method_snapshot, status, expires_at)
VALUES
  ('ccccccc1-cccc-cccc-cccc-cccccccccccc',
   '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'BTC', 10000, 100.00, 1000000.00, '{}'::jsonb,
   'escrow_locked', now() + interval '1 hour');

-- …and the reference PROOFREF1 already claimed on the paid order.
INSERT INTO public.p2p_payment_claims
  (order_id, payment_method_id, rail_reference, rail_reference_norm,
   amount_sent_zmw, payer_name_attested)
VALUES
  ('33333333-3333-3333-3333-333333333333',
   '12121212-1212-1212-1212-121212121212',
   'PROOFREF1', 'PROOFREF1', 100.00, 'Proof Buyer');

-- ── S5. Review fixture (D4) ───────────────────────────────────────
INSERT INTO public.p2p_reviews (id, user_id, reason, status)
VALUES
  ('13131313-1313-1313-1313-131313131313',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'phone_change', 'pending');

-- =====================================================================
-- A. Deployed configuration (D1 presence, D3, D4, D8, D9)
-- =====================================================================

-- A1 (D3): authenticated can no longer INSERT chat rows; reads live.
-- EXPECT: NOTICE 'A1 PASS', no exception.
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.p2p_order_messages', 'INSERT') THEN
    RAISE EXCEPTION 'A1 FAIL: authenticated still holds INSERT on p2p_order_messages';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.p2p_order_messages', 'SELECT') THEN
    RAISE EXCEPTION 'A1 FAIL: chat SELECT was removed — client reads would break';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'p2p_order_messages'
                AND cmd = 'INSERT') THEN
    RAISE EXCEPTION 'A1 FAIL: a chat INSERT policy still exists';
  END IF;
  RAISE NOTICE 'A1 PASS: direct chat INSERT path is closed, reads intact';
END $$;

-- A2 (D4): sanctions + reviews — no write grants, no non-SELECT
-- policies for authenticated; own/admin SELECT survives.
-- EXPECT: NOTICE 'A2 PASS', no exception.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_sanctions', 'p2p_reviews'] LOOP
    IF has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || t, 'DELETE') THEN
      RAISE EXCEPTION 'A2 FAIL: authenticated still holds a write grant on %', t;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'A2 FAIL: SELECT was removed from %', t;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t
                  AND cmd <> 'SELECT') THEN
      RAISE EXCEPTION 'A2 FAIL: a non-SELECT policy still exists on %', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'A2 PASS: sanctions/reviews are read-only for clients; writes are RPC-only';
END $$;

-- A3 (D4/D10): the sanction/review RPCs exist with service-only ACLs.
-- EXPECT: NOTICE 'A3 PASS', no exception.
DO $$
DECLARE r record;
BEGIN
  -- Exactly the new signatures, no old ones.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'p2p_apply_sanction' AND pronargs = 8) <> 1
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'p2p_apply_sanction' AND pronargs <> 8) THEN
    RAISE EXCEPTION 'A3 FAIL: p2p_apply_sanction signatures are not exactly the new 8-arg one';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'p2p_revoke_sanction' AND pronargs = 2) <> 1
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'p2p_revoke_sanction' AND pronargs <> 2) THEN
    RAISE EXCEPTION 'A3 FAIL: p2p_revoke_sanction signatures are not exactly the new 2-arg one';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'p2p_resolve_review' AND pronargs = 2) THEN
    RAISE EXCEPTION 'A3 FAIL: p2p_resolve_review is missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pos_retry_match_failures' AND pronargs = 0) THEN
    RAISE EXCEPTION 'A3 FAIL: pos_retry_match_failures is missing';
  END IF;
  FOR r IN
    SELECT p.proname, p.proacl::text AS acl
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('p2p_apply_sanction', 'p2p_revoke_sanction',
                         'p2p_resolve_review', 'pos_retry_match_failures')
  LOOP
    IF r.acl NOT LIKE '%service_role%' OR r.acl LIKE '%authenticated%' OR r.acl LIKE '%anon%' THEN
      RAISE EXCEPTION 'A3 FAIL: % acl is %', r.proname, r.acl;
    END IF;
  END LOOP;
  RAISE NOTICE 'A3 PASS: sanction/review RPCs present, new signatures only, service-role-only';
END $$;

-- A4 (D9 + D1 presence): the fee CHECK exists; the release assert
-- and the create_order advisory locks are in the deployed sources.
-- EXPECT: NOTICE 'A4 PASS', no exception.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'platform_settings_p2p_fee_percent_range') THEN
    RAISE EXCEPTION 'A4 FAIL: fee CHECK constraint missing';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'p2p_create_order')
       NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'A4 FAIL: p2p_create_order has no advisory locks (D1 not deployed)';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE proname = 'p2p_release_crypto_btc')
       NOT LIKE '%v_fee_percent < 0 OR v_fee_percent > 100%' THEN
    RAISE EXCEPTION 'A4 FAIL: release fee assert missing (D9 not deployed)';
  END IF;
  RAISE NOTICE 'A4 PASS: fee CHECK + release assert + create_order locks are deployed';
END $$;

-- A5 (D8): failure table locked down + retry cron scheduled.
-- EXPECT: NOTICE 'A5 PASS', no exception.
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.pos_match_failures', 'SELECT')
     OR has_table_privilege('anon', 'public.pos_match_failures', 'SELECT') THEN
    RAISE EXCEPTION 'A5 FAIL: pos_match_failures is client-readable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'pos-retry-match-failures' AND active) THEN
    RAISE EXCEPTION 'A5 FAIL: pos-retry-match-failures cron is not scheduled/active';
  END IF;
  RAISE NOTICE 'A5 PASS: failure table is service-only; retry sweep is scheduled';
END $$;

-- =====================================================================
-- B. Sanction / review RPC behaviour (D4 + D10)
-- =====================================================================

-- B1: a NON-admin id passed as the acting admin is refused in the
-- DB, and no sanction row is created. (Pre-remediation the function
-- did not take an admin id at all — any service caller could stamp
-- any applied_by, including the literal the edge used to send.)
-- EXPECT: NOTICE 'B1 PASS', no exception.
DO $$
DECLARE v_before integer; v_after integer;
BEGIN
  SELECT count(*) INTO v_before FROM public.user_sanctions
   WHERE reason_code = 'delta_proof';
  BEGIN
    PERFORM public.p2p_apply_sanction(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'p2p', 1, 'delta_proof',
      'proof', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', NULL,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'B1 FAIL: non-admin applied a sanction';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an admin can apply a sanction%' THEN RAISE; END IF;
  END;
  SELECT count(*) INTO v_after FROM public.user_sanctions
   WHERE reason_code = 'delta_proof';
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'B1 FAIL: a sanction row was created by the refused call';
  END IF;
  RAISE NOTICE 'B1 PASS: non-admin actor refused inside the DB; nothing written';
END $$;

-- B2: the full audited lifecycle with a real admin — apply writes
-- its OWN sanction_applied audit row (no caller-side row needed),
-- revoke flips status and writes sanction_revoked.
-- EXPECT: NOTICE 'B2 PASS', no exception.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := public.p2p_apply_sanction(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'p2p', 1, 'delta_proof',
    'proof lifecycle', 'dddddddd-dddd-dddd-dddd-dddddddddddd', NULL,
    'dddddddd-dddd-dddd-dddd-dddddddddddd');
  IF NOT EXISTS (SELECT 1 FROM public.user_sanctions
                  WHERE id = v_id AND status = 'active') THEN
    RAISE EXCEPTION 'B2 FAIL: sanction row missing after apply';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_audit_log
                  WHERE event = 'sanction_applied'
                    AND actor_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
                    AND actor_type = 'admin'
                    AND detail ->> 'sanction_id' = v_id::text) THEN
    RAISE EXCEPTION 'B2 FAIL: apply did not write its own audit row';
  END IF;
  PERFORM public.p2p_revoke_sanction(v_id, 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  IF NOT EXISTS (SELECT 1 FROM public.user_sanctions
                  WHERE id = v_id AND status = 'revoked') THEN
    RAISE EXCEPTION 'B2 FAIL: sanction not revoked';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_audit_log
                  WHERE event = 'sanction_revoked'
                    AND actor_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
                    AND detail ->> 'sanction_id' = v_id::text) THEN
    RAISE EXCEPTION 'B2 FAIL: revoke did not write its audit row';
  END IF;
  RAISE NOTICE 'B2 PASS: apply/revoke are self-auditing under a verified admin';
END $$;

-- B3: revoke is human-only — a non-admin (and the old 1-arg call
-- shape, i.e. no admin identity) cannot lift a sanction.
-- EXPECT: NOTICE 'B3 PASS', no exception.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := public.p2p_apply_sanction(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'p2p', 0, 'delta_proof',
    'proof revoke guard', 'system', NULL, NULL);
  BEGIN
    PERFORM public.p2p_revoke_sanction(v_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    RAISE EXCEPTION 'B3 FAIL: non-admin revoked a sanction';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an admin can revoke a sanction%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.p2p_revoke_sanction(v_id, NULL);
    RAISE EXCEPTION 'B3 FAIL: anonymous revoke succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an admin can revoke a sanction%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.user_sanctions
                  WHERE id = v_id AND status = 'active') THEN
    RAISE EXCEPTION 'B3 FAIL: sanction state changed under refused revokes';
  END IF;
  RAISE NOTICE 'B3 PASS: revoke requires a verified admin identity';
END $$;

-- B4: the system path still works for automation (apply with NULL
-- admin id, as the strike pipeline and appeal-abuse tariff call
-- it) and its audit row is attributed to 'system'.
-- EXPECT: NOTICE 'B4 PASS', no exception.
DO $$
DECLARE v_id uuid;
BEGIN
  v_id := public.p2p_apply_sanction(
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'p2p', 0, 'delta_proof',
    'proof system path', 'system');
  IF NOT EXISTS (SELECT 1 FROM public.p2p_audit_log
                  WHERE event = 'sanction_applied'
                    AND actor_type = 'system' AND actor_id IS NULL
                    AND detail ->> 'sanction_id' = v_id::text) THEN
    RAISE EXCEPTION 'B4 FAIL: system-path sanction has no system audit row';
  END IF;
  RAISE NOTICE 'B4 PASS: automation rungs still apply, self-audited as system';
END $$;

-- B5: resolve_review — non-admin refused; admin clears + audit row.
-- EXPECT: NOTICE 'B5 PASS', no exception.
DO $$
BEGIN
  BEGIN
    PERFORM public.p2p_resolve_review(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '13131313-1313-1313-1313-131313131313');
    RAISE EXCEPTION 'B5 FAIL: non-admin cleared a review';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only an admin can clear a review%' THEN RAISE; END IF;
  END;
  PERFORM public.p2p_resolve_review(
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '13131313-1313-1313-1313-131313131313');
  IF NOT EXISTS (SELECT 1 FROM public.p2p_reviews
                  WHERE id = '13131313-1313-1313-1313-131313131313'
                    AND status = 'cleared' AND resolved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'B5 FAIL: review not cleared by admin call';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_audit_log
                  WHERE event = 'review_cleared'
                    AND detail ->> 'review_id' = '13131313-1313-1313-1313-131313131313') THEN
    RAISE EXCEPTION 'B5 FAIL: review clear left no audit row';
  END IF;
  RAISE NOTICE 'B5 PASS: reviews clear only through the audited RPC';
END $$;

-- =====================================================================
-- C. Replay oracles closed (D6)
-- =====================================================================

-- C1: cancel — a stranger replaying the victim's idempotency key
-- gets the party refusal, NOT the stored outcome (the original
-- defect). The party's own replay still returns it.
-- EXPECT: NOTICE 'C1 PASS', no exception.
DO $$
DECLARE v_result jsonb; v_ok boolean := false;
BEGIN
  BEGIN
    v_result := public.p2p_cancel_order(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      '22222222-2222-2222-2222-222222222222', NULL, 'proof-key-cancel-1');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%Only a party to this order can cancel it%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'C1 FAIL: stranger was not refused before replay (got %)', v_result;
  END IF;
  v_result := public.p2p_cancel_order(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '22222222-2222-2222-2222-222222222222', NULL, 'proof-key-cancel-1');
  IF v_result ->> 'proof' <> 'cancel-replay' THEN
    RAISE EXCEPTION 'C1 FAIL: party replay broke (got %)', v_result;
  END IF;
  RAISE NOTICE 'C1 PASS: cancel replay is party-only';
END $$;

-- C2: mark-paid — same shape: stranger refused before the replay
-- branch; the buyer still replays their own outcome.
-- EXPECT: NOTICE 'C2 PASS', no exception.
DO $$
DECLARE v_result jsonb; v_ok boolean := false;
BEGIN
  BEGIN
    v_result := public.p2p_mark_paid(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      '33333333-3333-3333-3333-333333333333',
      '12121212-1212-1212-1212-121212121212',
      'PROOFREF1', 100.00, 'Proof Buyer', NULL, NULL, 'proof-key-paid-1');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%Only the buyer can mark this order as paid%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'C2 FAIL: stranger was not refused before replay (got %)', v_result;
  END IF;
  v_result := public.p2p_mark_paid(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '33333333-3333-3333-3333-333333333333',
    '12121212-1212-1212-1212-121212121212',
    'PROOFREF1', 100.00, 'Proof Buyer', NULL, NULL, 'proof-key-paid-1');
  IF v_result ->> 'proof' <> 'paid-replay' THEN
    RAISE EXCEPTION 'C2 FAIL: buyer replay broke (got %)', v_result;
  END IF;
  RAISE NOTICE 'C2 PASS: mark-paid replay is buyer-only';
END $$;

-- C3: confirm-release — a non-seller replaying the release key is
-- refused before the stored outcome; the seller still replays.
-- EXPECT: NOTICE 'C3 PASS', no exception.
DO $$
DECLARE v_result jsonb; v_ok boolean := false;
BEGIN
  BEGIN
    v_result := public.p2p_confirm_release(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      '44444444-4444-4444-4444-444444444444',
      100.00, 'PROOFREF1', true, true, true, 'proof-key-rel-1');
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%Only the seller can confirm release for this order%';
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'C3 FAIL: non-seller was not refused before replay (got %)', v_result;
  END IF;
  v_result := public.p2p_confirm_release(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '44444444-4444-4444-4444-444444444444',
    100.00, 'PROOFREF1', true, true, true, 'proof-key-rel-1');
  IF v_result ->> 'proof' <> 'release-replay' THEN
    RAISE EXCEPTION 'C3 FAIL: seller replay broke (got %)', v_result;
  END IF;
  RAISE NOTICE 'C3 PASS: release replay is seller-only';
END $$;

-- =====================================================================
-- D. Unpaid counters follow the fiat buyer (D5)
-- =====================================================================

-- D5-1: the buyer (QA_A) cancels pre-payment on the buy-ad order.
-- The order's taker is the SELLER (QA_B) — the old code charged
-- QA_B; the counter must land on QA_A.
SELECT public.p2p_cancel_order(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '55555555-5555-5555-5555-555555555555',
  'proof', 'proof-key-d5-cancel') AS cancel_result;
-- EXPECT: NOTICE 'D5-1 PASS', no exception.
DO $$
BEGIN
  IF COALESCE((SELECT orders_cancelled_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0) <> 1 THEN
    RAISE EXCEPTION 'D5-1 FAIL: fiat buyer counter did not move';
  END IF;
  IF COALESCE((SELECT orders_cancelled_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0) <> 0 THEN
    RAISE EXCEPTION 'D5-1 FAIL: bystander taker was charged for the cancel';
  END IF;
  RAISE NOTICE 'D5-1 PASS: cancel counter charged to the fiat buyer';
END $$;

-- D5-2: dispute auto-cancel (buyer reports seller unresponsive
-- pre-payment) — same counter, same owner.
SELECT public.p2p_open_dispute(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '77777777-7777-7777-7777-777777777777',
  'seller_unresponsive_pre_payment', NULL, 'proof-key-d5-disp') AS dispute_result;
-- EXPECT: NOTICE 'D5-2 PASS', no exception.
DO $$
BEGIN
  IF COALESCE((SELECT orders_cancelled_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0) <> 2 THEN
    RAISE EXCEPTION 'D5-2 FAIL: fiat buyer counter did not move on auto-cancel';
  END IF;
  IF COALESCE((SELECT orders_cancelled_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0) <> 0 THEN
    RAISE EXCEPTION 'D5-2 FAIL: bystander taker was charged for the auto-cancel';
  END IF;
  RAISE NOTICE 'D5-2 PASS: dispute auto-cancel counter charged to the fiat buyer';
END $$;

-- D5-3: the expiry cron — the expired order's counter also lands
-- on the fiat buyer, not the taker.
SELECT public.p2p_expire_orders() AS expire_result;
-- EXPECT: NOTICE 'D5-3 PASS', no exception.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.p2p_orders
                  WHERE id = '66666666-6666-6666-6666-666666666666'
                    AND status = 'expired_unpaid') THEN
    RAISE EXCEPTION 'D5-3 FAIL: fixture order was not expired by the sweep';
  END IF;
  IF COALESCE((SELECT orders_expired_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'), 0) <> 1 THEN
    RAISE EXCEPTION 'D5-3 FAIL: fiat buyer expired counter did not move';
  END IF;
  IF COALESCE((SELECT orders_expired_unpaid FROM public.p2p_trader_profiles
                WHERE user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'), 0) <> 0 THEN
    RAISE EXCEPTION 'D5-3 FAIL: bystander taker was charged for the expiry';
  END IF;
  RAISE NOTICE 'D5-3 PASS: expiry counter charged to the fiat buyer';
END $$;

-- =====================================================================
-- E. Dispute-outcome core guards (D7)
-- =====================================================================

-- E1: a dispute passed against the WRONG order is refused.
-- EXPECT: NOTICE 'E1 PASS', no exception.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.p2p_execute_dispute_outcome(
      'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '99999999-9999-9999-9999-999999999999',
      'refund_to_seller', 'ruled_refund', 'admin',
      'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin', false);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%This dispute does not belong to this order%';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'E1 FAIL: cross-order dispute outcome accepted'; END IF;
  RAISE NOTICE 'E1 PASS: dispute/order linkage enforced in the core';
END $$;

-- E2: an outcome outside the whitelist is refused (the old code
-- defaulted anything unrecognised into the refund branch).
-- EXPECT: NOTICE 'E2 PASS', no exception.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.p2p_execute_dispute_outcome(
      'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'sideways', 'ruled_refund', 'admin',
      'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin', false);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%Unknown dispute outcome%';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'E2 FAIL: unknown outcome was not refused'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_disputes
                  WHERE id = 'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
                    AND status = 'open') THEN
    RAISE EXCEPTION 'E2 FAIL: refused outcome still mutated the dispute';
  END IF;
  RAISE NOTICE 'E2 PASS: outcomes are whitelisted in the core';
END $$;

-- E3: the escrow-free (payment_reversed) dispute closes WITHOUT
-- claiming Bitcoin moved, and the completed order is untouched.
-- EXPECT: NOTICE 'E3 PASS', no exception.
DO $$
BEGIN
  PERFORM public.p2p_execute_dispute_outcome(
    '88888888-8888-8888-8888-888888888888',
    '99999999-9999-9999-9999-999999999999',
    'refund_to_seller', 'ruled_refund', 'admin',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin', false);
  IF NOT EXISTS (SELECT 1 FROM public.p2p_disputes
                  WHERE id = '99999999-9999-9999-9999-999999999999'
                    AND status = 'ruled_refund') THEN
    RAISE EXCEPTION 'E3 FAIL: dispute did not close';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_orders
                  WHERE id = '88888888-8888-8888-8888-888888888888'
                    AND status = 'completed') THEN
    RAISE EXCEPTION 'E3 FAIL: escrow-free ruling moved the order';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_order_messages
                  WHERE order_id = '88888888-8888-8888-8888-888888888888'
                    AND sender_type = 'system'
                    AND body = 'Dispute closed. No Bitcoin was held in escrow for this order, so no Bitcoin moved.') THEN
    RAISE EXCEPTION 'E3 FAIL: system message still claims Bitcoin moved on an escrow-free dispute';
  END IF;
  RAISE NOTICE 'E3 PASS: escrow-free closure is honest in the chat record';
END $$;

-- E4: a closed dispute cannot be executed twice.
-- EXPECT: NOTICE 'E4 PASS', no exception.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.p2p_execute_dispute_outcome(
      '88888888-8888-8888-8888-888888888888',
      '99999999-9999-9999-9999-999999999999',
      'refund_to_seller', 'ruled_refund', 'admin',
      'dddddddd-dddd-dddd-dddd-dddddddddddd', 'admin', false);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM LIKE '%This dispute is already closed%';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'E4 FAIL: closed dispute executed again'; END IF;
  RAISE NOTICE 'E4 PASS: closed disputes refuse re-execution in the core';
END $$;

-- =====================================================================
-- F. Designed refusals on unique races (D13 — deterministic paths)
-- =====================================================================

-- F1: registering an account number another user actively holds
-- answers with the designed message (never a raw duplicate-key).
-- EXPECT: NOTICE 'F1 PASS', no exception.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    PERFORM public.p2p_create_payment_method(
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'mobile_money', '0977000111', 'Proof Buyer', NULL);
  EXCEPTION WHEN OTHERS THEN
    v_ok := SQLERRM = 'This payment account is already registered to another user';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'F1 FAIL: duplicate registration did not produce the designed refusal'; END IF;
  RAISE NOTICE 'F1 PASS: duplicate payment account gets the designed refusal';
END $$;

-- F2: reusing a rail reference returns the designed refusal shape
-- AND writes the risk event (the catch path in the remediation
-- reuses exactly this shape/message — see D13P for the race form).
SELECT public.p2p_mark_paid(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'ccccccc1-cccc-cccc-cccc-cccccccccccc',
  '12121212-1212-1212-1212-121212121212',
  'PROOFREF1', 100.00, 'Proof Buyer', NULL, NULL,
  'proof-key-d13-1') AS mark_paid_result;
-- EXPECT (from the SELECT above): {"success": false, "code":
-- "rail_reference_reused", "message": "This payment reference has
-- already been used on another order. …"}
-- EXPECT: NOTICE 'F2 PASS', no exception.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.p2p_risk_events
                  WHERE order_id = 'ccccccc1-cccc-cccc-cccc-cccccccccccc'
                    AND signal = 'rail_reference_reuse') THEN
    RAISE EXCEPTION 'F2 FAIL: reference reuse left no risk event';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.p2p_orders
                  WHERE id = 'ccccccc1-cccc-cccc-cccc-cccccccccccc'
                    AND status = 'escrow_locked') THEN
    RAISE EXCEPTION 'F2 FAIL: refused mark-paid still mutated the order';
  END IF;
  RAISE NOTICE 'F2 PASS: reference reuse is a designed refusal + risk event';
END $$;

-- =====================================================================
-- G. POS deposit matching (D8)
-- =====================================================================

-- Two requests for QA_A on one address, both expecting 500 sats:
-- the EXPIRED one is OLDER (the old matcher preferred it on the
-- FIFO tie-break); the live one must win after remediation.
INSERT INTO public.pos_payment_requests
  (id, user_id, merchant_reference, fiat_amount_zmw, sats_expected,
   btc_zmw_rate, rate_source, deposit_address, expires_at, created_at)
VALUES
  ('21212121-2121-2121-2121-212121212121',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DELTA-EXP-1', 25.00, 500,
   5000000.00, 'proof', 'bc1qdelta-proof-addr',
   now() - interval '1 hour', now() - interval '2 hours'),
  ('23232323-2323-2323-2323-232323232323',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'DELTA-OK-1', 25.00, 500,
   5000000.00, 'proof', 'bc1qdelta-proof-addr',
   now() + interval '1 hour', now() - interval '1 hour');

-- Credit a 500-sat deposit: the flip fires the REAL match trigger.
INSERT INTO public.btc_deposits
  (id, user_id, address, txid, vout, amount_sats, confirmations, status)
VALUES
  ('24242424-2424-2424-2424-242424242424',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bc1qdelta-proof-addr',
   'delta-proof-tx-1', 0, 500, 1, 'detected');
UPDATE public.btc_deposits
   SET status = 'credited', credited_at = now()
 WHERE id = '24242424-2424-2424-2424-242424242424';

-- EXPECT: NOTICE 'G1 PASS', no exception.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pos_payment_requests
                  WHERE id = '23232323-2323-2323-2323-232323232323'
                    AND status = 'paid') THEN
    RAISE EXCEPTION 'G1 FAIL: the live request did not match the deposit';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pos_payment_requests
                  WHERE id = '21212121-2121-2121-2121-212121212121'
                    AND status = 'awaiting_payment' AND deposit_id IS NULL) THEN
    RAISE EXCEPTION 'G1 FAIL: the EXPIRED request was matched by a late deposit';
  END IF;
  RAISE NOTICE 'G1 PASS: a request past expiry at credit time does not match';
END $$;

-- G2: the retry sweep resolves a persisted failure whose deposit
-- has since matched, recording the outcome as the resolution.
INSERT INTO public.pos_match_failures (deposit_id, error_message)
VALUES ('24242424-2424-2424-2424-242424242424', 'proof: simulated transient failure');
SELECT public.pos_retry_match_failures() AS resolved_count;
-- EXPECT: NOTICE 'G2 PASS', no exception.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.pos_match_failures
                  WHERE deposit_id = '24242424-2424-2424-2424-242424242424'
                    AND resolved_at IS NOT NULL
                    AND resolution = 'already_matched') THEN
    RAISE EXCEPTION 'G2 FAIL: sweep did not resolve the failure with its outcome';
  END IF;
  RAISE NOTICE 'G2 PASS: match failures persist and self-heal via the sweep';
END $$;

-- =====================================================================
-- H. Fee bound (D9)
-- =====================================================================

-- H1: an out-of-range fee is unwritable from any path.
-- EXPECT: NOTICE 'H1 PASS', no exception.
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    UPDATE public.platform_settings SET p2p_fee_percent = 150;
  EXCEPTION WHEN check_violation THEN
    v_ok := SQLERRM LIKE '%platform_settings_p2p_fee_percent_range%';
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'H1 FAIL: p2p_fee_percent = 150 was accepted'; END IF;
  IF EXISTS (SELECT 1 FROM public.platform_settings
              WHERE p2p_fee_percent < 0 OR p2p_fee_percent > 100) THEN
    RAISE EXCEPTION 'H1 FAIL: an out-of-range fee value is stored';
  END IF;
  RAISE NOTICE 'H1 PASS: the fee percent is bounded at the schema';
END $$;

-- =====================================================================
-- D1P. Two-session procedure — D1 concurrency (cannot be proven in
-- one editor session; run with a second editor tab / psql session)
-- =====================================================================
-- SETUP (once): a fresh price snapshot, QA_A as a T2+ advertiser
-- with an active sell ad (large total, wide limits), QA_B funded
-- with BTC and limits allowing exactly N orders per day (or watch
-- the open-orders cap). Use the Phase 1a proof harness fixtures if
-- starting from zero.
-- SESSION 1 and SESSION 2, as simultaneously as two tabs allow:
--   SELECT public.p2p_create_order(QA_B, AD, <amount>, NULL, NULL,
--          gen_random_uuid()::text, false);
-- repeated in a burst of ~10 from EACH session against the SAME
-- ad, all with distinct idempotency keys.
-- EXPECT after the burst: the number of created orders for the
-- pair never exceeds ANY cap that was within reach of the burst
-- (daily amount / open orders / 3-per-pair-per-day). On the
-- pre-remediation code the same burst could land more orders than
-- the cap because both transactions read the counters before
-- either committed; with the advisory locks the second transaction
-- re-reads the counters only after the first has committed.
-- A single-session approximation also exists: hold
-- pg_advisory_xact_lock(hashtextextended('p2p-order-user:' ||
-- QA_B, 0)) in session 1 (BEGIN; SELECT …; leave open), then call
-- p2p_create_order for QA_B in session 2 — it must BLOCK until
-- session 1 commits/rolls back, proving the lock keys line up.

-- =====================================================================
-- D13P. Two-session procedure — D13 races (same limitation)
-- =====================================================================
-- RAIL REFERENCE: two live escrow_locked orders for two different
-- buyers. In two sessions simultaneously, call p2p_mark_paid for
-- each order with the SAME fresh rail reference and exact amounts.
-- EXPECT: exactly one succeeds; the other RETURNS
-- {success:false, code:'rail_reference_reused', …} (not a raw
-- 23505) and a rail_reference_reuse risk event exists for it.
-- PAYMENT METHOD: in two sessions simultaneously, call
-- p2p_create_payment_method for two different users with the SAME
-- new account number. EXPECT: exactly one registration exists;
-- the loser gets 'This payment account is already registered to
-- another user' (or, for a same-user double-submit, the winner's
-- row returned idempotently) — never a raw duplicate-key error.

-- =====================================================================
-- Z. Cleanup — removes every fixture row this script created.
-- (Crypto-wallet rows auto-created for QA_B by the unlock calls
-- keep their credited sats; QA accounts are disposable and are
-- deleted wholesale at the end of the programme.)
-- =====================================================================
DELETE FROM public.p2p_order_messages
 WHERE order_id IN ('22222222-2222-2222-2222-222222222222',
                    '33333333-3333-3333-3333-333333333333',
                    '44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555',
                    '66666666-6666-6666-6666-666666666666',
                    '77777777-7777-7777-7777-777777777777',
                    '88888888-8888-8888-8888-888888888888',
                    'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'ccccccc1-cccc-cccc-cccc-cccccccccccc');
DELETE FROM public.p2p_risk_events
 WHERE order_id IN ('ccccccc1-cccc-cccc-cccc-cccccccccccc');
DELETE FROM public.p2p_audit_log
 WHERE order_id IN ('22222222-2222-2222-2222-222222222222',
                    '33333333-3333-3333-3333-333333333333',
                    '44444444-4444-4444-4444-444444444444',
                    '55555555-5555-5555-5555-555555555555',
                    '66666666-6666-6666-6666-666666666666',
                    '77777777-7777-7777-7777-777777777777',
                    '88888888-8888-8888-8888-888888888888',
                    'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                    'ccccccc1-cccc-cccc-cccc-cccccccccccc')
    OR detail ->> 'reason_code' = 'delta_proof'
    OR detail ->> 'review_id' = '13131313-1313-1313-1313-131313131313';
DELETE FROM public.p2p_payment_claims
 WHERE order_id IN ('33333333-3333-3333-3333-333333333333',
                    'ccccccc1-cccc-cccc-cccc-cccccccccccc');
DELETE FROM public.p2p_disputes
 WHERE id IN ('99999999-9999-9999-9999-999999999999',
              'bbbbbbb1-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DELETE FROM public.p2p_escrow_holds
 WHERE order_id IN ('55555555-5555-5555-5555-555555555555',
                    '66666666-6666-6666-6666-666666666666',
                    '77777777-7777-7777-7777-777777777777');
DELETE FROM public.p2p_orders
 WHERE id IN ('22222222-2222-2222-2222-222222222222',
              '33333333-3333-3333-3333-333333333333',
              '44444444-4444-4444-4444-444444444444',
              '55555555-5555-5555-5555-555555555555',
              '66666666-6666-6666-6666-666666666666',
              '77777777-7777-7777-7777-777777777777',
              '88888888-8888-8888-8888-888888888888',
              'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
              'ccccccc1-cccc-cccc-cccc-cccccccccccc');
DELETE FROM public.p2p_ads
 WHERE id = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.p2p_payment_methods
 WHERE id = '12121212-1212-1212-1212-121212121212';
DELETE FROM public.kyc_verifications
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND id_number = '9999-9999-9999';
DELETE FROM public.user_sanctions WHERE reason_code = 'delta_proof';
DELETE FROM public.p2p_reviews
 WHERE id = '13131313-1313-1313-1313-131313131313';
DELETE FROM public.p2p_trader_profiles
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DELETE FROM public.pos_match_failures
 WHERE deposit_id = '24242424-2424-2424-2424-242424242424';
DELETE FROM public.pos_payment_requests
 WHERE id IN ('21212121-2121-2121-2121-212121212121',
              '23232323-2323-2323-2323-232323232323');
DELETE FROM public.btc_deposits
 WHERE id = '24242424-2424-2424-2424-242424242424';

-- Final check: no fixture residue.
-- EXPECT: 0.
SELECT
  (SELECT count(*) FROM public.p2p_orders
    WHERE ad_id = '11111111-1111-1111-1111-111111111111')
+ (SELECT count(*) FROM public.user_sanctions WHERE reason_code = 'delta_proof')
+ (SELECT count(*) FROM public.pos_payment_requests
    WHERE merchant_reference LIKE 'DELTA-%') AS fixture_residue;
