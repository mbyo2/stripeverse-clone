-- Merchant mobile-money rail (CEO decisions 2026-11-09; build ordered
-- 2026-11-11).
--
-- NOTE (2026-11-13, N-1): the live grants on the three tables below
-- drifted from this file (platform defaults gave anon + authenticated
-- FULL privileges incl. TRUNCATE). The revokes live in migration
-- 20261265_momo_grant_revoke_n1.sql — do not re-add broad grants here.
--
-- Model: each merchant connects their OWN mobile-money gateway
-- account by pasting their own API keys. Collections run against the
-- merchant's account — the platform has no gateway account of its own
-- for merchant collections and never routes merchant funds through
-- one. A settled collection credits the merchant's custodial ZMW
-- wallet in full; the platform's 1% is recorded as a SEPARATE charge
-- (momo_platform_charges), never deducted from the settlement.
--
-- Tables:
--   merchant_momo_connections — one row per merchant per environment
--     ('sandbox' | 'production'). The secret key is stored ONLY as an
--     AES-256-GCM envelope (see _shared/secret-vault.ts); the vault
--     key lives in an edge-function secret, never in the database.
--     Server-only table: RLS on, no client policies, service_role
--     only — merchants manage connections through the momo-settings
--     edge function, which never returns the key.
--   momo_collections — ledger-first collection rows, settled ONLY
--     from a re-queried gateway status via settle_momo_collection
--     (row lock + terminal guard + amount/currency match = exactly
--     once), mirroring the telco ledger of 20261237.
--   momo_platform_charges — the 1% platform charge per settled
--     collection, merchant-readable for billing transparency.
--
-- Zambia gate: connections and collections are created only by the
-- edge functions, which re-check merchant_accounts (country resolves
-- to ZM + mobile_money_enabled) server-side on every call — the same
-- source of truth as the connector config matrix.

-- ── Connections ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.merchant_momo_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  secret_key_ciphertext TEXT NOT NULL,
  secret_key_iv TEXT NOT NULL,
  vault_key_version INTEGER NOT NULL DEFAULT 1,
  public_key TEXT,
  account_id TEXT,
  api_base_url TEXT,
  key_hint TEXT,
  status TEXT NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'disconnected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, environment)
);

ALTER TABLE public.merchant_momo_connections ENABLE ROW LEVEL SECURITY;
-- No client policies at all: credentials are service-role only.
GRANT ALL ON public.merchant_momo_connections TO service_role;

-- ── Collections ledger ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.momo_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  wallet_id UUID NOT NULL REFERENCES public.wallets(id),
  transaction_id UUID NOT NULL,
  reference TEXT NOT NULL,
  provider_reference TEXT,
  idempotency_key TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'ZMW',
  operator TEXT NOT NULL CHECK (operator IN ('mtn', 'airtel', 'zamtel')),
  phone TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  source TEXT NOT NULL DEFAULT 'direct' CHECK (source IN ('direct', 'payment_link')),
  payment_link_id UUID REFERENCES public.payment_links(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'successful', 'failed')),
  provider_status_raw TEXT,
  provider_fee NUMERIC(14, 2),
  failure_reason TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS momo_collections_reference_key
  ON public.momo_collections (reference);
CREATE UNIQUE INDEX IF NOT EXISTS momo_collections_idempotency_key
  ON public.momo_collections (idempotency_key);
