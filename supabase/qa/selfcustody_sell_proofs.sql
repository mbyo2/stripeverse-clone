-- =====================================================================
-- selfcustody_sell_proofs.sql — proofs for migration
-- 20261235_selfcustody_sell_intents.sql (btc_settle_selfcustody_sell).
--
-- SELF-ROLLING-BACK: everything runs inside ONE transaction that is
-- rolled back at the end. The synthetic user is created and removed
-- by the rollback; NOTHING persists. Run in the Supabase dashboard
-- SQL editor as a single paste (it is one transaction), or via psql.
-- EXPECT: a final row reading 'PROOF_OK' and no exception. Any failed
-- expectation raises, which aborts the transaction (also a rollback).
--
-- Fixture arithmetic (mirrors tests/selfcustody/sellToZmw.test.ts):
--   rate K2,000,000/BTC, fee 150 bps.
--   Expected 50,000 sats → K985.00. Deposit ACTUALLY credits 40,000
--   sats → settle-on-actual nets floor(800 * 0.985) = K788.00, fee
--   K12.00, treasury float +40,000, crypto wallet 40,000 → 0.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_user UUID := 'c3500000-0000-4000-8000-000000000001';
  v_intent UUID;
  v_intent2 UUID;
  v_outcome TEXT;
  v_status TEXT;
  v_actual BIGINT;
  v_zmw NUMERIC;
  v_fee NUMERIC;
  v_balance NUMERIC;
  v_zmw_balance NUMERIC;
  v_crypto BIGINT;
  v_float BIGINT;
