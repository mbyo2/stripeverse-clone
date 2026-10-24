-- ============================================================================
-- Bitcoin POS — data bridge (merchant data layer, NOT a checkout).
--
-- What this is: a merchant creates a BTC payment request at their till
-- (their own order/reference number + a ZMW amount). The customer pays
-- on-chain to the merchant's BMaGlass deposit address. When the payment
-- is detected and credited, the request is marked paid / underpaid /
-- overpaid. The merchant's EXISTING POS or accounting system pulls the
-- records back out — JSON via the `pos` edge function with a POS API
-- key, or CSV export — for reconciliation and books.
--
-- Design decisions (see docs/bitcoin-pos-data-bridge.md):
--   * ADDRESSES ARE PER-USER, NOT PER-REQUEST. The live custody design
--     (20261020_bitcoin_completion.sql) assigns exactly ONE BIP84
--     deposit address per user (btc_address_assignments.user_id is
--     UNIQUE), issued by btc-onchain's `receive` action from BTC_XPUB.
--     A POS request therefore records the merchant's existing address,
--     and deposit matching is by (user_id, address) — never a fresh
--     derivation per request (that would rewrite the custody model).
--   * MATCHING HOOK = a trigger on btc_deposits. btc_record_deposit
--     (called by btc-onchain check_deposits) credits at 1 confirmation
--     and flips status 'detected' -> 'credited'. The trigger fires on
--     exactly that transition and calls pos_apply_deposit_match inside
--     an exception handler: a POS failure can NEVER break or delay
--     deposit crediting. Deposits with no open POS request behave
--     exactly as they did before this migration existed.
--   * MATCH RULES (deterministic, see pos_apply_deposit_match):
--     candidates = the merchant's requests on that address still in
--     'awaiting_payment'; an exact-amount candidate wins, otherwise
--     the OLDEST open request (FIFO). One deposit matches at most one
--     request; one request is settled by at most one deposit in v1 —
--     an underpaid request does not absorb a second deposit (the
--     merchant creates a new request for the remainder). This keeps
--     every match explainable from the two tables alone.
--   * RATE: sats_expected is computed by the `pos` edge function from
--     the latest non-stale p2p_price_snapshots BTC index (Coinbase /
--     Kraken cross-checked BTC/USD x exchange_rates USD/ZMW — the
--     same index P2P order creation uses) at the raw index, no trade
--     spread, floored. The rate used is locked onto the request row
--     (btc_zmw_rate + rate_source) and copied to
--     btc_zmw_rate_at_payment when the payment lands.
--   * API KEYS: plain key ("bmp_pos_" + 64 hex) is shown exactly once
--     by the edge function at creation and NEVER stored. Only its
--     SHA-256 hex (pos_hash_api_key / WebCrypto — same digest) and a
--     16-char display prefix are stored. pos_api_keys has NO client
--     policies at all: key material never transits PostgREST; the
--     merchant UI reaches it only through the `pos` edge function.
--   * NO WEBHOOKS IN V1 (phase 2, see the design note): the merchant
--     system polls the JSON API or pulls a CSV export.
-- ============================================================================

-- ── 1. platform_settings: POS switches ───────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pos_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS pos_default_expiry_minutes integer NOT NULL DEFAULT 120;

-- ── 2. pos_payment_requests ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant_reference TEXT NOT NULL,
  fiat_amount_zmw NUMERIC(14, 2) NOT NULL CHECK (fiat_amount_zmw > 0),
  sats_expected BIGINT NOT NULL CHECK (sats_expected > 0),
  -- ZMW per 1 BTC, locked at creation; the rate the expected sats
  -- were computed from (and therefore the rate the sale was priced at).
  btc_zmw_rate NUMERIC(20, 2) NOT NULL CHECK (btc_zmw_rate > 0),
  rate_source TEXT NOT NULL,
  deposit_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'paid', 'underpaid',
                      'overpaid', 'expired', 'cancelled')),
  deposit_id UUID REFERENCES public.btc_deposits(id),
  txid TEXT,
  sats_received BIGINT,
  confirmations_at_detection INTEGER,
  btc_zmw_rate_at_payment NUMERIC(20, 2),
  paid_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The merchant reference is the reconciliation key: unique per
  -- merchant across ALL requests, like an invoice number.
  UNIQUE (user_id, merchant_reference)
);

