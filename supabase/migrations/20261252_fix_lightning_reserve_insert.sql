-- ============================================================================
-- 20261252 — Corrective: btc_reserve_lightning_send INSERT column/value
-- mismatch (restating error in 20261251).
--
-- The 20261251 restatement of btc_reserve_lightning_send dropped
-- p_amount_sats from the INSERT ... VALUES list (7 target columns,
-- 6 expressions), so every Lightning reserve raised "INSERT has
-- more target columns than expressions" and rolled back — no hold
-- was taken and no payment row was written (verified live: the QA
-- wallet was untouched). This migration restates the function
-- identically to 20261251 except for the corrected VALUES list.
-- ACLs are preserved by CREATE OR REPLACE and re-asserted anyway.
-- ============================================================================

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

  PERFORM pg_advisory_xact_lock(hashtext('btc_ln_send:' || p_user_id::text));

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

  SELECT lp.* INTO v_existing
  FROM public.lightning_payments lp
  WHERE lp.user_id = p_user_id
    AND lp.direction = 'outbound'
    AND lp.payment_hash = p_payment_hash
    AND lp.status IN ('processing', 'paid', 'awaiting_rebalance')
  ORDER BY lp.created_at ASC
  LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    payment_id := v_existing.id; status := v_existing.status;
    amount_sats := v_existing.amount_sats; replayed := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_max_daily_sats IS NOT NULL THEN
    SELECT COALESCE(sum(lp.amount_sats), 0) INTO v_sent_today
    FROM public.lightning_payments lp
    WHERE lp.user_id = p_user_id
      AND lp.direction = 'outbound'
      AND lp.status IN ('processing', 'paid', 'awaiting_rebalance')
      AND lp.created_at >= now() - interval '24 hours';
    IF v_sent_today + p_amount_sats > p_max_daily_sats THEN
      RAISE EXCEPTION 'Daily Lightning payment limit exceeded';
    END IF;
  END IF;

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

REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.btc_reserve_lightning_send(UUID, TEXT, TEXT, BIGINT, TEXT, BIGINT) TO service_role;
