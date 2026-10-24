-- =====================================================================
-- p2p_phase0_proofs.sql — post-deploy proofs for
-- 20261023_p2p_phase0_identity.sql (P2P Phase 0, scope §5.1).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a time
-- (the editor mangles long batches). Sections A–B are read-only
-- audits. Section C mutates synthetic rows for two QA users and ends
-- with a cleanup block — run it only against QA accounts, never
-- real users.
--
-- Before section C, substitute the two QA user ids:
--   QA_A = a real auth.users id (will hold the verified KYC row)
--   QA_B = a second real auth.users id (the "other user")
-- The placeholders below are 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- (QA_A) and 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' (QA_B).
-- =====================================================================

-- ── A. Function ACL audit ────────────────────────────────────────
-- EXPECT: every row's proacl names ONLY postgres (owner) and
-- service_role. No anon, no authenticated, no PUBLIC (= empty
-- grantee). Trigger functions may show postgres only.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS signature,
       p.proacl::text AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname LIKE 'p2p_%'
 ORDER BY p.proname, signature;

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

-- ── B. RLS + policy audit ────────────────────────────────────────
-- EXPECT: rowsecurity = true for all five tables.
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN ('p2p_identity_signals', 'user_sanctions',
                     'p2p_trader_profiles', 'p2p_reviews',
                     'p2p_payment_methods')
 ORDER BY tablename;

-- EXPECT: p2p_identity_signals — NO rows (no client policies).
-- user_sanctions — owner SELECT + admin ALL.
-- p2p_trader_profiles — owner SELECT only.
-- p2p_reviews — admin ALL only.
-- p2p_payment_methods — owner SELECT only.
SELECT tablename, policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('p2p_identity_signals', 'user_sanctions',
                     'p2p_trader_profiles', 'p2p_reviews',
                     'p2p_payment_methods')
 ORDER BY tablename, policyname;

-- EXPECT: p2p_enabled=false, fee 0.5, hours 12 / 72 / 24 / 24.
SELECT p2p_enabled, p2p_fee_percent, p2p_seller_response_hours,
       p2p_dispute_sla_hours, p2p_new_account_cooldown_hours,
       p2p_withdrawal_hold_hours
  FROM public.platform_settings
 WHERE id;

-- ── C. Behavioural proofs (QA users only) ────────────────────────

-- C1. Normalisers.
-- EXPECT: 'MABVUTO BANDA' | '260123456789' | '0977123456' | '0977123456'
SELECT public.p2p_normalise_name('  mabvuto   banda! ') AS name_norm,
       public.p2p_normalise_id_number('2601-2345 6789') AS id_norm,
       public.p2p_normalise_account_number('+260 977 123 456') AS intl_form,
       public.p2p_normalise_account_number('0977 123 456') AS local_form;

-- C2. Synthetic verified KYC for QA_A (fires the normalise trigger).
-- EXPECT: 1 row inserted; name_norm 'QA ALPHA', id_number_norm set.
INSERT INTO public.kyc_verifications
  (user_id, level, first_name, last_name, id_type, id_number,
   date_of_birth, verified_at)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'basic', 'QA', 'Alpha',
   'nrc', '2601-2345-6789', '1990-01-01', now())
RETURNING name_norm, id_number_norm;

-- C3. The identity anchor: QA_B cannot verify with the SAME
-- (id_type, id_number).
-- EXPECT: ERROR — duplicate key on kyc_verifications_verified_id_unique.
INSERT INTO public.kyc_verifications
  (user_id, level, first_name, last_name, id_type, id_number,
   date_of_birth, verified_at)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'basic', 'QA', 'Beta',
   'nrc', '260123456789', '1992-02-02', now());