CREATE INDEX IF NOT EXISTS idx_pos_requests_user_created
  ON public.pos_payment_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pos_requests_match
  ON public.pos_payment_requests (user_id, deposit_address, created_at)
  WHERE status = 'awaiting_payment';
-- A deposit settles at most one request (belt and braces beside the
-- match function's own guard).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pos_requests_deposit
  ON public.pos_payment_requests (deposit_id)
  WHERE deposit_id IS NOT NULL;

ALTER TABLE public.pos_payment_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Merchants view own pos requests" ON public.pos_payment_requests;
CREATE POLICY "Merchants view own pos requests"
  ON public.pos_payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
-- No client INSERT/UPDATE/DELETE policies: every write flows through
-- the service-role RPCs below (or the deposit-match trigger).

REVOKE ALL ON TABLE public.pos_payment_requests FROM anon, authenticated;
GRANT SELECT ON TABLE public.pos_payment_requests TO authenticated;

-- ── 3. pos_api_keys ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pos_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'POS key',
  last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_api_keys_user
  ON public.pos_api_keys (user_id, created_at DESC);

ALTER TABLE public.pos_api_keys ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies: hashes never leave through PostgREST.
-- The merchant UI manages keys only via the `pos` edge function.

REVOKE ALL ON TABLE public.pos_api_keys FROM anon, authenticated;

-- ── 4. Key hashing (DB side of the shared digest) ────────────────────
-- SHA-256 hex of the plain key — the same digest the edge function
-- computes with WebCrypto and the same value stored in key_hash.
CREATE OR REPLACE FUNCTION public.pos_hash_api_key(p_plain TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT encode(extensions.digest(p_plain, 'sha256'), 'hex'); $$;

-- ── 5. Create a payment request ──────────────────────────────────────
-- All inputs are computed/validated by the `pos` edge function (rate
-- lookup, sats conversion, address issuance via btc-onchain receive);
-- this RPC re-checks the invariants that protect the books and owns
-- the insert so every write path shares them.
CREATE OR REPLACE FUNCTION public.pos_create_request(
  p_user_id UUID,
  p_merchant_reference TEXT,
  p_fiat_amount_zmw NUMERIC,
  p_sats_expected BIGINT,
  p_btc_zmw_rate NUMERIC,
  p_rate_source TEXT,
  p_deposit_address TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS public.pos_payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pos_payment_requests;
BEGIN
  IF p_merchant_reference IS NULL OR length(btrim(p_merchant_reference)) < 1
     OR length(p_merchant_reference) > 64 THEN
    RAISE EXCEPTION 'A reference of 1 to 64 characters is required';
  END IF;
  IF p_fiat_amount_zmw IS NULL OR p_fiat_amount_zmw <= 0 THEN
    RAISE EXCEPTION 'The amount must be more than zero';
  END IF;
  IF p_sats_expected IS NULL OR p_sats_expected <= 0 THEN
    RAISE EXCEPTION 'The Bitcoin amount must be more than zero';
  END IF;
  IF p_btc_zmw_rate IS NULL OR p_btc_zmw_rate <= 0 THEN
    RAISE EXCEPTION 'A valid Bitcoin price is required';
  END IF;
  IF p_deposit_address IS NULL OR length(p_deposit_address) < 10 THEN
    RAISE EXCEPTION 'A deposit address is required';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'The expiry must be in the future';
  END IF;

  INSERT INTO public.pos_payment_requests
    (user_id, merchant_reference, fiat_amount_zmw, sats_expected,
     btc_zmw_rate, rate_source, deposit_address, expires_at)
  VALUES
    (p_user_id, btrim(p_merchant_reference), p_fiat_amount_zmw,
     p_sats_expected, p_btc_zmw_rate, p_rate_source, p_deposit_address,
     p_expires_at)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── 6. Cancel a request (merchant, awaiting payment only) ────────────
CREATE OR REPLACE FUNCTION public.pos_cancel_request(
  p_user_id UUID,
  p_request_id UUID
)
RETURNS public.pos_payment_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pos_payment_requests;
BEGIN
  SELECT * INTO v_row
  FROM public.pos_payment_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF v_row.id IS NULL OR v_row.user_id <> p_user_id THEN
    RAISE EXCEPTION 'That payment request could not be found';
  END IF;
  IF v_row.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Only a request still awaiting payment can be cancelled';
  END IF;

  UPDATE public.pos_payment_requests
  SET status = 'cancelled', cancelled_at = now(), updated_at = now()
  WHERE id = p_request_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ── 7. API key lifecycle ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pos_create_api_key(
  p_user_id UUID,
  p_label TEXT,
  p_key_hash TEXT,
  p_key_prefix TEXT
)
RETURNS public.pos_api_keys
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.pos_api_keys;
BEGIN
  IF p_key_hash IS NULL OR length(p_key_hash) <> 64 THEN
    RAISE EXCEPTION 'A valid key hash is required';
  END IF;

  INSERT INTO public.pos_api_keys (user_id, label, key_hash, key_prefix)
  VALUES (
    p_user_id,
    COALESCE(NULLIF(btrim(p_label), ''), 'POS key'),
    p_key_hash,
    p_key_prefix
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_revoke_api_key(
  p_user_id UUID,
  p_key_id UUID
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT user_id INTO v_owner
  FROM public.pos_api_keys
  WHERE id = p_key_id
  FOR UPDATE;

  IF v_owner IS NULL OR v_owner <> p_user_id THEN
    RAISE EXCEPTION 'That API key could not be found';
  END IF;

  UPDATE public.pos_api_keys
  SET revoked = true, revoked_at = now()
  WHERE id = p_key_id AND revoked = false;

  RETURN true;
END;
$$;

-- Stamp last_used_at at most once a minute per key: the machine API
-- authenticates on every poll, and a write per poll is pure churn.
CREATE OR REPLACE FUNCTION public.pos_touch_api_key(p_key_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.pos_api_keys
  SET last_used_at = now()
  WHERE id = p_key_id
    AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute');
END;
$$;

-- ── 8. Expiry sweep (pg_cron, mirrors the p2p_expire_orders shape) ───
CREATE OR REPLACE FUNCTION public.pos_expire_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.pos_payment_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'awaiting_payment'
    AND expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ── 9. Deposit matching ──────────────────────────────────────────────
-- Called by the trigger below when a deposit is credited. Returns
-- 'paid' | 'underpaid' | 'overpaid' | 'already_matched' |
-- 'no_open_request' | 'not_credited'. Never moves money: the wallet
-- credit already happened inside btc_record_deposit; this only
-- annotates which POS request the deposit settles.
CREATE OR REPLACE FUNCTION public.pos_apply_deposit_match(p_deposit_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep public.btc_deposits;
  v_req public.pos_payment_requests;
  v_status TEXT;
BEGIN
  SELECT * INTO v_dep FROM public.btc_deposits WHERE id = p_deposit_id;
  IF v_dep.id IS NULL OR v_dep.status <> 'credited' THEN
    RETURN 'not_credited';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pos_payment_requests
             WHERE deposit_id = p_deposit_id) THEN
    RETURN 'already_matched';
  END IF;

  -- Exact-amount candidates first, then oldest first (FIFO). The row
  -- lock + the status re-check inside the UPDATE keep two deposits
  -- racing for one request from both matching it.
  SELECT * INTO v_req
  FROM public.pos_payment_requests
  WHERE user_id = v_dep.user_id
    AND deposit_address = v_dep.address
    AND status = 'awaiting_payment'
  ORDER BY (sats_expected = v_dep.amount_sats) DESC, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RETURN 'no_open_request';
  END IF;

  IF v_dep.amount_sats = v_req.sats_expected THEN
    v_status := 'paid';
  ELSIF v_dep.amount_sats < v_req.sats_expected THEN
    v_status := 'underpaid';
  ELSE
    v_status := 'overpaid';
  END IF;

  UPDATE public.pos_payment_requests
  SET status = v_status,
      deposit_id = v_dep.id,
      txid = v_dep.txid,
      sats_received = v_dep.amount_sats,
      confirmations_at_detection = v_dep.confirmations,
      btc_zmw_rate_at_payment = btc_zmw_rate,
      paid_at = COALESCE(v_dep.credited_at, now()),
      updated_at = now()
  WHERE id = v_req.id
    AND status = 'awaiting_payment';

  IF NOT FOUND THEN
    RETURN 'no_open_request';
  END IF;

  RETURN v_status;
END;
$$;

-- Trigger wrapper: matching is annotation only. ANY failure is
-- swallowed with a warning so deposit crediting — which shares this
-- transaction inside btc_record_deposit — can never be affected.
CREATE OR REPLACE FUNCTION public.pos_match_deposit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.pos_apply_deposit_match(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'POS deposit match failed for deposit %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_match_deposit ON public.btc_deposits;
CREATE TRIGGER trg_pos_match_deposit
  AFTER UPDATE OF status ON public.btc_deposits
  FOR EACH ROW
  WHEN (NEW.status = 'credited' AND OLD.status IS DISTINCT FROM 'credited')
  EXECUTE FUNCTION public.pos_match_deposit_trigger();

-- ── 10. Lock the RPCs down to the service role ───────────────────────
REVOKE ALL ON FUNCTION public.pos_hash_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_hash_api_key(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.pos_hash_api_key(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_create_request(UUID, TEXT, NUMERIC, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_create_request(UUID, TEXT, NUMERIC, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM anon;
REVOKE ALL ON FUNCTION public.pos_create_request(UUID, TEXT, NUMERIC, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_cancel_request(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_cancel_request(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pos_cancel_request(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_create_api_key(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_create_api_key(UUID, TEXT, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.pos_create_api_key(UUID, TEXT, TEXT, TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_revoke_api_key(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_revoke_api_key(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pos_revoke_api_key(UUID, UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_touch_api_key(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_touch_api_key(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pos_touch_api_key(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_expire_requests() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_expire_requests() FROM anon;
REVOKE ALL ON FUNCTION public.pos_expire_requests() FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_apply_deposit_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_apply_deposit_match(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pos_apply_deposit_match(UUID) FROM authenticated;
REVOKE ALL ON FUNCTION public.pos_match_deposit_trigger() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_match_deposit_trigger() FROM anon;
REVOKE ALL ON FUNCTION public.pos_match_deposit_trigger() FROM authenticated;

GRANT EXECUTE ON FUNCTION public.pos_hash_api_key(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_create_request(UUID, TEXT, NUMERIC, BIGINT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_cancel_request(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_create_api_key(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_revoke_api_key(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_touch_api_key(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_expire_requests() TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_apply_deposit_match(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.pos_match_deposit_trigger() TO service_role;

-- ── 11. Expiry cron (idempotent unschedule-first, as p2p) ────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pos-expire-requests') THEN
    PERFORM cron.unschedule('pos-expire-requests');
  END IF;
END $$;

SELECT cron.schedule(
  'pos-expire-requests',
  '*/5 * * * *',
  $$SELECT public.pos_expire_requests();$$);
