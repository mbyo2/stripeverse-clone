-- ============================================================================
-- Bitcoin completion: custodial on-chain deposits, withdrawals, buy/sell.
--
-- Model: the platform holds one master seed server-side (Supabase secret).
-- Users hold ledger balances in crypto_wallets (sats). Real BTC sits in the
-- platform wallet; per-user deposit addresses are BIP84-derived from the
-- account zpub (m/84'/0'/0'/0/<index>).
--
-- This migration adds:
--   1. btc_address_assignments — one deposit address per user, index unique
--   2. btc_deposits             — detected on-chain deposits, (txid, vout)
--                                 unique so a deposit can never credit twice
--   3. btc_withdrawals          — on-chain sends with reserve/finalize flow
--   4. btc_quotes               — 60-second buy/sell quotes, single-consume
--   5. btc_treasury             — singleton float: platform-owned BTC (sats)
--                                 available to back user buy orders.
--                                 Invariant: hot wallet BTC ≈ float_sats
--                                 + Σ users' crypto_wallets BTC balances.
--   6. RPCs (service_role only) that move sats atomically under row locks:
--      btc_adjust_crypto_wallet, btc_record_deposit, btc_execute_trade,
--      btc_reserve_withdrawal, btc_finalize_withdrawal, btc_fail_withdrawal.
--   7. RLS hardening: clients may READ crypto_wallets but may no longer
--      INSERT/UPDATE rows directly (previously any signed-in user could
--      set their own balance_sats to an arbitrary value via PostgREST).
--      All mutations now flow through service-role edge functions / RPCs.
--
-- PRE-FLIGHT (live DB): Lovable previously created BTC tables directly in
-- the live project (btc_deposit_addresses, btc_onchain_deposits,
-- btc_withdrawals per the 20261017_btc_infrastructure.sql header). If those
-- hold real assignments, backfill btc_address_assignments from them and
-- restart btc_derivation_index_seq above the highest legacy index BEFORE
-- enabling deposits, so no address is ever handed to two different users.
-- ============================================================================

-- ── 1. Address assignments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_address_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  derivation_index BIGINT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.btc_derivation_index_seq START WITH 0;
CREATE SEQUENCE IF NOT EXISTS public.btc_change_index_seq START WITH 0;

ALTER TABLE public.btc_address_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own btc address" ON public.btc_address_assignments;
CREATE POLICY "Users view own btc address"
ON public.btc_address_assignments FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- ── 2. Deposits ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  txid TEXT NOT NULL,
  vout INTEGER NOT NULL,
  amount_sats BIGINT NOT NULL CHECK (amount_sats > 0),
  confirmations INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected', 'credited')),
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (txid, vout)
);

CREATE INDEX IF NOT EXISTS idx_btc_deposits_user ON public.btc_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_btc_deposits_status ON public.btc_deposits(status);

ALTER TABLE public.btc_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own btc deposits" ON public.btc_deposits;
CREATE POLICY "Users view own btc deposits"
ON public.btc_deposits FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- ── 3. Withdrawals ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_address TEXT NOT NULL,
  amount_sats BIGINT NOT NULL CHECK (amount_sats > 0),
  fee_sats BIGINT NOT NULL CHECK (fee_sats >= 0),
  txid TEXT,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'broadcast', 'confirmed', 'failed')),
  idempotency_key TEXT UNIQUE,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_btc_withdrawals_user ON public.btc_withdrawals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_btc_withdrawals_status ON public.btc_withdrawals(status);

ALTER TABLE public.btc_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Users view own btc withdrawals"
ON public.btc_withdrawals FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- ── 4. Quotes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  mid_rate_zmw NUMERIC(20, 2) NOT NULL,        -- ZMW per 1 BTC, market mid
  fee_bps INTEGER NOT NULL,                    -- spread applied, basis points
  fee_zmw NUMERIC(20, 2) NOT NULL DEFAULT 0,   -- spread value in ZMW terms
  amount_zmw NUMERIC(20, 2) NOT NULL,          -- buy: ZMW debited; sell: ZMW credited
  amount_sats BIGINT NOT NULL,                 -- buy: sats credited; sell: sats debited
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_btc_quotes_user ON public.btc_quotes(user_id, created_at DESC);

ALTER TABLE public.btc_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own btc quotes" ON public.btc_quotes;
CREATE POLICY "Users view own btc quotes"
ON public.btc_quotes FOR SELECT TO authenticated
USING (auth.uid() = user_id);

