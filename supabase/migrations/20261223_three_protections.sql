-- ============================================================================
-- Three network-fee protections (CEO approved 2026-10-26, following the
-- gas / network-fee audit in pay-with-bitcoin-addendum-2026-10-26.md):
--
-- P1 — Lightning receive tolerance (audit row 2). Settlement used to
--   require Coinos received >= required EXACTLY: any future provider
--   deduction on receives would strand a paid invoice forever. Now a
--   Lightning receipt is recorded at the amount that ACTUALLY arrived;
--   a shortfall inside the provider-deduction band
--     shortfall <= floor(required_sats / 100)  AND  <= 100 sats
--   (mirrors providerDeductionBandSats in _shared/link-btc.ts) settles
--   on the actual received sats. The split absorbs the shortfall out
--   of the PLATFORM fee first (fee = max(0, min(fee, received) -
--   shortfall)), so the merchant nets exactly what an undeducted
--   settlement would have paid them whenever the shortfall fits
--   inside the fee — the normal case, since the fee is 2.5% of the
--   amount and the band is 1% of required. Invariants unchanged:
--   never credit more than actually received; exactly-once (same
--   status guards + idempotency keys); a shortfall BELOW the band is
--   a genuine underpayment and is never recorded by the Lightning
--   RPC — the attempt keeps its top-up behaviour.
--
-- P2a — Minimum Bitcoin link amount (audit row 4). platform_settings
--   .btc_link_min_amount (default 5.00, in the link's currency);
--   payment-link-checkout's btc_create_attempt refuses below it,
--   server-side, with a crafted message. Wallet payment is untouched.
--
-- P2b — UTXO consolidation duty (audit row 4) + P4 fee-window policy.
--   platform_settings carries the shared fee-window policy: the
--   consolidation broadcast cap (default 2 sat/vB), a separate higher
--   cap reserved for future payment batches (default 5 sat/vB — a
--   policy value only; no batching ships in this migration), the
--   consolidation kill switch (default ON), min inputs (10) and the
--   small-UTXO ceiling (10,000 sats). btc_consolidation_runs is the
--   audit trail; btc_record_consolidation books a confirmed run
--   (audit update + the fee debited from the PLATFORM OPERATOR's BTC
--   fee income + a ledger row) atomically. A daily pg_cron job calls
--   btc-onchain's service-role `consolidate` action, mirroring the
--   btc-check-deposits job's vault-authenticated http_post.
-- ============================================================================

-- ── 1. Settings: minimum BTC link amount + fee-window policy ──────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS btc_link_min_amount NUMERIC NOT NULL DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS btc_consolidation_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS btc_fee_window_consolidation_max_sat_vb NUMERIC NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS btc_fee_window_batch_max_sat_vb NUMERIC NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS btc_consolidation_min_inputs INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS btc_consolidation_small_max_sats BIGINT NOT NULL DEFAULT 10000;

-- ── 2. Attempts: the absorbed provider deduction, on the record ──────────
ALTER TABLE public.payment_link_btc_attempts
  ADD COLUMN IF NOT EXISTS provider_deduction_sats BIGINT NOT NULL DEFAULT 0
  CHECK (provider_deduction_sats >= 0);

-- ── 3. Settlement: settle on ACTUAL received within the band ─────────────
-- Identical to migration 20261217's function except: the coverage
-- guard admits received >= required - provider_deduction_sats; the
-- fee split absorbs the shortfall out of the platform fee first; the
-- merchant ledger metadata records the deduction. The already-settled
-- replay branch recomputes the same split from the row, so a replay
-- reports what the first settle did.
CREATE OR REPLACE FUNCTION public.execute_payment_link_btc_settlement(
  p_attempt_id UUID,
  p_payment_method TEXT
)
RETURNS TABLE(
  owner_transaction_id UUID,
  merchant_credit_sats BIGINT,
  platform_fee_sats BIGINT,
  already_settled BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_link_btc_attempts;
  v_link public.payment_links;
  v_platform_user UUID;
  v_fee BIGINT;
  v_shortfall BIGINT;
  v_merchant_credit BIGINT;
  v_owner_tx UUID;
  v_merchant_name TEXT;
BEGIN
  IF p_payment_method NOT IN ('bitcoin_onchain', 'bitcoin_lightning') THEN
    RAISE EXCEPTION 'Invalid Bitcoin payment method';
  END IF;

  SELECT * INTO v_attempt FROM public.payment_link_btc_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;

  v_shortfall := GREATEST(0, v_attempt.required_sats - v_attempt.received_sats);

  IF v_attempt.status = 'settled' THEN
    owner_transaction_id := v_attempt.owner_transaction_id;
    platform_fee_sats := GREATEST(0,
      LEAST(v_attempt.fee_sats, v_attempt.received_sats) - v_shortfall);
    merchant_credit_sats := v_attempt.received_sats - platform_fee_sats;
    already_settled := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_attempt.status IN ('partial_credited', 'failed') THEN
    RAISE EXCEPTION 'Payment attempt can no longer settle';
  END IF;
  -- Coverage: full payment, or a provider-deduction shortfall that
  -- the record RPC already validated against the band (P1). The
  -- deduction column can only be non-zero when that validation ran.
  IF v_attempt.received_sats < v_attempt.required_sats - v_attempt.provider_deduction_sats THEN
    RAISE EXCEPTION 'Payment attempt is not fully paid: have % sats, need %',
      v_attempt.received_sats, v_attempt.required_sats;
  END IF;

  SELECT * INTO v_link FROM public.payment_links
  WHERE id = v_attempt.link_id FOR UPDATE;
  IF v_link.id IS NULL THEN
    RAISE EXCEPTION 'Payment link not found';
  END IF;

  -- Platform fee: the operator is the earliest-created admin (the
  -- fiat settlement's rule). No operator yet, or the merchant IS the
  -- operator: no fee — the merchant keeps everything.
  -- P1: a provider-deduction shortfall is absorbed out of the fee
  -- first, so the merchant is made whole whenever the shortfall fits
  -- inside the fee.
  v_fee := LEAST(v_attempt.fee_sats, v_attempt.received_sats);
  v_fee := GREATEST(0, v_fee - v_shortfall);
  SELECT ur.user_id INTO v_platform_user
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.created_at, ur.user_id
  LIMIT 1;
  IF v_platform_user IS NULL OR v_platform_user = v_attempt.merchant_user_id THEN
    v_fee := 0;
  END IF;
  v_merchant_credit := v_attempt.received_sats - v_fee;

  -- Money: merchant net, then the platform fee (both via the
  -- row-locked crypto wallet adjuster every BTC flow uses).
  PERFORM public.btc_adjust_crypto_wallet(
    v_attempt.merchant_user_id, v_merchant_credit, v_merchant_credit);
  IF v_fee > 0 THEN
    PERFORM public.btc_adjust_crypto_wallet(v_platform_user, v_fee, v_fee);
  END IF;

  SELECT NULLIF(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
  INTO v_merchant_name
  FROM public.profiles p WHERE p.id = v_attempt.merchant_user_id;

  -- Merchant incoming row — the payment_link.paid anchor.
  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key, metadata)
  VALUES
    (v_attempt.merchant_user_id,
     (v_merchant_credit::numeric / 100000000), 'BTC', 'incoming',
     p_payment_method, 'completed',
     'Payment link: ' || v_link.title || ' (Bitcoin)',
     'link:' || v_link.id::text, 'payment_link',
     'link-btc:' || v_attempt.id::text || ':in',
     jsonb_build_object(
       'attempt_id', v_attempt.id,
       'received_sats', v_attempt.received_sats,
       'fee_sats', v_fee,
       'net_sats', v_merchant_credit,
       'provider_deduction_sats', v_attempt.provider_deduction_sats,
       'absorbed_shortfall_sats', v_shortfall,
       'fiat_amount', v_attempt.fiat_amount,
       'fiat_currency', v_attempt.fiat_currency,
       'rate_fiat_per_btc', v_attempt.rate_fiat_per_btc))
  RETURNING uuid_id INTO v_owner_tx;

  IF v_fee > 0 THEN
    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       description, reference, category, idempotency_key, metadata)
    VALUES
      (v_attempt.merchant_user_id,
       (v_fee::numeric / 100000000), 'BTC', 'outgoing',
       p_payment_method, 'completed',
       'Platform fee — payment link: ' || v_link.title,
       'link:' || v_link.id::text, 'platform_fee',
       'link-btc:' || v_attempt.id::text || ':platform_fee:out',
       jsonb_build_object('attempt_id', v_attempt.id, 'fee_sats', v_fee));

    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       recipient_name, description, reference, category, idempotency_key, metadata)
    VALUES
      (v_platform_user,
       (v_fee::numeric / 100000000), 'BTC', 'incoming',
       p_payment_method, 'completed', v_merchant_name,
       'Platform fee — payment link: ' || v_link.title,
       'link:' || v_link.id::text, 'platform_fee',
       'link-btc:' || v_attempt.id::text || ':platform_fee:in',
       jsonb_build_object('attempt_id', v_attempt.id, 'fee_sats', v_fee));
  END IF;

  -- Link counters at the LOCKED fiat amount (an attempt in flight
  -- when the cap was reached still completes — its money arrived;
  -- the cap guards new payments, as in the fiat flow).
  UPDATE public.payment_links
  SET payment_count = COALESCE(payment_count, 0) + 1,
      total_collected = COALESCE(total_collected, 0) + v_attempt.fiat_amount,
      updated_at = now()
  WHERE id = v_link.id;

  UPDATE public.payment_link_btc_attempts
  SET status = 'settled', settled_at = now(),
      owner_transaction_id = v_owner_tx, updated_at = now()
  WHERE id = v_attempt.id;

  owner_transaction_id := v_owner_tx;
  merchant_credit_sats := v_merchant_credit;
  platform_fee_sats := v_fee;
  already_settled := FALSE;
  RETURN NEXT;
END;
$$;

-- ── 4. Record a Lightning receipt at the ACTUAL received amount ──────────
-- Replaces the 1-arg 20261217 version (which credited exactly
-- required_sats on a full-paid signal). The caller passes what the
-- provider reports as actually received for the invoice; the RPC
-- re-validates the deduction band server-side and REFUSES a receipt
-- short by more than the band (a genuine underpayment — never
-- recorded, the attempt keeps its top-up behaviour). The deduction
-- is stored on the attempt so settlement (above) and the ledger
-- metadata show it.
DROP FUNCTION IF EXISTS public.btc_record_link_attempt_lightning(UUID);

CREATE OR REPLACE FUNCTION public.btc_record_link_attempt_lightning(
  p_attempt_id UUID,
  p_received_sats BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_link_btc_attempts;
  v_deduction BIGINT;
  v_band BIGINT;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_link_btc_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;
  IF v_attempt.status = 'settled' THEN
    RETURN 'already_settled';
  END IF;
  IF v_attempt.status IN ('partial_credited', 'failed') THEN
    RETURN 'closed';
  END IF;
  IF v_attempt.lightning_received_sats > 0 THEN
    RETURN 'already_recorded';
  END IF;
  IF p_received_sats IS NULL OR p_received_sats <= 0 THEN
    RAISE EXCEPTION 'Received amount must be positive';
  END IF;

  v_deduction := GREATEST(0, v_attempt.required_sats - p_received_sats);
  -- The band mirrors providerDeductionBandSats (_shared/link-btc.ts):
  -- floor(1 percent of required), capped at 100 sats. (Integer
  -- division on positive bigints is exact floor.)
  v_band := LEAST(v_attempt.required_sats / 100, 100);
  IF v_deduction > v_band THEN
    RAISE EXCEPTION 'Lightning receipt is % sats short of the % required — beyond the provider-deduction band of % sats',
      v_deduction, v_attempt.required_sats, v_band;
  END IF;

  UPDATE public.payment_link_btc_attempts
  SET lightning_received_sats = p_received_sats,
      received_sats = received_sats + p_received_sats,
      seen_sats = GREATEST(seen_sats, received_sats + p_received_sats),
      provider_deduction_sats = v_deduction,
      status = CASE WHEN status = 'waiting' THEN 'partial' ELSE status END,
      updated_at = now()
  WHERE id = p_attempt_id;
  RETURN 'recorded';
END;
$$;

-- ── 5. Consolidation audit trail + fee booking ────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_consolidation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL CHECK (status IN (
    'broadcast', 'broadcast_unknown',
    'skipped_disabled', 'skipped_daily_limit', 'skipped_fee_window',
    'skipped_min_inputs', 'skipped_output_dust', 'skipped_fee_unfunded',
    'skipped_no_custody', 'failed')),
  reason TEXT,
  fee_rate_sat_vb NUMERIC,
  input_count INTEGER NOT NULL DEFAULT 0,
  inputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_in_sats BIGINT,
  fee_sats BIGINT,
  output_sats BIGINT,
  output_address TEXT,
  output_derivation_index BIGINT,
  txid TEXT,
  fee_booked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.btc_consolidation_runs ENABLE ROW LEVEL SECURITY;
-- No client policies: service-role functions only, like the other
-- btc_* tables.

CREATE INDEX IF NOT EXISTS idx_btc_consolidation_runs_created
  ON public.btc_consolidation_runs(created_at DESC);

-- Book a CONFIRMED consolidation broadcast: audit row completed, the
-- network fee debited from the platform operator's BTC fee income
-- (the row-locked adjuster refuses an overdraft), and the ledger row
-- that explains the debit. Called by btc-onchain ONLY after the
-- broadcast is positively confirmed — an unconfirmed broadcast is
-- recorded as 'broadcast_unknown' by a plain update and reconciled
-- by a human, the same doctrine as withdrawals.
CREATE OR REPLACE FUNCTION public.btc_record_consolidation(
  p_run_id UUID,
  p_operator_user_id UUID,
  p_txid TEXT,
  p_fee_sats BIGINT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.btc_consolidation_runs;
BEGIN
  SELECT * INTO v_run FROM public.btc_consolidation_runs
  WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Consolidation run not found';
  END IF;
  IF v_run.fee_booked THEN
    RETURN 'already_booked';
  END IF;
  IF p_fee_sats IS NULL OR p_fee_sats < 0 THEN
    RAISE EXCEPTION 'Invalid consolidation fee';
  END IF;

  IF p_fee_sats > 0 THEN
    PERFORM public.btc_adjust_crypto_wallet(
      p_operator_user_id, -p_fee_sats, -p_fee_sats);

    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       description, reference, category, idempotency_key, metadata)
    VALUES
      (p_operator_user_id,
       (p_fee_sats::numeric / 100000000), 'BTC', 'outgoing',
       'bitcoin_onchain', 'completed',
       'Bitcoin UTXO consolidation — network fee',
       p_txid, 'btc_consolidation',
       'btc-cons:' || p_run_id::text,
       jsonb_build_object(
         'run_id', p_run_id,
         'txid', p_txid,
         'fee_sats', p_fee_sats,
         'input_count', v_run.input_count));
  END IF;

  UPDATE public.btc_consolidation_runs
  SET status = 'broadcast', txid = p_txid, fee_sats = p_fee_sats,
      fee_booked = true, updated_at = now()
  WHERE id = p_run_id;
  RETURN 'booked';
END;
$$;

-- ── 6. Daily consolidation cron (mirrors btc-check-deposits) ─────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-consolidate-utxos') THEN
    PERFORM cron.unschedule('btc-consolidate-utxos');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-consolidate-utxos',
  '23 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/btc-onchain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{"action": "consolidate"}'::jsonb);
  $$);

-- ── 7. Grants: service role only ──────────────────────────────────────────
REVOKE ALL ON FUNCTION public.execute_payment_link_btc_settlement(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.btc_record_link_attempt_lightning(UUID, BIGINT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.btc_record_consolidation(UUID, UUID, TEXT, BIGINT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_btc_settlement(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_record_link_attempt_lightning(UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_record_consolidation(UUID, UUID, TEXT, BIGINT) TO service_role;
