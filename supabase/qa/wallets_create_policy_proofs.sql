-- =====================================================================
-- wallets_create_policy_proofs.sql — post-deploy proofs for
-- 20261103_wallets_client_insert_policy.sql (multi-currency wallet
-- creation fix: QA Wave A defect, 2026-10-23).
--
-- HOW TO RUN: Supabase dashboard SQL editor, ONE statement at a time
-- (the editor mangles long batches and does not preserve SET ROLE
-- across Runs — so every RLS case below is a single DO block that
-- sets the JWT claims and switches role transaction-locally inside
-- itself).
--
-- Before running, substitute two QA user ids (real auth.users ids;
-- both should be throwaway QA accounts, and QA_A must NOT already
-- hold a USD Main wallet or a ZAR wallet under the fixture account):
--   QA_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
--   QA_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
-- =====================================================================

-- ── S0. Fixture cleanup from any previous proof run ──────────────
-- EXPECT: success (deletes only proof-shaped rows for the two QA
-- users: A's USD Main wallet and A's ZAR fixture-account wallet).
DELETE FROM public.wallets
 WHERE (user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND currency = 'USD' AND account_id IS NULL)
    OR (user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND currency = 'ZAR'
        AND account_id = 'aacc0000-0000-4000-8000-000000000001');

DELETE FROM public.accounts
 WHERE id IN ('aacc0000-0000-4000-8000-000000000001',
              'bbcc0000-0000-4000-8000-000000000001');

-- ── S1. Fixture sub-accounts (one per QA user, as postgres) ──────
INSERT INTO public.accounts (id, user_id, name, kind, status)
VALUES ('aacc0000-0000-4000-8000-000000000001',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Proof A', 'custom', 'active'),
       ('bbcc0000-0000-4000-8000-000000000001',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Proof B', 'custom', 'active');

-- ── P1. POSITIVE: QA_A creates their own USD wallet (Main) ───────
-- This is the exact insert useCreateWallet makes from
-- /multi-currency. EXPECT: NOTICE 'P1 PASS ...' and no exception —
-- before the fix this raised 42501 (the live defect).
DO $$
DECLARE v_n integer;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'USD', 0, 'active', NULL);
  SELECT count(*) INTO v_n FROM public.wallets
   WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND currency = 'USD' AND account_id IS NULL AND balance = 0;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'P1 FAIL: inserted USD wallet not visible to its owner';
  END IF;
  RAISE NOTICE 'P1 PASS: QA_A created own USD wallet at balance 0';
END $$;

-- ── P2. NEGATIVE: QA_A tries to create a wallet for QA_B ─────────
-- EXPECT: NOTICE 'P2 PASS ...' (insert refused with 42501).
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EUR', 0, 'active', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P2 FAIL: cross-user wallet insert was NOT refused';
  END IF;
  RAISE NOTICE 'P2 PASS: wallet creation for another user refused';
END $$;

-- ── P3. NEGATIVE: balance manipulation at creation (the C1 hole) ─
-- EXPECT: NOTICE 'P3 PASS ...' (insert refused with 42501).
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EUR', 999999, 'active', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P3 FAIL: nonzero-balance wallet insert was NOT refused';
  END IF;
  RAISE NOTICE 'P3 PASS: nonzero-balance wallet creation refused (C1 stays closed)';
END $$;

-- ── P4. NEGATIVE: unsupported currency ───────────────────────────
-- EXPECT: NOTICE 'P4 PASS ...' (insert refused with 42501).
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'XXX', 0, 'active', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P4 FAIL: unsupported-currency insert was NOT refused';
  END IF;
  RAISE NOTICE 'P4 PASS: unsupported currency refused';
END $$;

-- ── P5. NEGATIVE: non-'active' status at creation ──────────────
-- EXPECT: NOTICE 'P5 PASS ...' (insert refused with 42501).
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'GBP', 0, 'frozen', NULL);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P5 FAIL: non-active-status insert was NOT refused';
  END IF;
  RAISE NOTICE 'P5 PASS: non-active status refused';
END $$;

-- ── P6. SUB-ACCOUNT: own account admitted, another user's refused ─
-- EXPECT: NOTICE 'P6 PASS ...' and no exception.
DO $$
DECLARE v_blocked boolean := false;
BEGIN
  PERFORM set_config('request.jwt.claims',
    '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  -- Own sub-account: must succeed.
  INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'ZAR', 0, 'active',
          'aacc0000-0000-4000-8000-000000000001');
  -- QA_B's sub-account: must be refused.
  BEGIN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'KES', 0, 'active',
            'bbcc0000-0000-4000-8000-000000000001');
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P6 FAIL: wallet attach to another user''s account was NOT refused';
  END IF;
  RAISE NOTICE 'P6 PASS: own sub-account admitted, foreign sub-account refused';
END $$;

-- ── F. Final residue check (as postgres) ─────────────────────────
-- EXPECT: exactly 2 rows — QA_A's USD Main wallet and QA_A's ZAR
-- fixture-account wallet, both balance 0, status 'active'. No EUR /
-- GBP / XXX / KES rows, nothing owned by QA_B.
SELECT user_id, currency, balance, status, account_id
  FROM public.wallets
 WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
   AND currency IN ('USD', 'ZAR', 'EUR', 'GBP', 'XXX', 'KES')
 ORDER BY currency;

-- ── Z. Cleanup (as postgres) ─────────────────────────────────────
DELETE FROM public.wallets
 WHERE (user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND currency = 'USD' AND account_id IS NULL)
    OR (user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        AND currency = 'ZAR'
        AND account_id = 'aacc0000-0000-4000-8000-000000000001');

DELETE FROM public.accounts
 WHERE id IN ('aacc0000-0000-4000-8000-000000000001',
              'bbcc0000-0000-4000-8000-000000000001');
