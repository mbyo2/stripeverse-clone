-- ============================================================================
-- Pay a payment link with Bitcoin from ANY external wallet
-- (CEO order 2026-10-26): "Pay with Bitcoin" on the public pay page.
--
-- A guest with no BMaGlass account opens /pay/:code, chooses Bitcoin,
-- and gets a per-attempt on-chain address (fresh BIP84 derivation from
-- the platform account zpub — never a shared address, never reused)
-- and/or a Lightning invoice for the quoted sats. They pay from
-- whatever wallet they already use. Detection (the existing
-- btc-check-deposits cron → btc-onchain check_deposits, extended by
-- this feature) and the Coinos invoice status path match incoming
-- sats to the attempt; at full coverage the link settles through the
-- SAME exactly-once machinery as wallet payments
-- (payment_link.paid, anchored on the owner-side ledger row).
--
-- Quote/fee math (pure, unit-tested in _shared/link-btc.ts):
--   - The attempt LOCKS its rate at creation (fiat per BTC, from the
--     platform price index). Value is computed at the locked rate.
--   - amount_sats = ceil(fiat / rate × 1e8) — always covers the price.
--   - fee = platform_settings.split_platform_fee_percent of the FIAT
--     amount (rounded as the fiat settlement rounds it), in sats at
--     the locked rate. fee_payer is snapshotted onto the attempt at
--     creation (link's fee_payer when present — the fee-bearer
--     feature — else the platform default 'seller'):
--       seller → payer sends amount_sats; fee leaves the proceeds.
--       buyer  → payer sends amount_sats + fee_sats; merchant nets
--                the full amount's sats.
--     Settlement split is identical either way:
--       merchant += received − fee_sats; platform += fee_sats.
--     Overpayment excess is the merchant's, never fee'd.
--
-- Escrow model: attempt deposits are RECORDED (btc_deposits rows with
-- attempt_id) and accumulate on the attempt — they do NOT touch the
-- merchant's spendable BTC balance until settlement, so a partial
-- payment is never spendable as if the link were paid. If the window
-- closes part-paid, the partial is credited to the merchant in full
-- (no fee — no completed payment) as a clearly-labelled partial.
--
-- Split rules (fiat settlement feature) do not apply to BTC
-- settlements in this version: proceeds land in the merchant's
-- custodial BTC wallet (crypto_wallets), which is per-user, not
-- per-settlement-account.
-- ============================================================================

