-- Migration 20261250: custodial-send safety (liquidity research steps 0–1)
-- =========================================================================
-- The $0 half of making custodial Send honest and safe (research report
-- 2026-11-04, steps 0–1):
--
--  1. Operator-configurable withdrawal policy on the platform_settings
--     singleton: per-rail minimums (regular users; the operator's small
--     proof sends stay possible — minimums are enforced in the send
--     functions with an operator exemption), per-transaction cap,
--     per-user daily cap, and a NEW platform-wide daily hot-wallet
--     velocity cap. Defaults preserve today's behaviour where the
--     research was silent (max tx 2,000,000 sats, per-user daily
--     5,000,000 sats — the values the send functions previously took
--     from env) and set the research's minimums: on-chain 32,000 sats
--     (≈ $25 at the 2026-11-04 price — the low end of the $25–50
--     batching range) and Lightning 1,000 sats.
--
--  2. The persisted pool UTXO set (btc_pool_utxos + btc_pool_sync_state):
--     btc-onchain reads the pool's confirmed UTXOs from Postgres
--     (incrementally maintained by deposit credits and broadcast
--     spend-marks) and only rescans the explorer when the set is
--     stale — no more full xpub rescan per send.
--
--  3. Ledger buckets + daily reconciliation: btc_ledger_buckets()
--     splits the platform BTC ledger into user liabilities (every
--     non-operator balance) and fee income (the operator's BTC wallet
--     — the codebase's fee account since migration 20261223); the
--     float is derived against pool reality by btc-onchain's
--     reconcile_pools action, whose verdicts land in
--     btc_reconciliation_runs via a daily cron — a report, never a
--     silent fix-up.
--
-- Grant discipline (Oct-30 rule + 20261249 precedent): new tables get
-- explicit scoped grants (service_role only — these are server-side
-- operational tables; RLS is enabled with no policies so anon /
-- authenticated read nothing), default-privilege grants to anon and
-- authenticated are explicitly revoked, and the new RPC's EXECUTE is
-- revoked from PUBLIC/anon/authenticated and granted to service_role
-- only. Verify afterwards with information_schema / has_function_privilege
-- — a REVOKE can silently no-op when the grantor differs.
-- =========================================================================

-- ── 1. Withdrawal policy columns (singleton platform_settings) ──────────

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS btc_min_withdrawal_onchain_sats BIGINT NOT NULL DEFAULT 32000,
  ADD COLUMN IF NOT EXISTS btc_min_withdrawal_lightning_sats BIGINT NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS btc_max_tx_sats BIGINT NOT NULL DEFAULT 2000000,
  ADD COLUMN IF NOT EXISTS btc_max_daily_sats BIGINT NOT NULL DEFAULT 5000000,
  ADD COLUMN IF NOT EXISTS btc_max_platform_daily_sats BIGINT NOT NULL DEFAULT 20000000;

COMMENT ON COLUMN public.platform_settings.btc_min_withdrawal_onchain_sats IS
  'Minimum custodial on-chain BTC withdrawal for regular users (sats). Operators (admin/super_admin) are exempt so small proof sends stay possible while the feature is gated.';
COMMENT ON COLUMN public.platform_settings.btc_min_withdrawal_lightning_sats IS
  'Minimum custodial Lightning payment for regular users (sats). Operators are exempt (see on-chain minimum).';
COMMENT ON COLUMN public.platform_settings.btc_max_tx_sats IS
  'Per-transaction cap for custodial BTC sends (sats), both rails.';
COMMENT ON COLUMN public.platform_settings.btc_max_daily_sats IS
  'Per-user daily cap for custodial BTC sends (sats), both rails; enforced atomically inside the reserve RPCs.';
COMMENT ON COLUMN public.platform_settings.btc_max_platform_daily_sats IS
  'Platform-wide daily cap across all custodial BTC sends (sats) — the hot-wallet velocity ceiling.';

-- ── 2. Persisted pool UTXO set ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.btc_pool_utxos (
  txid             TEXT NOT NULL,
  vout             INTEGER NOT NULL,
  value_sats       BIGINT NOT NULL,
  chain            INTEGER NOT NULL,           -- 0 = receive, 1 = change (BIP84)
  derivation_index INTEGER NOT NULL,
  address          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'spent')),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (txid, vout)
);
CREATE INDEX IF NOT EXISTS idx_btc_pool_utxos_status ON public.btc_pool_utxos (status);