-- ── 5. Treasury float ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.btc_treasury (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  float_sats BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.btc_treasury (id, float_sats) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.btc_treasury ENABLE ROW LEVEL SECURITY;
-- No client policies: service role only.

-- ── 6a. Atomic crypto wallet adjustment (row-locked, non-negative) ────────
CREATE OR REPLACE FUNCTION public.btc_adjust_crypto_wallet(
  p_user_id UUID,
  p_delta_balance BIGINT,
  p_delta_available BIGINT
)
RETURNS TABLE(balance_sats BIGINT, available_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_available BIGINT;
BEGIN
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT w.balance_sats, w.available_sats INTO v_balance, v_available
  FROM public.crypto_wallets w
  WHERE w.user_id = p_user_id AND w.asset = 'BTC'
  FOR UPDATE;

  IF v_balance + p_delta_balance < 0 OR v_available + p_delta_available < 0 THEN
    RAISE EXCEPTION 'Insufficient BTC balance';
  END IF;

  UPDATE public.crypto_wallets AS w
  SET balance_sats = w.balance_sats + p_delta_balance,
      available_sats = w.available_sats + p_delta_available,
      updated_at = now()
  WHERE w.user_id = p_user_id AND w.asset = 'BTC'
  RETURNING w.balance_sats, w.available_sats
  INTO v_balance, v_available;

  balance_sats := v_balance;
  available_sats := v_available;
  RETURN NEXT;
END;
$$;

-- ── 6b. Record a deposit; credit exactly once at >= p_required_confs ──────
CREATE OR REPLACE FUNCTION public.btc_record_deposit(
  p_user_id UUID,
  p_address TEXT,
  p_txid TEXT,
  p_vout INTEGER,
  p_amount_sats BIGINT,
  p_confirmations INTEGER,
  p_required_confs INTEGER DEFAULT 1
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_amount BIGINT;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be positive';
  END IF;

  INSERT INTO public.btc_deposits
    (user_id, address, txid, vout, amount_sats, confirmations, status)
  VALUES
    (p_user_id, p_address, p_txid, p_vout, p_amount_sats, p_confirmations, 'detected')
  ON CONFLICT (txid, vout) DO NOTHING;

  SELECT d.status, d.amount_sats INTO v_status, v_amount
  FROM public.btc_deposits d
  WHERE d.txid = p_txid AND d.vout = p_vout
  FOR UPDATE;

  IF v_amount <> p_amount_sats THEN
    RAISE EXCEPTION 'Deposit amount mismatch for %:% (stored %, seen %)',
      p_txid, p_vout, v_amount, p_amount_sats;
  END IF;

  UPDATE public.btc_deposits
  SET confirmations = GREATEST(confirmations, p_confirmations), updated_at = now()
  WHERE txid = p_txid AND vout = p_vout;

  IF v_status = 'credited' THEN
    RETURN 'already_credited';
  END IF;

  IF p_confirmations < p_required_confs THEN
    RETURN 'detected';
  END IF;

  -- Credit the wallet (same code path as btc_adjust_crypto_wallet).
  PERFORM public.btc_adjust_crypto_wallet(p_user_id, p_amount_sats, p_amount_sats);

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (p_user_id, p_amount_sats::numeric / 100000000, 'BTC', 'incoming',
     'bitcoin_onchain', 'completed', 'Bitcoin deposit (on-chain)',
     p_txid, 'btc_deposit', 'btc-dep:' || p_txid || ':' || p_vout);

  UPDATE public.btc_deposits
  SET status = 'credited', credited_at = now(), updated_at = now()
  WHERE txid = p_txid AND vout = p_vout;

  RETURN 'credited';
END;
$$;

-- ── 6c. Execute a buy/sell quote atomically ────────────────────────────────
-- Buy:  debit ZMW amount_zmw, credit amount_sats, float -= amount_sats.
-- Sell: debit amount_sats, credit ZMW amount_zmw, float += amount_sats.
CREATE OR REPLACE FUNCTION public.btc_execute_trade(
  p_user_id UUID,
  p_quote_id UUID,
  p_idempotency_key TEXT
)
RETURNS TABLE(quote_id UUID, side TEXT, amount_zmw NUMERIC, amount_sats BIGINT,
              new_zmw_balance NUMERIC, new_btc_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.btc_quotes%ROWTYPE;
  v_zmw_id UUID;
  v_zmw_balance NUMERIC;
  v_crypto_balance BIGINT;
  v_crypto_available BIGINT;
  v_existing UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.id INTO v_existing
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':zmw'
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      SELECT q.* INTO v_quote FROM public.btc_quotes q WHERE q.id = p_quote_id;
      SELECT w.balance INTO v_zmw_balance FROM public.wallets w
        WHERE w.user_id = p_user_id AND w.currency = 'ZMW';
      SELECT c.balance_sats INTO v_crypto_balance FROM public.crypto_wallets c
        WHERE c.user_id = p_user_id AND c.asset = 'BTC';
      quote_id := v_quote.id; side := v_quote.side;
      amount_zmw := v_quote.amount_zmw; amount_sats := v_quote.amount_sats;
      new_zmw_balance := v_zmw_balance; new_btc_sats := v_crypto_balance;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  SELECT q.* INTO v_quote
  FROM public.btc_quotes q
  WHERE q.id = p_quote_id
  FOR UPDATE;

  IF v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Quote not found';
  END IF;
  IF v_quote.user_id <> p_user_id THEN
    RAISE EXCEPTION 'Quote does not belong to this user';
  END IF;
  IF v_quote.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Quote already used';
  END IF;
  IF v_quote.expires_at <= now() THEN
    RAISE EXCEPTION 'Quote expired';
  END IF;

  -- Lock treasury first (consistent lock order: treasury, ZMW, crypto).
  PERFORM 1 FROM public.btc_treasury WHERE id = 1 FOR UPDATE;

  -- Lock (or create) the ZMW wallet.
  SELECT w.id, w.balance INTO v_zmw_id, v_zmw_balance
  FROM public.wallets w
  WHERE w.user_id = p_user_id AND w.currency = 'ZMW'
  FOR UPDATE;

  IF v_zmw_id IS NULL THEN
    IF v_quote.side = 'buy' THEN
      RAISE EXCEPTION 'No ZMW wallet — fund your wallet first';
    END IF;
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (p_user_id, 'ZMW', 0, 'active')
    RETURNING id, balance INTO v_zmw_id, v_zmw_balance;
  END IF;

  -- Lock (or create) the BTC crypto wallet.
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT c.balance_sats, c.available_sats INTO v_crypto_balance, v_crypto_available
  FROM public.crypto_wallets c
  WHERE c.user_id = p_user_id AND c.asset = 'BTC'
  FOR UPDATE;

  IF v_quote.side = 'buy' THEN
    IF v_zmw_balance < v_quote.amount_zmw THEN
      RAISE EXCEPTION 'Insufficient ZMW balance: have %, need %',
        v_zmw_balance, v_quote.amount_zmw;
    END IF;
    IF (SELECT t.float_sats FROM public.btc_treasury t WHERE t.id = 1) < v_quote.amount_sats THEN
      RAISE EXCEPTION 'Bitcoin temporarily unavailable — insufficient platform inventory';
    END IF;

    UPDATE public.wallets
    SET balance = balance - v_quote.amount_zmw, updated_at = now()
    WHERE id = v_zmw_id;

    UPDATE public.crypto_wallets
    SET balance_sats = balance_sats + v_quote.amount_sats,
        available_sats = available_sats + v_quote.amount_sats,
        updated_at = now()
    WHERE user_id = p_user_id AND asset = 'BTC';

    UPDATE public.btc_treasury
    SET float_sats = float_sats - v_quote.amount_sats, updated_at = now()
    WHERE id = 1;

    new_zmw_balance := v_zmw_balance - v_quote.amount_zmw;
    new_btc_sats := v_crypto_balance + v_quote.amount_sats;
  ELSE
    IF v_crypto_available < v_quote.amount_sats THEN
      RAISE EXCEPTION 'Insufficient BTC balance: have % sats, need %',
        v_crypto_available, v_quote.amount_sats;
    END IF;

    UPDATE public.crypto_wallets
    SET balance_sats = balance_sats - v_quote.amount_sats,
        available_sats = available_sats - v_quote.amount_sats,
        updated_at = now()
    WHERE user_id = p_user_id AND asset = 'BTC';

    UPDATE public.wallets
    SET balance = balance + v_quote.amount_zmw, updated_at = now()
    WHERE id = v_zmw_id;

    UPDATE public.btc_treasury
    SET float_sats = float_sats + v_quote.amount_sats, updated_at = now()
    WHERE id = 1;

    new_zmw_balance := v_zmw_balance + v_quote.amount_zmw;
    new_btc_sats := v_crypto_balance - v_quote.amount_sats;
  END IF;

  -- Ledger legs (positive amounts + direction, as in execute_atomic_transfer).
  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_zmw_id, v_quote.amount_zmw, 'ZMW',
     CASE WHEN v_quote.side = 'buy' THEN 'outgoing' ELSE 'incoming' END,
     'bitcoin_trade', 'completed',
     CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':zmw' END);

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (p_user_id, v_quote.amount_sats::numeric / 100000000, 'BTC',
     CASE WHEN v_quote.side = 'buy' THEN 'incoming' ELSE 'outgoing' END,
     'bitcoin_trade', 'completed',
     CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':btc' END);

  UPDATE public.btc_quotes
  SET consumed_at = now()
  WHERE id = v_quote.id;

  quote_id := v_quote.id; side := v_quote.side;
  amount_zmw := v_quote.amount_zmw; amount_sats := v_quote.amount_sats;
  RETURN NEXT;
END;
$$;

-- ── 6d. Withdrawal reserve / finalize / fail ───────────────────────────────
CREATE OR REPLACE FUNCTION public.btc_reserve_withdrawal(
  p_user_id UUID,
  p_to_address TEXT,
  p_amount_sats BIGINT,
  p_fee_sats BIGINT,
  p_idempotency_key TEXT
)
RETURNS TABLE(withdrawal_id UUID, status TEXT, amount_sats BIGINT, fee_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.btc_withdrawals%ROWTYPE;
  v_total BIGINT := p_amount_sats + p_fee_sats;
  v_id UUID;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_fee_sats IS NULL OR p_fee_sats < 0 THEN
    RAISE EXCEPTION 'Fee must be zero or positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT w.* INTO v_existing
    FROM public.btc_withdrawals w
    WHERE w.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      withdrawal_id := v_existing.id; status := v_existing.status;
      amount_sats := v_existing.amount_sats; fee_sats := v_existing.fee_sats;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- Debit balance + available atomically; raises if insufficient.
  PERFORM public.btc_adjust_crypto_wallet(p_user_id, -v_total, -v_total);

  INSERT INTO public.btc_withdrawals
    (user_id, to_address, amount_sats, fee_sats, status, idempotency_key)
  VALUES
    (p_user_id, p_to_address, p_amount_sats, p_fee_sats, 'reserved', p_idempotency_key)
  RETURNING id INTO v_id;

  withdrawal_id := v_id; status := 'reserved';
  amount_sats := p_amount_sats; fee_sats := p_fee_sats;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.btc_finalize_withdrawal(
  p_withdrawal_id UUID,
  p_txid TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_txid TEXT;
BEGIN
  SELECT w.status, w.txid INTO v_status, v_txid
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_status = 'broadcast' AND v_txid = p_txid THEN
    RETURN 'broadcast';
  END IF;
  IF v_status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot finalize withdrawal in status %', v_status;
  END IF;

  UPDATE public.btc_withdrawals
  SET status = 'broadcast', txid = p_txid, updated_at = now()
  WHERE id = p_withdrawal_id;

  RETURN 'broadcast';
END;
$$;

CREATE OR REPLACE FUNCTION public.btc_fail_withdrawal(
  p_withdrawal_id UUID,
  p_error TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.btc_withdrawals%ROWTYPE;
BEGIN
  SELECT w.* INTO v_row
  FROM public.btc_withdrawals w
  WHERE w.id = p_withdrawal_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_row.status = 'failed' THEN
    RETURN 'failed';
  END IF;
  IF v_row.status <> 'reserved' THEN
    RAISE EXCEPTION 'Cannot fail withdrawal in status % — funds may already be broadcast', v_row.status;
  END IF;

  -- Refund the reservation in full (amount + fee never left the wallet).
  PERFORM public.btc_adjust_crypto_wallet(
    v_row.user_id, v_row.amount_sats + v_row.fee_sats, v_row.amount_sats + v_row.fee_sats);

  UPDATE public.btc_withdrawals
  SET status = 'failed', error = p_error, updated_at = now()
  WHERE id = p_withdrawal_id;

  RETURN 'failed';
END;
$$;

-- ── 6e. Lock the RPCs down to the service role ─────────────────────────────
REVOKE ALL ON FUNCTION public.btc_adjust_crypto_wallet(UUID, BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_record_deposit(UUID, TEXT, TEXT, INTEGER, BIGINT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_execute_trade(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_finalize_withdrawal(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_fail_withdrawal(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.btc_adjust_crypto_wallet(UUID, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_record_deposit(UUID, TEXT, TEXT, INTEGER, BIGINT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_execute_trade(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_finalize_withdrawal(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_fail_withdrawal(UUID, TEXT) TO service_role;

-- ── 6f. Derivation index allocation (atomic via sequences) ────────────────
CREATE OR REPLACE FUNCTION public.btc_next_derivation_index()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT nextval('public.btc_derivation_index_seq'); $$;

CREATE OR REPLACE FUNCTION public.btc_next_change_index()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT nextval('public.btc_change_index_seq'); $$;

REVOKE ALL ON FUNCTION public.btc_next_derivation_index() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_next_change_index() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.btc_next_derivation_index() TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_next_change_index() TO service_role;

-- ── 7. crypto_wallets RLS hardening ────────────────────────────────────────
-- Before this migration the 2025-08-12 policies let any signed-in user
-- INSERT a wallet row with an arbitrary balance and UPDATE their own
-- balance_sats directly through PostgREST. Balances are money: reads stay
-- open to the owner; every write now goes through service-role code.
DROP POLICY IF EXISTS "Users can insert their own crypto wallets" ON public.crypto_wallets;
DROP POLICY IF EXISTS "Users can update their own crypto wallets" ON public.crypto_wallets;