-- ── 1. Attempts ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_link_btc_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id UUID NOT NULL REFERENCES public.payment_links(id) ON DELETE CASCADE,
  merchant_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Fiat leg (locked at creation).
  fiat_amount NUMERIC NOT NULL CHECK (fiat_amount > 0),
  fiat_currency TEXT NOT NULL,
  fee_payer TEXT NOT NULL DEFAULT 'seller' CHECK (fee_payer IN ('seller', 'buyer')),
  fee_percent NUMERIC NOT NULL DEFAULT 2.5 CHECK (fee_percent >= 0),
  fee_fiat NUMERIC NOT NULL DEFAULT 0,
  -- Locked rate: fiat (major units) per 1 BTC at creation.
  rate_fiat_per_btc NUMERIC(24, 8) NOT NULL CHECK (rate_fiat_per_btc > 0),
  -- Sats leg (whole sats, computed by _shared/link-btc.ts at creation).
  amount_sats BIGINT NOT NULL CHECK (amount_sats > 0),
  fee_sats BIGINT NOT NULL DEFAULT 0 CHECK (fee_sats >= 0),
  required_sats BIGINT NOT NULL CHECK (required_sats > 0),
  seen_sats BIGINT NOT NULL DEFAULT 0 CHECK (seen_sats >= 0),
  received_sats BIGINT NOT NULL DEFAULT 0 CHECK (received_sats >= 0),
  -- On-chain leg.
  onchain_address TEXT UNIQUE,
  derivation_index BIGINT UNIQUE,
  -- Lightning leg (Coinos via _shared/lightning-provider.ts). The
  -- invoice is fixed-amount, so a paid invoice contributes exactly
  -- required_sats; tracked apart from the on-chain sum so a payer
  -- who somehow pays BOTH legs is settled for the true total
  -- (received_sats = credited chain deposits + lightning_received_sats)
  -- and the excess rides to the merchant as overpayment.
  lightning_invoice TEXT,
  lightning_provider_id TEXT,
  lightning_payment_hash TEXT,
  lightning_received_sats BIGINT NOT NULL DEFAULT 0 CHECK (lightning_received_sats >= 0),
  -- Lifecycle.
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'partial', 'settled', 'expired', 'partial_credited', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  owner_transaction_id UUID,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pl_btc_attempts_link
  ON public.payment_link_btc_attempts(link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_btc_attempts_merchant
  ON public.payment_link_btc_attempts(merchant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pl_btc_attempts_open
  ON public.payment_link_btc_attempts(status) WHERE status IN ('waiting', 'partial', 'expired');

ALTER TABLE public.payment_link_btc_attempts ENABLE ROW LEVEL SECURITY;
-- No client policies: the public page and the merchant surfaces reach
-- attempts only through service-role edge functions (the checkout
-- function for payers, the developer API for merchants). Same posture
-- as payment_link_paid_dispatches.

-- ── 2. Attempt address assignments ─────────────────────────────────────────
-- Attempt-scoped siblings of btc_address_assignments (whose user_id is
-- UNIQUE — one address per user — so attempts cannot live there).
-- Indices come from the same btc_derivation_index_seq, so an attempt
-- address can never collide with a user deposit address.
CREATE TABLE IF NOT EXISTS public.btc_link_attempt_addresses (
  attempt_id UUID PRIMARY KEY REFERENCES public.payment_link_btc_attempts(id) ON DELETE CASCADE,
  derivation_index BIGINT NOT NULL UNIQUE,
  address TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.btc_link_attempt_addresses ENABLE ROW LEVEL SECURITY;
-- No client policies: service role only (derivation + detection).

-- ── 3. Link deposits to attempts ───────────────────────────────────────────
ALTER TABLE public.btc_deposits
  ADD COLUMN IF NOT EXISTS attempt_id UUID
  REFERENCES public.payment_link_btc_attempts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_btc_deposits_attempt
  ON public.btc_deposits(attempt_id) WHERE attempt_id IS NOT NULL;

-- ── 4. Record an on-chain deposit toward an attempt (escrow) ──────────────
-- Mirrors btc_record_deposit's exactly-once discipline — the
-- (txid, vout) UNIQUE on btc_deposits is the replay guard, a re-scan
-- can never count an output twice — but the sats accumulate on the
-- ATTEMPT, not in the merchant's spendable balance. 'credited' on the
-- deposit row here means "counted toward the attempt".
CREATE OR REPLACE FUNCTION public.btc_record_link_attempt_deposit(
  p_attempt_id UUID,
  p_address TEXT,
  p_txid TEXT,
  p_vout INTEGER,
  p_amount_sats BIGINT,
  p_confirmations INTEGER,
  p_required_confs INTEGER DEFAULT 2
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_link_btc_attempts;
  v_status TEXT;
  v_amount BIGINT;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Deposit amount must be positive';
  END IF;

  SELECT * INTO v_attempt FROM public.payment_link_btc_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;
  IF v_attempt.onchain_address IS DISTINCT FROM p_address THEN
    RAISE EXCEPTION 'Address does not belong to this payment attempt';
  END IF;

  INSERT INTO public.btc_deposits
    (user_id, address, txid, vout, amount_sats, confirmations, status, attempt_id)
  VALUES
    (v_attempt.merchant_user_id, p_address, p_txid, p_vout, p_amount_sats,
     p_confirmations, 'detected', p_attempt_id)
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

  -- The payer-facing "seen" figure tracks every output the scanner
  -- has observed for this attempt, confirmed or not.
  UPDATE public.payment_link_btc_attempts a
  SET seen_sats = (
        SELECT COALESCE(SUM(d.amount_sats), 0) FROM public.btc_deposits d
        WHERE d.attempt_id = a.id
      ),
      updated_at = now()
  WHERE a.id = p_attempt_id;

  IF v_status = 'credited' THEN
    RETURN 'already_credited';
  END IF;

  IF p_confirmations < p_required_confs THEN
    RETURN 'detected';
  END IF;

  UPDATE public.btc_deposits
  SET status = 'credited', credited_at = now(), updated_at = now()
  WHERE txid = p_txid AND vout = p_vout;

  -- received_sats is the attempt total across legs: credited
  -- on-chain deposits plus any Lightning receipt already recorded.
  UPDATE public.payment_link_btc_attempts
  SET received_sats =
        (SELECT COALESCE(SUM(d.amount_sats), 0) FROM public.btc_deposits d
         WHERE d.attempt_id = p_attempt_id AND d.status = 'credited')
        + lightning_received_sats,
      status = CASE
        WHEN status IN ('waiting', 'expired') THEN 'partial'
        ELSE status END,
      updated_at = now()
  WHERE id = p_attempt_id;

  RETURN 'credited';
END;
$$;

-- ── 5. Settle a fully-covered attempt ──────────────────────────────────────
-- One transaction: merchant BTC credit (received − fee), platform BTC
-- fee, ledger rows (the merchant incoming row's uuid_id anchors the
-- payment_link.paid dispatch, exactly like the fiat settlement's
-- owner row), link counters at the locked fiat amount. Idempotent:
-- a settled attempt returns its recorded outcome and moves nothing.
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

  IF v_attempt.status = 'settled' THEN
    owner_transaction_id := v_attempt.owner_transaction_id;
    merchant_credit_sats := v_attempt.received_sats
      - LEAST(v_attempt.fee_sats, v_attempt.received_sats);
    platform_fee_sats := LEAST(v_attempt.fee_sats, v_attempt.received_sats);
    already_settled := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_attempt.status IN ('partial_credited', 'failed') THEN
    RAISE EXCEPTION 'Payment attempt can no longer settle';
  END IF;
  IF v_attempt.received_sats < v_attempt.required_sats THEN
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
  v_fee := LEAST(v_attempt.fee_sats, v_attempt.received_sats);
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

-- ── 6. Close out an expired, part-paid attempt ─────────────────────────────
-- The window closed with 0 < received < required: the partial is the
-- merchant's money (it arrived on-chain and cannot be un-sent), so it
-- is credited IN FULL, with NO platform fee — no payment completed —
-- under a clearly-labelled ledger row. Idempotent by the status guard.
CREATE OR REPLACE FUNCTION public.finalize_payment_link_btc_partial(
  p_attempt_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_link_btc_attempts;
  v_link public.payment_links;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_link_btc_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;
  IF v_attempt.status = 'partial_credited' THEN
    RETURN 'already_finalized';
  END IF;
  IF v_attempt.status = 'settled' THEN
    RETURN 'already_settled';
  END IF;
  IF v_attempt.received_sats <= 0 THEN
    -- Nothing arrived: a plain expiry, no money to move.
    IF v_attempt.status <> 'expired' AND v_attempt.expires_at <= now() THEN
      UPDATE public.payment_link_btc_attempts
      SET status = 'expired', updated_at = now()
      WHERE id = v_attempt.id;
      RETURN 'expired';
    END IF;
    RETURN 'nothing_received';
  END IF;
  IF v_attempt.received_sats >= v_attempt.required_sats THEN
    RETURN 'fully_paid';
  END IF;
  IF v_attempt.expires_at > now() THEN
    RETURN 'still_open';
  END IF;

  SELECT * INTO v_link FROM public.payment_links WHERE id = v_attempt.link_id;

  PERFORM public.btc_adjust_crypto_wallet(
    v_attempt.merchant_user_id, v_attempt.received_sats, v_attempt.received_sats);

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key, metadata)
  VALUES
    (v_attempt.merchant_user_id,
     (v_attempt.received_sats::numeric / 100000000), 'BTC', 'incoming',
     'bitcoin_onchain', 'completed',
     'Partial Bitcoin payment — payment link: ' || COALESCE(v_link.title, ''),
     'link:' || v_attempt.link_id::text, 'payment_link_partial',
     'link-btc:' || v_attempt.id::text || ':partial',
     jsonb_build_object(
       'attempt_id', v_attempt.id,
       'received_sats', v_attempt.received_sats,
       'required_sats', v_attempt.required_sats));

  UPDATE public.payment_link_btc_attempts
  SET status = 'partial_credited', updated_at = now()
  WHERE id = v_attempt.id;

  RETURN 'partial_credited';
END;
$$;

-- ── 7. Record a Lightning receipt toward an attempt ────────────────────────
-- The Coinos invoice for an attempt is fixed-amount: paid means the
-- full required sats arrived. This records that receipt (guarded so
-- a re-poll can never double-count) and the caller settles through
-- execute_payment_link_btc_settlement as usual.
CREATE OR REPLACE FUNCTION public.btc_record_link_attempt_lightning(
  p_attempt_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt public.payment_link_btc_attempts;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_link_btc_attempts
  WHERE id = p_attempt_id FOR UPDATE;
  IF v_attempt.id IS NULL THEN
    RAISE EXCEPTION 'Payment attempt not found';
  END IF;
  IF v_attempt.status = 'settled' THEN
    RETURN 'already_settled';
  END IF;
  IF v_attempt.lightning_received_sats > 0 THEN
    RETURN 'already_recorded';
  END IF;
  -- The fixed-amount invoice contributes exactly required_sats,
  -- added to whatever the on-chain leg already credited — a payer
  -- who pays both legs settles for the true total, the excess
  -- riding to the merchant as overpayment at settlement.
  UPDATE public.payment_link_btc_attempts
  SET lightning_received_sats = required_sats,
      received_sats = received_sats + required_sats,
      seen_sats = GREATEST(seen_sats, received_sats + required_sats),
      status = CASE WHEN status = 'waiting' THEN 'partial' ELSE status END,
      updated_at = now()
  WHERE id = p_attempt_id;
  RETURN 'recorded';
END;
$$;

-- ── 8. Grants: service role only, like every other money RPC ───────────────
REVOKE ALL ON FUNCTION public.btc_record_link_attempt_deposit(UUID, TEXT, TEXT, INTEGER, BIGINT, INTEGER, INTEGER) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.execute_payment_link_btc_settlement(UUID, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.finalize_payment_link_btc_partial(UUID) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.btc_record_link_attempt_lightning(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.btc_record_link_attempt_deposit(UUID, TEXT, TEXT, INTEGER, BIGINT, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_payment_link_btc_settlement(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_payment_link_btc_partial(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.btc_record_link_attempt_lightning(UUID) TO service_role;
