-- ============================================================================
-- Custodial Lightning SEND (2026-10-26): reserve / settle / release RPCs
-- for outbound lightning_payments, mirroring the on-chain withdrawal
-- family (btc_reserve_withdrawal / btc_finalize_withdrawal /
-- btc_fail_withdrawal, migrations 20261020 + 20261023_m1).
--
-- THE GAP: the custodial wallet could RECEIVE Lightning (Coinos
-- invoices, settled exactly-once by btc_settle_lightning_deposit) but
-- could not SEND: lightning-service's pay_invoice held its full flow
-- behind PROVIDER_PAY_CONFIRMED = false because the provider's pay
-- contract could not be confirmed from a zero-balance account. The
-- non-custodial Spark wallet has sent Lightning all along — custodial
-- must reach parity (CEO order 2026-10-26 15:42 CAT).
--
-- MONEY DOCTRINE (the Lightning mirror of the on-chain send rules):
--   RESERVE  — the send is recorded FIRST (status 'processing') and
--              the amount is held by debiting available_sats only
--              (btc_adjust_crypto_wallet(0, -sats), which raises
--              'Insufficient BTC balance' atomically). Balance stays
--              whole until settlement, so a held send is visible as
--              balance-minus-available, exactly like the Lightning
--              deposit hold the client already renders.
--   SETTLE   — only on INDEPENDENT confirmation that the provider
--              paid (a GET /payments read-back, never the POST
--              response): balance is debited (adjust(-sats, 0)), the
--              row flips to 'paid' and the activity-feed ledger row
--              is written — all in ONE transaction, so no crash can
--              strand a paid-but-undebited send, and replays report
--              'already_settled' and move nothing.
--   RELEASE  — only for a DEFINITIVE non-payment (the provider
--              refused the payment itself): the hold is returned
--              (adjust(0, +sats)) and the row flips to 'failed'.
--              Releasing from any other status RAISES — an unknown
--              outcome is NEVER auto-refunded (the broadcast-outcome
--              doctrine of _shared/btc-core.ts); it stays
--              'processing' for ops reconciliation through these
--              same two RPCs.
--   IDENTITY — the invoice's payment_hash is the send's identity:
--              a second reserve for the same (user, payment_hash)
--              while one is 'processing' or 'paid' replays the
--              original row instead of paying twice, and the
--              per-attempt idempotency key (unique per user) makes a
--              retried submission return its original outcome.
--   CAP      — the daily cap is enforced inside the reserving
--              transaction (per-user advisory lock; the sum covers
--              'processing' + 'paid' outbound rows in the rolling
--              24h) when the caller supplies p_max_daily_sats — the
--              same semantics as btc_reserve_withdrawal's M1 fix.
--
-- lightning_payments gains: the 'processing' status, an
-- idempotency_key column (unique per user when present) and a
-- failure_reason column for ops visibility on released sends.
-- ============================================================================

-- ── 1. Schema: status, idempotency key, failure reason ─────────────────────

ALTER TABLE public.lightning_payments
  DROP CONSTRAINT IF EXISTS lightning_payments_status_check;
ALTER TABLE public.lightning_payments
  ADD CONSTRAINT lightning_payments_status_check
  CHECK (status IN ('pending', 'processing', 'paid', 'expired', 'failed'));