-- C4. Tier derivation. QA_A has verified basic KYC but no confirmed
-- phone (auth.users.phone_confirmed_at is NULL).
-- EXPECT: 'T0'.
SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C5. Simulate the phone confirmation (editor-only; in production
-- this is set by Supabase Auth's phone flow).
-- EXPECT: 'T1' after the update.
UPDATE auth.users
   SET phone_confirmed_at = now()
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C6. Upgrade QA_A to full + documents + clean AML screening.
-- EXPECT: 'T2' after all three statements.
UPDATE public.kyc_verifications
   SET level = 'full',
       id_front_url = 'qa/front.png',
       id_back_url = 'qa/back.png',
       selfie_url = 'qa/selfie.png'
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

INSERT INTO public.aml_screenings (user_id, full_name, status, match_found)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QA Alpha', 'completed', false);

SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C7. An UNREVIEWED AML match blocks T2 even with a clean row.
-- EXPECT: 'T1' after the insert; 'T2' again after reviewed_at is set.
INSERT INTO public.aml_screenings (user_id, full_name, status, match_found)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'QA Alpha', 'completed', true);

SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

UPDATE public.aml_screenings
   SET reviewed_at = now()
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND match_found
   AND reviewed_at IS NULL;

SELECT public.p2p_kyc_tier('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C8. Payment registry: QA_A registers a MoMo number written in
-- international form, with the account name matching their KYC name.
-- EXPECT: jsonb row with account_number_norm '0977123456',
-- is_primary true, verified_name_match true.
SELECT public.p2p_create_payment_method(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'mobile_money',
  '+260 977 123 456', 'QA Alpha');

-- C9. QA_B tries the SAME number in local form.
-- EXPECT: ERROR 'This payment account is already registered to another user'.
SELECT public.p2p_create_payment_method(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'mobile_money',
  '0977 123 456', 'QA Beta');

-- C10. The identity signal landed for QA_A.
-- EXPECT: 1 row, signal_type 'payment_account_hash'.
SELECT user_id, signal_type
  FROM public.p2p_identity_signals
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- C11. Limits with the marketplace still paused (Phase 0 default).
-- EXPECT: tier 'T2', can_trade false, reasons include
-- 'marketplace_paused' and 'new_trader_limits', daily_cap 500
-- (first-7-days rule), max_order 500 (first-5-trades rule).
SELECT public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C12. Sanction flow: rung 1 pauses, revocation restores.
-- EXPECT: after apply — can_trade false + reason 'sanctioned_rung_1'.
-- After revoke — 'sanctioned_rung_1' gone (marketplace_paused stays).
SELECT public.p2p_apply_sanction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'p2p', 1,
  'qa_proof', 'Phase 0 proof sanction', 'system', interval '7 days');

SELECT public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

SELECT public.p2p_revoke_sanction(id)
  FROM public.user_sanctions
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
   AND reason_code = 'qa_proof';

SELECT public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- C13. Reserved nickname guard.
-- EXPECT: first INSERT errors ('reserved'); second succeeds.
INSERT INTO public.p2p_trader_profiles (user_id, nickname)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin');

INSERT INTO public.p2p_trader_profiles (user_id, nickname)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TraderAlpha');

-- C14. Identity-change review + 72h hold.
-- EXPECT: a pending p2p_reviews row (reason 'identity_change',
-- hold_until ~ now()+72h); effective_limits trade_hold true.
UPDATE public.kyc_verifications
   SET first_name = 'Changed'
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT reason, status, hold_until
  FROM public.p2p_reviews
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT public.p2p_effective_limits('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
       ->> 'trade_hold' AS trade_hold;

-- C15. Status transitions + primary promotion: add a second method,
-- disable the first (primary) — the second must become primary.
-- EXPECT: after disable, the bank row has is_primary true.
SELECT public.p2p_create_payment_method(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bank',
  '1234567890', 'QA Alpha', 'QA Bank');

SELECT public.p2p_set_payment_method_status(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  (SELECT id FROM public.p2p_payment_methods
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      AND type = 'mobile_money'),
  'disabled');

SELECT type, status, is_primary
  FROM public.p2p_payment_methods
 WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
 ORDER BY created_at;

-- ── Cleanup (run after the proofs; restores QA accounts) ─────────
DELETE FROM public.p2p_payment_methods
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.p2p_identity_signals
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.p2p_reviews
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.user_sanctions
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.p2p_trader_profiles
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.aml_screenings
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

DELETE FROM public.kyc_verifications
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

UPDATE auth.users
   SET phone_confirmed_at = NULL
 WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
