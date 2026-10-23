-- ============================================================================
-- 20261023_m1_btc_reserve_cap.sql — audit P2-15 / M1: enforce the BTC
-- withdrawal daily cap INSIDE btc_reserve_withdrawal, and owner-scope its
-- idempotency replay (the L2 leak class).
--
-- THE RACE (app layer, btc-onchain send()): the daily cap was checked by
-- summing the caller's btc_withdrawals in application code BEFORE the
-- reservation RPC ran. The sum and the reservation are separate round
-- trips, so two concurrent sends from the same user could both read a
-- sum under BTC_MAX_DAILY_SATS, both reserve, and together exceed the
-- cap ~2× per race window. (send() also re-checks the cap after
-- reserving, but that is a second line of defence built on the same
-- racy read; the authoritative check belongs in the transaction that
-- creates the reservation.)
--
-- THE FIX: this replacement takes the cap as a new optional parameter
-- p_max_daily_sats (BIGINT DEFAULT NULL) and, when it is supplied:
--   1. serializes concurrent reservations PER USER with a transaction
--      advisory lock — pg_advisory_xact_lock(hashtext('btc_reserve:' ||
--      p_user_id::text)) — taken after the idempotency replay returns
--      and before the cap sum, so the sum and the INSERT below are
--      atomic with respect to every other reservation by this user;
--   2. sums amount_sats over the caller's withdrawals in the rolling
--      last 24 hours across the fund-committing statuses
--      ('reserved','broadcast','confirmed') — EXACTLY the app layer's
--      semantics (amount only, fees excluded, same status set, same
--      window) — and raises 'Daily withdrawal limit exceeded' when
--      sum + p_amount_sats would exceed the cap, BEFORE the balance
--      debit, so a refused reservation moves no money.
-- A NULL cap (the default) preserves the previous behaviour exactly:
-- the app layer still enforces the cap on those calls. btc-onchain
-- passes its env-derived BTC_MAX_DAILY_SATS on every send, so in
-- practice the RPC check is always armed; the parameter stays optional
-- so the previously deployed 5-argument call keeps working until the
-- function redeploys.
--
-- L2 REPLAY SCOPING: the old body looked the idempotency key up ALONE
-- and returned the stored withdrawal (id, status, amounts) to ANY
-- caller who presented the key — the same cross-user replay leak fixed
-- in the other money RPCs tonight. The replay now raises
-- 'Idempotency key already used' when the stored row belongs to a
-- different user (btc-onchain's own pre-check answers 409 with the same
-- words), and returns the row only to its owner.
--
-- Everything else in the body is behaviour-identical to
-- 20261020_bitcoin_completion.sql. The old 5-argument function is
-- DROPped (not merely replaced) because the replacement has a
-- different signature — CREATE OR REPLACE alone would leave the old
-- overload in place.
-- ============================================================================

DROP FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT);

CREATE OR REPLACE FUNCTION public.btc_reserve_withdrawal(
  p_user_id UUID,
  p_to_address TEXT,
  p_amount_sats BIGINT,
  p_fee_sats BIGINT,
  p_idempotency_key TEXT,
  p_max_daily_sats BIGINT DEFAULT NULL
)
RETURNS TABLE(withdrawal_id UUID, status TEXT, amount_sats BIGINT, fee_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.btc_withdrawals%ROWTYPE;
  v_total BIGINT := p_amount_sats + p_fee_sats;
  v_sent_today BIGINT;
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
      -- L2: a stored key is only ever replayed to its owner.
      IF v_existing.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      withdrawal_id := v_existing.id; status := v_existing.status;
      amount_sats := v_existing.amount_sats; fee_sats := v_existing.fee_sats;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  -- M1: serialize this user's reservations so the cap sum below and
  -- the INSERT are atomic against concurrent sends by the same user.
  -- Transaction-scoped: released automatically at COMMIT/ROLLBACK.
  PERFORM pg_advisory_xact_lock(hashtext('btc_reserve:' || p_user_id::text));

  -- M1: the daily cap, enforced in the reserving transaction with the
  -- app layer's exact semantics (amount_sats only; 'reserved',
  -- 'broadcast' and 'confirmed' rows; rolling 24 hours). A NULL cap
  -- leaves enforcement to the app layer, as before this migration.
  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(w.amount_sats), 0) INTO v_sent_today
    FROM public.btc_withdrawals w
    WHERE w.user_id = p_user_id
      AND w.status IN ('reserved', 'broadcast', 'confirmed')
      AND w.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily withdrawal limit exceeded';
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

REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
-- The DROP + fresh CREATE picks up this project's DEFAULT function
-- privileges (EXECUTE to anon + authenticated), which a PUBLIC-only
-- revoke does not remove — the live apply proved it (acl showed all
-- four roles). Revoke the role grants explicitly. (CREATE OR REPLACE
-- migrations do not need this: REPLACE preserves the existing ACL.)
REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) TO service_role;
