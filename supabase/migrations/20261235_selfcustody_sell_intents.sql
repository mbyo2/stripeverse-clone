-- ============================================================================
-- Self-custody sell-to-ZMW: sell intents + exactly-once settlement.
--
-- A self-custody (Spark) user sells BTC that lives OUTSIDE the platform.
-- The intent locks a quote (mid rate snapshot, fee_bps = 150 = 1.5%,
-- expected sats, ZMW due, expiry). The user sends BTC from their
-- self-custody wallet to the platform:
--   * on-chain rail  — to their OWN custodial deposit address
--     (btc_address_assignments), detected/credited by the EXISTING
--     btc-onchain check_deposits scan via btc_record_deposit;
--   * Lightning rail — paying a platform invoice created through the
--     EXISTING lightning-service create_invoice, settled by the
--     EXISTING btc_settle_lightning_deposit.
-- Both deposit paths credit the user's custodial BTC wallet exactly
-- once, unchanged. THIS migration adds the conversion step:
-- btc_settle_selfcustody_sell binds ONE credited deposit to ONE
-- intent and converts it to ZMW in a single transaction (debit the
-- custodial BTC credit, credit the Main ZMW wallet, treasury float
-- += actual sats — the same ledger shape as a custodial sell in
-- btc_execute_trade). The btc-onchain scan and the lightning
-- check_status poll attempt this conversion immediately after their
-- own settlement succeeds; the btc-sell-selfcustody function's
-- `check` action retries it, so a missed attempt never strands a
-- sale (the BTC simply stays as a normal custodial credit until the
-- conversion runs or the intent expires).
--
-- POLICY (documented in _shared/selfcustody-sell.ts, mirrored here):
--   * Expiry/grace: a deposit CREDITED at or before
--     expires_at + grace_seconds settles at the LOCKED rate, even if
--     conversion runs later. Credited after that deadline: the
--     intent expires, the BTC stays a normal custodial credit.
--   * Under/over-payment: settlement is on the ACTUAL sats received
--     at the locked rate minus the 1.5% fee — never the expected
--     amount, never more than arrived.
--   * Exactly-once: the intent row lock + the unique partial indexes
--     below make a deposit settle at most one intent and an intent
--     settle at most once; replays return the stored result.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.btc_selfcustody_sell_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rail TEXT NOT NULL CHECK (rail IN ('onchain', 'lightning')),
  status TEXT NOT NULL DEFAULT 'awaiting'
    CHECK (status IN ('awaiting', 'settled', 'expired', 'cancelled')),
  -- Locked quote snapshot (never updated after insert).
  mid_rate_zmw NUMERIC(20, 2) NOT NULL,
  fee_bps INTEGER NOT NULL DEFAULT 150,
  expected_sats BIGINT NOT NULL CHECK (expected_sats > 0),
  expected_zmw NUMERIC(20, 2) NOT NULL,
  expected_fee_zmw NUMERIC(20, 2) NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  grace_seconds INTEGER NOT NULL DEFAULT 3600,
  -- Destination snapshot.
  deposit_address TEXT,
  lightning_payment_id UUID REFERENCES public.lightning_payments(id) ON DELETE SET NULL,
  bolt11 TEXT,
  -- Settlement binding (written once, by the settle RPC).
  deposit_txid TEXT,
  deposit_vout INTEGER,
  actual_sats BIGINT,
  zmw_credited NUMERIC(20, 2),
  fee_zmw_actual NUMERIC(20, 2),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sc_sell_intents_user
  ON public.btc_selfcustody_sell_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sc_sell_intents_awaiting
  ON public.btc_selfcustody_sell_intents(status, created_at)
  WHERE status = 'awaiting';

-- Exactly-once binding: one settled intent per on-chain deposit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_sell_intents_onchain_deposit
  ON public.btc_selfcustody_sell_intents(deposit_txid, deposit_vout)
  WHERE deposit_txid IS NOT NULL AND status = 'settled';

-- One live-or-settled intent per Lightning invoice (bound at creation).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sc_sell_intents_lightning_payment
  ON public.btc_selfcustody_sell_intents(lightning_payment_id)
  WHERE lightning_payment_id IS NOT NULL AND status IN ('awaiting', 'settled');

ALTER TABLE public.btc_selfcustody_sell_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own sell intents" ON public.btc_selfcustody_sell_intents;
CREATE POLICY "Users view own sell intents"
ON public.btc_selfcustody_sell_intents FOR SELECT TO authenticated
USING (auth.uid() = user_id);
-- No client write policies: intents are created and settled only by
-- service-role edge functions / the RPC below.

