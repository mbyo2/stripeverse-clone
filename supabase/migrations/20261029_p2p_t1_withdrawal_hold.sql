-- ============================================================================
-- 20261029_p2p_t1_withdrawal_hold.sql — wire the P2P T+1 withdrawal
-- hold (scope §3.8 research amendment; Phase 1a header finding 5)
-- into the on-chain withdrawal reservation path.
--
-- THE GAP: Phase 1a (20261023_p2p_phase1a_core.sql) records a
-- p2p_withdrawal_holds row every time a P2P release credits a buyer,
-- and exposes p2p_unmatured_withdrawal_hold_sats(user) as the single
-- figure the withdrawal path must consult — but nothing consulted
-- it. A user could receive BTC in a P2P trade and withdraw it
-- on-chain seconds later, defeating the fraud window the hold
-- exists to create (reversal reports, takeover victims and dispute
-- filings need time to surface before proceeds can leave).
--
-- THE LIVE SHAPE (Phase 1a finding 5, deliberate): a release credits
-- the buyer's balance AND available immediately — internal
-- transfers, trades (btc_execute_trade) and further P2P orders are
-- unaffected (the Binance carve-out) — and the hold is enforced by
-- SUBTRACTION at on-chain withdrawal time only. This migration is
-- that subtraction, placed in the one function every on-chain
-- withdrawal flows through: btc_reserve_withdrawal (called only by
-- the btc-onchain edge function's send path).
--
-- ACCOUNTING, PRESERVED EXACTLY (M1 body, 20261023): validate →
-- owner-scoped idempotency replay → per-user advisory xact lock →
-- in-transaction daily cap (when p_max_daily_sats is supplied) →
-- btc_adjust_crypto_wallet(-(amount+fee), -(amount+fee)), which
-- row-locks the BTC wallet and raises 'Insufficient BTC balance'
-- if balance or available would go negative → INSERT the
-- 'reserved' btc_withdrawals row. Because each reservation debits
-- available_sats at reserve time, in-flight reservations are
-- ALREADY netted out of available_sats — they are not subtracted a
-- second time here.
--
-- THE ONE CHANGE: under the same advisory lock, after the cap
-- check and before the debit, the reservation now also requires
--     amount + fee <= available_sats - unmatured P2P holds
-- i.e. after the debit, available_sats still fully covers the
-- unmatured holds, so held sats cannot leave on-chain until
-- p2p_mature_withdrawal_holds (pg_cron, 15 min) matures their row.
-- The refusal raises BEFORE the debit, so a refused reservation
-- moves no money and writes no row. Users with no unmatured holds
-- skip the check entirely — zero behaviour change for non-P2P
-- withdrawals. Signature, return shape, cap semantics, replay
-- semantics and every existing error message are unchanged.
--
-- ACL: same signature as the M1 version, so this is a pure CREATE
-- OR REPLACE, which preserves the existing ACL exactly
-- ({postgres, service_role}). The REVOKE/GRANT pair is re-asserted
-- anyway, in the Phase 1a house style, so the file is auditable
-- standalone; it reproduces the current ACL and changes nothing.
-- ============================================================================

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
  v_held_sats BIGINT;
  v_available_sats BIGINT;
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

  -- T+1 P2P withdrawal hold (scope §3.8 amendment; Phase 1a finding
  -- 5): sats credited by a P2P release may not leave on-chain until
  -- their hold matures (default 24h). Reservable is what remains of
  -- available after unmatured holds; in-flight reservations are
  -- already out of available (debited at their reserve time), so
  -- they are not subtracted again. Read under the advisory lock
  -- above, so the figure cannot race another reservation by this
  -- user. The btc-onchain edge function returns this message to the
  -- user verbatim, before any broadcast.
  v_held_sats := public.p2p_unmatured_withdrawal_hold_sats(p_user_id);
  IF v_held_sats > 0 THEN
    SELECT w.available_sats INTO v_available_sats
    FROM public.crypto_wallets w
    WHERE w.user_id = p_user_id AND w.asset = 'BTC';
    IF v_total > COALESCE(v_available_sats, 0) - v_held_sats THEN
      RAISE EXCEPTION 'Part of your Bitcoin is still inside its 24-hour safety hold from a recent P2P trade - that part is not available to withdraw yet';
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

-- ACL re-asserted (see header): CREATE OR REPLACE already preserves
-- the M1 ACL; these statements reproduce it exactly.
REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_withdrawal(UUID, TEXT, BIGINT, BIGINT, TEXT, BIGINT) TO service_role;