ALTER TABLE public.lightning_payments
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.lightning_payments
  ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lightning_payments_idempotency
  ON public.lightning_payments (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lightning_payments_outbound_hash
  ON public.lightning_payments (user_id, payment_hash)
  WHERE direction = 'outbound';

-- ── 2. Reserve an outbound Lightning send ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.btc_reserve_lightning_send(
  p_user_id UUID,
  p_bolt11 TEXT,
  p_payment_hash TEXT,
  p_amount_sats BIGINT,
  p_idempotency_key TEXT,
  p_max_daily_sats BIGINT DEFAULT NULL
)
RETURNS TABLE(payment_id UUID, status TEXT, amount_sats BIGINT, replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.lightning_payments%ROWTYPE;
  v_sent_today BIGINT;
  v_id UUID;
BEGIN
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'An idempotency key is required';
  END IF;
  IF p_payment_hash IS NULL OR length(trim(p_payment_hash)) = 0 THEN
    RAISE EXCEPTION 'A payment hash is required';
  END IF;

  -- Serialize this user's sends so the replay checks, the cap sum
  -- and the INSERT below are atomic against concurrent submissions.
  PERFORM pg_advisory_xact_lock(hashtext('btc_ln_send:' || p_user_id::text));

  -- Idempotency replay: a stored key returns its original row to its
  -- owner only (the L2 scoping rule from btc_reserve_withdrawal).
  SELECT lp.* INTO v_existing
  FROM public.lightning_payments lp
  WHERE lp.idempotency_key = p_idempotency_key;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    payment_id := v_existing.id; status := v_existing.status;
    amount_sats := v_existing.amount_sats; replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Invoice-identity replay: the same invoice (payment hash) with a
  -- live or completed send is the SAME payment — return it rather
  -- than paying twice. A 'failed' send released its reservation, so
  -- it does not block a genuinely new attempt under a new key.
  SELECT lp.* INTO v_existing
  FROM public.lightning_payments lp
  WHERE lp.user_id = p_user_id
    AND lp.direction = 'outbound'
    AND lp.payment_hash = p_payment_hash
    AND lp.status IN ('processing', 'paid')
  ORDER BY lp.created_at ASC
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    payment_id := v_existing.id; status := v_existing.status;
    amount_sats := v_existing.amount_sats; replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Daily cap, enforced in the reserving transaction with the
  -- withdrawal cap's semantics (fund-committing statuses only).
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(lp.amount_sats), 0) INTO v_sent_today
    FROM public.lightning_payments lp
    WHERE lp.user_id = p_user_id
      AND lp.direction = 'outbound'
      AND lp.status IN ('processing', 'paid')
      AND lp.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily Lightning payment limit exceeded';
    END IF;
  END IF;

  -- Hold the amount: available drops now, balance at settlement.
  -- Raises 'Insufficient BTC balance' when the hold cannot be covered.
  PERFORM public.btc_adjust_crypto_wallet(p_user_id, 0, -p_amount_sats);

  INSERT INTO public.lightning_payments
    (user_id, direction, amount_sats, bolt11, payment_hash, status, idempotency_key)
  VALUES
    (p_user_id, 'outbound', p_amount_sats, p_bolt11, p_payment_hash,
     'processing', p_idempotency_key)
  RETURNING id INTO v_id;

  payment_id := v_id; status := 'processing';
  amount_sats := p_amount_sats; replayed := FALSE;
  RETURN NEXT;
END;
$$;

-- ── 3. Settle a confirmed outbound Lightning send ──────────────────────────

CREATE OR REPLACE FUNCTION public.btc_settle_lightning_send(
  p_payment_id UUID,
  p_payment_hash TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, payment_status TEXT, amount_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.lightning_payments%ROWTYPE;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'A lightning payment id is required';
  END IF;

  SELECT lp.* INTO v_row
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    outcome := 'not_found'; payment_status := NULL; amount_sats := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  payment_status := v_row.status;
  amount_sats := v_row.amount_sats;

  IF v_row.direction <> 'outbound' THEN
    RAISE EXCEPTION 'Only outbound payments settle here';
  END IF;
  IF v_row.status = 'paid' THEN
    outcome := 'already_settled';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_row.status <> 'processing' THEN
    RAISE EXCEPTION 'Cannot settle lightning payment in status %', v_row.status;
  END IF;

  -- The hold becomes the spend: balance drops by the amount whose
  -- available was already held at reserve.
  PERFORM public.btc_adjust_crypto_wallet(v_row.user_id, -v_row.amount_sats, 0);

  UPDATE public.lightning_payments
  SET status = 'paid',
      payment_hash = COALESCE(payment_hash, p_payment_hash),
      settled_at = now()
  WHERE id = p_payment_id;

  -- Activity-feed ledger row in the same transaction, idempotent on
  -- 'ln-out:<payment_id>' (mirrors btc_settle_lightning_deposit).
  INSERT INTO public.transactions
    (user_id, currency, amount, direction, payment_method, status,
     description, reference, category, transaction_id, idempotency_key,
     metadata)
  VALUES
    (v_row.user_id, 'BTC',
     v_row.amount_sats::numeric / 100000000, 'outgoing', 'lightning',
     'completed', 'Lightning payment',
     COALESCE(p_payment_hash, v_row.payment_hash),
     'lightning_payment',
     COALESCE(p_payment_hash, v_row.payment_hash, 'ln-out-' || v_row.id::text),
     'ln-out:' || v_row.id::text,
     jsonb_build_object('type', 'lightning_payment',
                        'sats', v_row.amount_sats))
  ON CONFLICT (idempotency_key) DO NOTHING;

  outcome := 'settled';
  payment_status := 'paid';
  RETURN NEXT;
END;
$$;

-- ── 4. Release a definitively-unpaid outbound Lightning send ───────────────

CREATE OR REPLACE FUNCTION public.btc_release_lightning_send(
  p_payment_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TABLE(outcome TEXT, payment_status TEXT, amount_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.lightning_payments%ROWTYPE;
BEGIN
  IF p_payment_id IS NULL THEN
    RAISE EXCEPTION 'A lightning payment id is required';
  END IF;

  SELECT lp.* INTO v_row
  FROM public.lightning_payments lp
  WHERE lp.id = p_payment_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    outcome := 'not_found'; payment_status := NULL; amount_sats := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  payment_status := v_row.status;
  amount_sats := v_row.amount_sats;

  IF v_row.direction <> 'outbound' THEN
    RAISE EXCEPTION 'Only outbound payments release here';
  END IF;
  IF v_row.status = 'failed' THEN
    outcome := 'already_released';
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_row.status <> 'processing' THEN
    RAISE EXCEPTION 'Cannot release lightning payment in status % — the payment may already have been made', v_row.status;
  END IF;

  -- Return the hold in full: the payment provably was not made.
  PERFORM public.btc_adjust_crypto_wallet(v_row.user_id, 0, v_row.amount_sats);

  UPDATE public.lightning_payments
  SET status = 'failed',
      failure_reason = p_reason
  WHERE id = p_payment_id;

  outcome := 'released';
  payment_status := 'failed';
  RETURN NEXT;
END;
$$;

-- ── 5. Lock the RPCs down to the service role ──────────────────────────────
-- Fresh CREATEs inherit this project's DEFAULT function privileges
-- (EXECUTE to anon + authenticated); a PUBLIC-only revoke does not
-- remove those, so revoke the role grants explicitly (the 20261023
-- lesson) and grant service_role only.

REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_settle_lightning_send(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_settle_lightning_send(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_settle_lightning_send(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_release_lightning_send(UUID, TEXT) TO service_role;