-- ── Exactly-once settlement ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.btc_settle_selfcustody_sell(
  p_intent_id UUID,
  p_deposit_kind TEXT,
  p_txid TEXT DEFAULT NULL,
  p_vout INTEGER DEFAULT NULL,
  p_lightning_payment_id UUID DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, intent_status TEXT, actual_sats BIGINT,
              zmw_credited NUMERIC, fee_zmw NUMERIC, new_zmw_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent public.btc_selfcustody_sell_intents%ROWTYPE;
  v_actual_sats BIGINT;
  v_credited_at TIMESTAMPTZ;
  v_gross NUMERIC;
  v_net NUMERIC;
  v_fee NUMERIC;
  v_zmw_id UUID;
  v_zmw_balance NUMERIC;
  v_crypto_available BIGINT;
BEGIN
  IF p_intent_id IS NULL THEN
    RAISE EXCEPTION 'An intent id is required';
  END IF;
  IF p_deposit_kind NOT IN ('onchain', 'lightning') THEN
    RAISE EXCEPTION 'deposit_kind must be onchain or lightning';
  END IF;

  SELECT i.* INTO v_intent
  FROM public.btc_selfcustody_sell_intents i
  WHERE i.id = p_intent_id
  FOR UPDATE;

  IF v_intent.id IS NULL THEN
    outcome := 'not_found'; intent_status := NULL;
    actual_sats := NULL; zmw_credited := NULL; fee_zmw := NULL; new_zmw_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;

  intent_status := v_intent.status;
  actual_sats := v_intent.actual_sats;
  zmw_credited := v_intent.zmw_credited;
  fee_zmw := v_intent.fee_zmw_actual;
  SELECT w.balance INTO new_zmw_balance FROM public.wallets w
  WHERE w.user_id = v_intent.user_id AND w.currency = 'ZMW' AND w.account_id IS NULL;

  -- Replay: a settled intent reports its stored result and moves nothing.
  IF v_intent.status = 'settled' THEN
    outcome := 'already_settled'; RETURN NEXT; RETURN;
  END IF;
  IF v_intent.status <> 'awaiting' THEN
    outcome := 'not_awaiting'; RETURN NEXT; RETURN;
  END IF;

  -- Resolve the deposit from its own ledger row — never caller figures.
  IF p_deposit_kind = 'onchain' THEN
    IF p_txid IS NULL OR p_vout IS NULL THEN
      RAISE EXCEPTION 'txid and vout are required for an on-chain deposit';
    END IF;
    IF v_intent.rail <> 'onchain' THEN
      outcome := 'rail_mismatch'; RETURN NEXT; RETURN;
    END IF;
    SELECT d.amount_sats, d.credited_at INTO v_actual_sats, v_credited_at
    FROM public.btc_deposits d
    WHERE d.txid = p_txid AND d.vout = p_vout
      AND d.user_id = v_intent.user_id AND d.status = 'credited';
    IF v_actual_sats IS NULL THEN
      outcome := 'deposit_not_credited'; RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.btc_selfcustody_sell_intents o
      WHERE o.status = 'settled' AND o.deposit_txid = p_txid AND o.deposit_vout = p_vout
    ) THEN
      outcome := 'deposit_already_bound'; RETURN NEXT; RETURN;
    END IF;
  ELSE
    IF p_lightning_payment_id IS NULL THEN
      RAISE EXCEPTION 'A lightning payment id is required for a Lightning deposit';
    END IF;
    IF v_intent.rail <> 'lightning'
       OR v_intent.lightning_payment_id IS DISTINCT FROM p_lightning_payment_id THEN
      outcome := 'rail_mismatch'; RETURN NEXT; RETURN;
    END IF;
    SELECT lp.amount_sats, lp.settled_at INTO v_actual_sats, v_credited_at
    FROM public.lightning_payments lp
    WHERE lp.id = p_lightning_payment_id
      AND lp.user_id = v_intent.user_id
      AND lp.direction = 'inbound' AND lp.status = 'paid';
    IF v_actual_sats IS NULL THEN
      outcome := 'deposit_not_credited'; RETURN NEXT; RETURN;
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.btc_selfcustody_sell_intents o
      WHERE o.status = 'settled' AND o.lightning_payment_id = p_lightning_payment_id
        AND o.id <> v_intent.id
    ) THEN
      outcome := 'deposit_already_bound'; RETURN NEXT; RETURN;
    END IF;
  END IF;

  -- Grace rule: credited after expires_at + grace — the intent
  -- expires and the BTC stays an ordinary custodial credit.
  IF v_credited_at > v_intent.expires_at + make_interval(secs => v_intent.grace_seconds) THEN
    UPDATE public.btc_selfcustody_sell_intents
    SET status = 'expired', updated_at = now()
    WHERE id = v_intent.id;
    outcome := 'expired_after_grace'; intent_status := 'expired';
    RETURN NEXT; RETURN;
  END IF;

  -- Quote math on the ACTUAL received sats (mirrors sellQuoteMath in
  -- _shared/selfcustody-sell.ts / quoteSellZmw in btc-core.ts):
  -- net = floor-to-ngwee(gross * (1 - fee_bps/10000)).
  v_gross := v_actual_sats::numeric * v_intent.mid_rate_zmw / 100000000;
  v_net := FLOOR(v_gross * (1 - v_intent.fee_bps::numeric / 10000) * 100) / 100;
  v_fee := ROUND((v_gross - v_net) * 100) / 100;
  IF v_net <= 0 THEN
    RAISE EXCEPTION 'Settled amount too small';
  END IF;

  -- Lock order matches btc_execute_trade: treasury, ZMW, crypto.
  PERFORM 1 FROM public.btc_treasury WHERE id = 1 FOR UPDATE;

  SELECT w.id, w.balance INTO v_zmw_id, v_zmw_balance
  FROM public.wallets w
  WHERE w.user_id = v_intent.user_id AND w.currency = 'ZMW' AND w.account_id IS NULL
  FOR UPDATE;
  IF v_zmw_id IS NULL THEN
    INSERT INTO public.wallets (user_id, currency, balance, status)
    VALUES (v_intent.user_id, 'ZMW', 0, 'active')
    RETURNING id, balance INTO v_zmw_id, v_zmw_balance;
  END IF;

  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (v_intent.user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT c.available_sats INTO v_crypto_available
  FROM public.crypto_wallets c
  WHERE c.user_id = v_intent.user_id AND c.asset = 'BTC'
  FOR UPDATE;

  -- The deposit credit is the thing being converted: if it is no
  -- longer there (already spent), refuse and roll back — the intent
  -- stays awaiting and the caller can retry or let it expire.
  IF COALESCE(v_crypto_available, 0) < v_actual_sats THEN
    RAISE EXCEPTION 'Insufficient BTC balance to settle sell intent';
  END IF;

  UPDATE public.crypto_wallets
  SET balance_sats = balance_sats - v_actual_sats,
      available_sats = available_sats - v_actual_sats,
      updated_at = now()
  WHERE user_id = v_intent.user_id AND asset = 'BTC';

  UPDATE public.wallets
  SET balance = balance + v_net, updated_at = now()
  WHERE id = v_zmw_id;

  UPDATE public.btc_treasury
  SET float_sats = float_sats + v_actual_sats, updated_at = now()
  WHERE id = 1;

  INSERT INTO public.transactions
    (user_id, wallet_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (v_intent.user_id, v_zmw_id, v_net, 'ZMW', 'incoming',
     'bitcoin_trade', 'completed',
     'Sell Bitcoin (self-custody)', v_intent.id::text, 'btc_trade',
     concat('sc-sell:', v_intent.id::text, ':zmw'));

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key)
  VALUES
    (v_intent.user_id, v_actual_sats::numeric / 100000000, 'BTC', 'outgoing',
     'bitcoin_trade', 'completed',
     'Sell Bitcoin (self-custody)', v_intent.id::text, 'btc_trade',
     concat('sc-sell:', v_intent.id::text, ':btc'));

  UPDATE public.btc_selfcustody_sell_intents
  SET status = 'settled',
      deposit_txid = CASE WHEN p_deposit_kind = 'onchain' THEN p_txid ELSE deposit_txid END,
      deposit_vout = CASE WHEN p_deposit_kind = 'onchain' THEN p_vout ELSE deposit_vout END,
      actual_sats = v_actual_sats,
      zmw_credited = v_net,
      fee_zmw_actual = v_fee,
      settled_at = now(),
      updated_at = now()
  WHERE id = v_intent.id;

  outcome := 'settled'; intent_status := 'settled';
  actual_sats := v_actual_sats; zmw_credited := v_net; fee_zmw := v_fee;
  new_zmw_balance := v_zmw_balance + v_net;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.btc_settle_selfcustody_sell(UUID, TEXT, TEXT, INTEGER, UUID) TO service_role;