COMMENT ON TABLE public.btc_pool_utxos IS
  'The custodial pool''s confirmed UTXO set, persisted so sends read Postgres instead of rescanning the whole xpub against a public explorer per request. Maintained incrementally: deposit credits upsert their UTXO, broadcasts mark inputs spent, and a full rescan (btc_pool_sync_state TTL) reconciles the set.';

CREATE TABLE IF NOT EXISTS public.btc_pool_sync_state (
  id                    BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  last_utxo_refresh_at  TIMESTAMPTZ,
  last_refresh_reason   TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.btc_pool_sync_state (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

-- ── 3. Reconciliation runs (the daily report) ────────────────────────────

CREATE TABLE IF NOT EXISTS public.btc_reconciliation_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_liabilities_sats BIGINT NOT NULL,
  fee_income_sats       BIGINT NOT NULL,
  pool_onchain_sats     BIGINT,
  pool_lightning_sats   BIGINT,
  float_sats            BIGINT,
  status                TEXT NOT NULL CHECK (status IN ('ok', 'under_backed', 'partial')),
  detail                JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.btc_reconciliation_runs IS
  'Daily ledger-vs-pool reconciliation verdicts (btc-onchain reconcile_pools, cron btc-reconcile-pools). float = (on-chain pool + Lightning pool) − (user liabilities + fee income). under_backed means the ledger promises more sats than the pools hold — a report for the operator, never an automatic fix-up.';

-- Table privileges: server-side operational tables — service_role only.
ALTER TABLE public.btc_pool_utxos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btc_pool_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.btc_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.btc_pool_utxos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.btc_pool_sync_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.btc_reconciliation_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.btc_pool_utxos TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.btc_pool_sync_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.btc_reconciliation_runs TO service_role;

-- ── 4. Ledger buckets ────────────────────────────────────────────────────
--
-- The operator is the earliest admin (the codebase's convention — the
-- same account consolidation fees already settle to). Its BTC wallet
-- balance is the fee-income bucket; every other user's BTC balance is
-- a user liability. The float is NOT stored here: it only exists
-- against pool reality, which btc-onchain computes at reconcile time.

CREATE OR REPLACE FUNCTION public.btc_ledger_buckets()
RETURNS TABLE (operator_user_id UUID, user_liabilities_sats BIGINT, fee_income_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_operator UUID;
BEGIN
  SELECT ur.user_id INTO v_operator
    FROM public.user_roles ur
   WHERE ur.role = 'admin'
   ORDER BY ur.created_at ASC, ur.user_id ASC
   LIMIT 1;

  RETURN QUERY
  SELECT
    v_operator,
    COALESCE(SUM(cw.balance_sats) FILTER (WHERE v_operator IS NULL OR cw.user_id <> v_operator), 0)::BIGINT,
    COALESCE(SUM(cw.balance_sats) FILTER (WHERE cw.user_id = v_operator), 0)::BIGINT
    FROM public.crypto_wallets cw
   WHERE cw.asset = 'BTC';
END;
$$;

COMMENT ON FUNCTION public.btc_ledger_buckets() IS
  'Ledger buckets for pool reconciliation: user liabilities = sum of all non-operator BTC balances; fee income = the operator (earliest admin) BTC wallet balance. Service-role only.';

REVOKE ALL ON FUNCTION public.btc_ledger_buckets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_ledger_buckets() TO service_role;

-- ── 5. Daily reconciliation cron (03:17 UTC, off the other BTC jobs) ────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'btc-reconcile-pools') THEN
    PERFORM cron.unschedule('btc-reconcile-pools');
  END IF;
END $$;

SELECT cron.schedule(
  'btc-reconcile-pools',
  '17 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/btc-onchain',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"action":"reconcile_pools"}'::jsonb
  );
  $$
);