CREATE INDEX IF NOT EXISTS momo_collections_user_created_idx
  ON public.momo_collections (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS momo_collections_pending_idx
  ON public.momo_collections (created_at) WHERE status = 'pending';

ALTER TABLE public.momo_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Merchants view own mobile money collections" ON public.momo_collections;
CREATE POLICY "Merchants view own mobile money collections"
ON public.momo_collections FOR SELECT TO authenticated
USING (auth.uid() = user_id);
-- No client write policies: rows are created and settled only by the
-- service-role RPCs below.
GRANT SELECT ON public.momo_collections TO authenticated;
GRANT ALL ON public.momo_collections TO service_role;

-- ── Platform charges (the separate 1%) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.momo_platform_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES public.momo_collections(id) ON DELETE CASCADE,
  amount NUMERIC(14, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  percent NUMERIC(5, 2) NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded')),
  description TEXT NOT NULL DEFAULT 'Mobile money service charge (1%)',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (collection_id)
);

ALTER TABLE public.momo_platform_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Merchants view own mobile money charges" ON public.momo_platform_charges;
CREATE POLICY "Merchants view own mobile money charges"
ON public.momo_platform_charges FOR SELECT TO authenticated
USING (auth.uid() = user_id);

GRANT SELECT ON public.momo_platform_charges TO authenticated;
GRANT ALL ON public.momo_platform_charges TO service_role;

-- ── Begin: ledger row + transactions row ────────────────────────────
CREATE OR REPLACE FUNCTION public.begin_momo_collection(
  p_user_id UUID,
  p_account_id UUID,
  p_reference TEXT,
  p_amount NUMERIC,
  p_operator TEXT,
  p_phone TEXT,
  p_environment TEXT,
  p_source TEXT,
  p_payment_link_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(outcome TEXT, collection_id UUID, transaction_id UUID,
              reference TEXT, collection_status TEXT, wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_existing public.momo_collections%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_collection_id UUID := gen_random_uuid();
  v_transaction_id UUID := gen_random_uuid();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A merchant is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR round(p_amount, 2) <> p_amount THEN
    RAISE EXCEPTION 'Amount must be greater than zero with at most two decimal places';
  END IF;
  IF p_operator NOT IN ('mtn', 'airtel', 'zamtel') THEN
    RAISE EXCEPTION 'operator must be mtn, airtel or zamtel';
  END IF;
  IF p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'environment must be sandbox or production';
  END IF;
  IF p_source NOT IN ('direct', 'payment_link') THEN
    RAISE EXCEPTION 'source must be direct or payment_link';
  END IF;
  IF p_reference IS NULL OR p_reference !~ '^[A-Za-z0-9\-._]{8,64}$' THEN
    RAISE EXCEPTION 'A valid collection reference is required';
  END IF;
  IF p_phone IS NULL OR length(p_phone) < 10 THEN
    RAISE EXCEPTION 'A valid phone number is required';
  END IF;
  IF p_idempotency_key IS NULL OR length(p_idempotency_key) < 8 THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;

  -- Serialise concurrent begins carrying the same idempotency key:
  -- the loser re-reads the winner's row instead of aborting on a
  -- unique index after half the work is done.
  PERFORM pg_advisory_xact_lock(hashtext(p_idempotency_key));

  SELECT c.* INTO v_existing
  FROM public.momo_collections c
  WHERE c.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id
       OR v_existing.amount <> p_amount
       OR v_existing.operator <> p_operator
       OR v_existing.phone <> p_phone THEN
      outcome := 'idempotency_conflict';
    ELSE
      outcome := 'existing';
    END IF;
    collection_id := v_existing.id;
    transaction_id := v_existing.transaction_id;
    reference := v_existing.reference;
    collection_status := v_existing.status;
    SELECT w.balance INTO wallet_balance FROM public.wallets w WHERE w.id = v_existing.wallet_id;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Resolve the merchant's ZMW wallet for the settlement account the
  -- collection belongs to (the link's account, or Main). Fall back to
  -- Main, then create the wallet if the merchant has none yet.
  SELECT w.* INTO v_wallet
  FROM public.wallets w
  WHERE w.user_id = p_user_id AND w.currency = 'ZMW'
    AND w.account_id IS NOT DISTINCT FROM p_account_id
  ORDER BY w.created_at ASC
  LIMIT 1;

  IF v_wallet.id IS NULL AND p_account_id IS NOT NULL THEN
    SELECT w.* INTO v_wallet
    FROM public.wallets w
    WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL
    ORDER BY w.created_at ASC
    LIMIT 1;
  END IF;

  IF v_wallet.id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES (p_user_id, 'ZMW', 0, 'active', p_account_id)
    RETURNING * INTO v_wallet;
  END IF;

  INSERT INTO public.transactions (
    uuid_id, user_id, wallet_id, amount, currency, payment_method,
    direction, status, reference, provider, description, metadata
  ) VALUES (
    v_transaction_id, p_user_id, v_wallet.id, p_amount, 'ZMW', 'mobile_money',
    'incoming', 'pending', p_reference, 'mobile_money',
    'Mobile money payment',
    jsonb_build_object(
      'source', p_source,
      'operator', p_operator,
      'payment_link_id', p_payment_link_id,
      'environment', p_environment
    )
  );

  INSERT INTO public.momo_collections (
    id, user_id, wallet_id, transaction_id, reference, idempotency_key,
    amount, currency, operator, phone, environment, source, payment_link_id
  ) VALUES (
    v_collection_id, p_user_id, v_wallet.id, v_transaction_id, p_reference,
    p_idempotency_key, p_amount, 'ZMW', p_operator, p_phone, p_environment,
    p_source, p_payment_link_id
  );

  outcome := 'created';
  collection_id := v_collection_id;
  transaction_id := v_transaction_id;
  reference := p_reference;
  collection_status := 'pending';
  wallet_balance := v_wallet.balance;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_momo_collection(UUID, UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT) TO service_role;

-- ── Settle: only from a re-queried gateway status ───────────────────
CREATE OR REPLACE FUNCTION public.settle_momo_collection(
  p_reference TEXT,
  p_provider_status TEXT,
  p_provider_reference TEXT DEFAULT NULL,
  p_provider_amount NUMERIC DEFAULT NULL,
  p_provider_currency TEXT DEFAULT NULL,
  p_provider_fee NUMERIC DEFAULT NULL,
  p_provider_status_raw TEXT DEFAULT NULL,
  p_failure_reason TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, collection_status TEXT, transaction_status TEXT,
              wallet_balance NUMERIC, collection_id UUID, transaction_id UUID,
              payment_link_id UUID, merchant_user_id UUID, amount NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_collection public.momo_collections%ROWTYPE;
  v_wallet_balance NUMERIC;
  v_charge NUMERIC;
BEGIN
  IF p_provider_status NOT IN ('pending', 'successful', 'failed') THEN
    RAISE EXCEPTION 'provider status must be pending, successful or failed';
  END IF;

  SELECT c.* INTO v_collection
  FROM public.momo_collections c
  WHERE c.reference = p_reference
  FOR UPDATE;

  IF v_collection.id IS NULL THEN
    outcome := 'not_found'; collection_status := NULL; transaction_status := NULL;
    wallet_balance := NULL; collection_id := NULL; transaction_id := NULL;
    payment_link_id := NULL; merchant_user_id := NULL; amount := NULL;
    RETURN NEXT; RETURN;
  END IF;

  collection_id := v_collection.id;
  transaction_id := v_collection.transaction_id;
  payment_link_id := v_collection.payment_link_id;
  merchant_user_id := v_collection.user_id;
  amount := v_collection.amount;

  SELECT w.balance INTO v_wallet_balance FROM public.wallets w WHERE w.id = v_collection.wallet_id;

  -- Terminal rows never move again; a conflicting late status is
  -- reported, never applied.
  IF v_collection.status <> 'pending' THEN
    outcome := CASE WHEN v_collection.status = p_provider_status
      THEN 'already_terminal' ELSE 'terminal_conflict' END;
    collection_status := v_collection.status;
    transaction_status := CASE WHEN v_collection.status = 'successful' THEN 'completed' ELSE 'failed' END;
    wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'pending' THEN
    UPDATE public.momo_collections
    SET provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        provider_fee = COALESCE(p_provider_fee, provider_fee),
        updated_at = now()
    WHERE id = v_collection.id;
    outcome := 'still_pending'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- A terminal settlement must match the ledger exactly.
  IF p_provider_amount IS NOT NULL AND round(p_provider_amount, 2) <> v_collection.amount THEN
    outcome := 'amount_mismatch'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;
  IF p_provider_currency IS NOT NULL AND upper(p_provider_currency) <> v_collection.currency THEN
    outcome := 'currency_mismatch'; collection_status := 'pending';
    transaction_status := 'pending'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  IF p_provider_status = 'successful' THEN
    -- Credit the merchant's custodial wallet IN FULL. The platform
    -- charge is a separate ledger entry below — never netted here.
    UPDATE public.wallets
    SET balance = balance + v_collection.amount, updated_at = now()
    WHERE id = v_collection.wallet_id
    RETURNING balance INTO v_wallet_balance;

    UPDATE public.momo_collections
    SET status = 'successful',
        provider_reference = COALESCE(p_provider_reference, provider_reference),
        provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
        provider_fee = COALESCE(p_provider_fee, provider_fee),
        settled_at = now(), updated_at = now()
    WHERE id = v_collection.id;

    UPDATE public.transactions
    SET status = 'completed',
        external_reference = COALESCE(p_provider_reference, external_reference),
        description = 'Mobile money payment received',
        updated_at = now()
    WHERE uuid_id = v_collection.transaction_id;

    -- The platform's 1 percent, billed separately to the merchant.
    v_charge := round(v_collection.amount * 0.01, 2);
    INSERT INTO public.momo_platform_charges (user_id, collection_id, amount, currency, percent)
    VALUES (v_collection.user_id, v_collection.id, v_charge, v_collection.currency, 1)
    ON CONFLICT (collection_id) DO NOTHING;

    -- Payment-link counters move exactly once, inside the same
    -- transaction as the credit (the terminal guard above is what
    -- makes this once-only).
    IF v_collection.payment_link_id IS NOT NULL THEN
      UPDATE public.payment_links
      SET payment_count = COALESCE(payment_count, 0) + 1,
          total_collected = COALESCE(total_collected, 0) + v_collection.amount,
          updated_at = now()
      WHERE id = v_collection.payment_link_id;
    END IF;

    outcome := 'settled'; collection_status := 'successful';
    transaction_status := 'completed'; wallet_balance := v_wallet_balance;
    RETURN NEXT; RETURN;
  END IF;

  -- FAILED terminal: no credit, no charge — the ledger just closes.
  UPDATE public.momo_collections
  SET status = 'failed',
      provider_reference = COALESCE(p_provider_reference, provider_reference),
      provider_status_raw = COALESCE(p_provider_status_raw, provider_status_raw),
      provider_fee = COALESCE(p_provider_fee, provider_fee),
      failure_reason = COALESCE(p_failure_reason, failure_reason),
      updated_at = now()
  WHERE id = v_collection.id;

  UPDATE public.transactions
  SET status = 'failed', updated_at = now()
  WHERE uuid_id = v_collection.transaction_id;

  outcome := 'failed_terminal'; collection_status := 'failed';
  transaction_status := 'failed'; wallet_balance := v_wallet_balance;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_momo_collection(TEXT, TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT) TO service_role;

-- ── Requery poller schedule ─────────────────────────────────────────
-- The gateway's own docs warn webhooks cannot be relied on completely
-- and advise a requery service polling until a final status. Every 10
-- minutes the momo-requery function re-reads stale pending rows and
-- applies them through the SAME settle path as the webhook. Safe to
-- run with the rail dark: it quiet-skips (200) when nothing pends.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'momo-requery') THEN
    PERFORM cron.unschedule('momo-requery');
  END IF;
END $$;

SELECT cron.schedule(
  'momo-requery',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/momo-requery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb);
  $$);