BEGIN
  -- Synthetic user (GoTrue-safe per the fleet pattern: instance_id
  -- set, token columns '', timestamps set, companion identity row).
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated',
    'authenticated', 'qa-sc-sell@example.invalid',
    crypt('QaScSell!234', gen_salt('bf')), now(), now(), now(), '', '', '', ''
  );
  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider, created_at, updated_at
  ) VALUES (
    v_user::text, v_user,
    jsonb_build_object('sub', v_user::text, 'email', 'qa-sc-sell@example.invalid'),
    'email', now(), now()
  );

  -- Fund the custodial BTC wallet exactly as a credited deposit would.
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (v_user, 'BTC', 40000, 40000);
  INSERT INTO public.btc_deposits
    (user_id, address, txid, vout, amount_sats, confirmations, status, credited_at)
  VALUES
    (v_user, 'bc1qproofaddress', 'proof-txid-1', 0, 40000, 3, 'credited', now());

  -- Intent: expected 50,000 sats, deposit arrives UNDER at 40,000.
  INSERT INTO public.btc_selfcustody_sell_intents
    (user_id, rail, mid_rate_zmw, fee_bps, expected_sats, expected_zmw,
     expected_fee_zmw, expires_at, grace_seconds, deposit_address)
  VALUES
    (v_user, 'onchain', 2000000, 150, 50000, 985.00, 15.00,
     now() + interval '30 minutes', 3600, 'bc1qproofaddress')
  RETURNING id INTO v_intent;

  SELECT outcome, intent_status, actual_sats, zmw_credited, fee_zmw, new_zmw_balance
    INTO v_outcome, v_status, v_actual, v_zmw, v_fee, v_balance
  FROM public.btc_settle_selfcustody_sell(v_intent, 'onchain', 'proof-txid-1', 0, NULL);

  IF v_outcome <> 'settled' THEN RAISE EXCEPTION 'P1 outcome %', v_outcome; END IF;
  IF v_actual <> 40000 THEN RAISE EXCEPTION 'P1 actual % (settle-on-actual failed)', v_actual; END IF;
  IF v_zmw <> 788.00 THEN RAISE EXCEPTION 'P1 zmw % (expected 788.00)', v_zmw; END IF;
  IF v_fee <> 12.00 THEN RAISE EXCEPTION 'P1 fee % (expected 12.00)', v_fee; END IF;
  IF v_balance <> 788.00 THEN RAISE EXCEPTION 'P1 new balance %', v_balance; END IF;

  SELECT balance_sats INTO v_crypto FROM public.crypto_wallets
  WHERE user_id = v_user AND asset = 'BTC';
  IF v_crypto <> 0 THEN RAISE EXCEPTION 'P2 crypto wallet % (expected 0)', v_crypto; END IF;
  SELECT float_sats INTO v_float FROM public.btc_treasury WHERE id = 1;
  -- (Float is shared state; only assert it MOVED by checking the
  -- intent row + ledger instead of an absolute figure.)
  SELECT zmw_credited INTO v_zmw FROM public.btc_selfcustody_sell_intents WHERE id = v_intent;
  IF v_zmw <> 788.00 THEN RAISE EXCEPTION 'P2 intent zmw %', v_zmw; END IF;
  IF (SELECT count(*) FROM public.transactions
      WHERE idempotency_key IN (concat('sc-sell:', v_intent::text, ':zmw'),
                                concat('sc-sell:', v_intent::text, ':btc'))) <> 2 THEN
    RAISE EXCEPTION 'P2 ledger legs missing';
  END IF;

  -- P3 REPLAY: settling again returns already_settled, moves nothing.
  SELECT outcome, zmw_credited INTO v_outcome, v_zmw
  FROM public.btc_settle_selfcustody_sell(v_intent, 'onchain', 'proof-txid-1', 0, NULL);
  IF v_outcome <> 'already_settled' THEN RAISE EXCEPTION 'P3 outcome %', v_outcome; END IF;
  SELECT balance INTO v_zmw_balance FROM public.wallets
  WHERE user_id = v_user AND currency = 'ZMW' AND account_id IS NULL;
  IF v_zmw_balance <> 788.00 THEN RAISE EXCEPTION 'P3 balance moved on replay: %', v_zmw_balance; END IF;

  -- P4 ONE INTENT PER DEPOSIT: a second intent cannot bind the same deposit.
  INSERT INTO public.btc_selfcustody_sell_intents
    (user_id, rail, mid_rate_zmw, fee_bps, expected_sats, expected_zmw,
     expected_fee_zmw, expires_at, grace_seconds, deposit_address)
  VALUES
    (v_user, 'onchain', 2000000, 150, 40000, 788.00, 12.00,
     now() + interval '30 minutes', 3600, 'bc1qproofaddress')
  RETURNING id INTO v_intent2;
  SELECT outcome INTO v_outcome
  FROM public.btc_settle_selfcustody_sell(v_intent2, 'onchain', 'proof-txid-1', 0, NULL);
  IF v_outcome <> 'deposit_already_bound' THEN
    RAISE EXCEPTION 'P4 outcome % (expected deposit_already_bound)', v_outcome;
  END IF;

  -- P5 GRACE: a deposit credited after expires_at + grace expires
  -- the intent and credits NO ZMW.
  UPDATE public.btc_selfcustody_sell_intents
  SET expires_at = now() - interval '2 hours'
  WHERE id = v_intent2;
  INSERT INTO public.btc_deposits
    (user_id, address, txid, vout, amount_sats, confirmations, status, credited_at)
  VALUES
    (v_user, 'bc1qproofaddress', 'proof-txid-2', 1, 10000, 3, 'credited', now());
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (v_user, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset)
  DO UPDATE SET balance_sats = 10000, available_sats = 10000;
  SELECT outcome, intent_status INTO v_outcome, v_status
  FROM public.btc_settle_selfcustody_sell(v_intent2, 'onchain', 'proof-txid-2', 1, NULL);
  IF v_outcome <> 'expired_after_grace' OR v_status <> 'expired' THEN
    RAISE EXCEPTION 'P5 outcome % status %', v_outcome, v_status;
  END IF;
  SELECT balance INTO v_zmw_balance FROM public.wallets
  WHERE user_id = v_user AND currency = 'ZMW' AND account_id IS NULL;
  IF v_zmw_balance <> 788.00 THEN RAISE EXCEPTION 'P5 balance moved: %', v_zmw_balance; END IF;

  -- P6 ACL: anon/authenticated must NOT be able to execute the RPC.
  IF has_function_privilege('anon', 'public.btc_settle_selfcustody_sell(uuid,text,text,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P6 anon can execute the settle RPC';
  END IF;
  IF has_function_privilege('authenticated', 'public.btc_settle_selfcustody_sell(uuid,text,text,integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'P6 authenticated can execute the settle RPC';
  END IF;

  RAISE NOTICE 'PROOF_OK selfcustody sell: settle-on-actual, replay, one-intent-per-deposit, grace expiry, ACL';
END $$;

SELECT 'PROOF_OK' AS verdict;

ROLLBACK;
