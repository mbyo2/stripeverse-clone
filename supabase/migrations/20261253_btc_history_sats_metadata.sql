-- 20261253: BTC transaction-history amounts must survive rendering.
--
-- public.transactions.amount is numeric(12,2) in BTC units, so every
-- sub-0.01 BTC movement rounds to 0.00 in the column. The true amount
-- of a BTC row lives in metadata.sats (the pattern the trade, Lightning
-- and internal-transfer writers already used). This migration extends
-- that key to the remaining BTC writers, changing ONLY the metadata
-- expression of each INSERT — no money logic, amounts, ACLs or control
-- flow are touched (verified against the live definitions):
--   btc_record_deposit               deposit row gains metadata {sats, txid}
--   btc_settle_selfcustody_sell      BTC leg gains metadata {sats, ...}
--   btc_settle_withdrawal_batch      adds 'sats' = amount_sats + fee share
--   execute_payment_link_btc_settlement  merchant row 'sats' = merchant credit;
--                                    both fee rows 'sats' = fee
--   finalize_payment_link_btc_partial adds 'sats' = received_sats
--   btc_record_consolidation         adds 'sats' = fee_sats
-- Client renderers resolve a BTC row's sats from metadata.sats first
-- (see src/lib/btcHistory.ts), so history shows real amounts again.
-- Pre-launch sweep 2026-11-05 (Defect 1: BTC history showed 0.00).

CREATE OR REPLACE FUNCTION public.btc_record_deposit(p_user_id uuid, p_address text, p_txid text, p_vout integer, p_amount_sats bigint, p_confirmations integer, p_required_confs integer DEFAULT 1)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                                                                                                                                               description, reference, category, idempotency_key, metadata)
                                                                                                                                                                 VALUES
                                                                                                                                                                     (p_user_id, p_amount_sats::numeric / 100000000, 'BTC', 'incoming',
                                                                                                                                                                          'bitcoin_onchain', 'completed', 'Bitcoin deposit (on-chain)',
                                                                                                                                                                               p_txid, 'btc_deposit', 'btc-dep:' || p_txid || ':' || p_vout,
     jsonb_build_object('sats', p_amount_sats, 'txid', p_txid));

                                                                                                                                                                                 UPDATE public.btc_deposits
                                                                                                                                                                                   SET status = 'credited', credited_at = now(), updated_at = now()
                                                                                                                                                                                     WHERE txid = p_txid AND vout = p_vout;

                                                                                                                                                                                       RETURN 'credited';
                                                                                                                                                                                       END;
                                                                                                                                                                                       $function$;

CREATE OR REPLACE FUNCTION public.btc_settle_selfcustody_sell(p_intent_id uuid, p_deposit_kind text, p_txid text DEFAULT NULL::text, p_vout integer DEFAULT NULL::integer, p_lightning_payment_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(outcome text, intent_status text, actual_sats bigint, zmw_credited numeric, fee_zmw numeric, new_zmw_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     description, reference, category, idempotency_key, metadata)
  VALUES
    (v_intent.user_id, v_actual_sats::numeric / 100000000, 'BTC', 'outgoing',
     'bitcoin_trade', 'completed',
     'Sell Bitcoin (self-custody)', v_intent.id::text, 'btc_trade',
     concat('sc-sell:', v_intent.id::text, ':btc'),
     jsonb_build_object('asset', 'BTC', 'sats', v_actual_sats,
                        'side', 'sell', 'self_custody', true));

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
$function$;

CREATE OR REPLACE FUNCTION public.btc_settle_withdrawal_batch(p_batch_id uuid, p_txid text, p_actual_fee_sats bigint, p_shares jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.btc_withdrawal_batches%ROWTYPE;
  v_member_count INTEGER;
  v_share_count INTEGER;
  v_share_sum BIGINT;
  v_member RECORD;
  v_share BIGINT;
  v_refund BIGINT;
BEGIN
  SELECT b.* INTO v_batch
  FROM public.btc_withdrawal_batches b
  WHERE b.id = p_batch_id
  FOR UPDATE;
  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;
  IF v_batch.status = 'broadcast' THEN
    RETURN 'already_settled';
  END IF;
  -- 'forming' = the normal post-broadcast settle; 'broadcast_unknown'
  -- = the ops reconciliation settle once the outcome is proven.
  IF v_batch.status NOT IN ('forming', 'broadcast_unknown') THEN
    RAISE EXCEPTION 'Batch is not in a settleable state (status %)', v_batch.status;
  END IF;
  IF p_actual_fee_sats IS NULL OR p_actual_fee_sats < 0 THEN
    RAISE EXCEPTION 'Actual fee must be zero or positive';
  END IF;
  IF p_shares IS NULL OR jsonb_typeof(p_shares) <> 'array' THEN
    RAISE EXCEPTION 'Shares must be a JSON array';
  END IF;

  SELECT count(*) INTO v_member_count
  FROM public.btc_withdrawals w
  WHERE w.batch_id = p_batch_id AND w.status = 'batched';

  WITH share_rows AS (
    SELECT (e->>'withdrawal_id')::uuid AS wid,
           (e->>'share_sats')::bigint AS share
    FROM jsonb_array_elements(p_shares) AS e
  )
  SELECT count(*), COALESCE(sum(share), 0) INTO v_share_count, v_share_sum
  FROM share_rows;

  IF v_share_count <> v_member_count THEN
    RAISE EXCEPTION 'Share count % does not match batch member count %',
      v_share_count, v_member_count;
  END IF;
  -- Every share names a distinct member of THIS batch, within its cap.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_shares) AS e
    LEFT JOIN public.btc_withdrawals w
      ON w.id = (e->>'withdrawal_id')::uuid
     AND w.batch_id = p_batch_id AND w.status = 'batched'
    WHERE w.id IS NULL
       OR (e->>'share_sats')::bigint < 0
       OR (e->>'share_sats')::bigint > w.fee_sats
  ) THEN
    RAISE EXCEPTION 'Invalid share: unknown member, negative, or above the reserved fee cap';
  END IF;
  IF (SELECT count(DISTINCT (e->>'withdrawal_id'))
      FROM jsonb_array_elements(p_shares) AS e) <> v_member_count THEN
    RAISE EXCEPTION 'Duplicate share for a batch member';
  END IF;
  IF v_share_sum > p_actual_fee_sats THEN
    RAISE EXCEPTION 'Shares exceed the actual batch fee';
  END IF;

  FOR v_member IN
    SELECT w.* FROM public.btc_withdrawals w
    WHERE w.batch_id = p_batch_id AND w.status = 'batched'
    ORDER BY w.id
    FOR UPDATE
  LOOP
    SELECT (e->>'share_sats')::bigint INTO v_share
    FROM jsonb_array_elements(p_shares) AS e
    WHERE (e->>'withdrawal_id')::uuid = v_member.id;

    v_refund := v_member.fee_sats - v_share;
    IF v_refund > 0 THEN
      PERFORM public.btc_adjust_crypto_wallet(v_member.user_id, v_refund, v_refund);
    END IF;

    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       description, reference, category, idempotency_key, metadata)
    VALUES
      (v_member.user_id,
       (v_member.amount_sats + v_share)::numeric / 100000000, 'BTC',
       'outgoing', 'bitcoin_onchain', 'completed',
       'Bitcoin withdrawal (on-chain, low-fee batch)',
       p_txid, 'btc_withdrawal',
       'btc-wd:' || v_member.id::text,
       jsonb_build_object(
         'sats', v_member.amount_sats + v_share,
         'type', 'withdrawal',
         'txid', p_txid,
         'fee_sats', v_share,
         'batched', true,
         'batch_id', p_batch_id,
         'reserved_fee_sats', v_member.fee_sats,
         'fee_refunded_sats', v_refund));

    UPDATE public.btc_withdrawals
    SET status = 'broadcast', txid = p_txid, fee_share_sats = v_share,
        broadcast_at = now(), updated_at = now()
    WHERE id = v_member.id;
  END LOOP;

  UPDATE public.btc_withdrawal_batches
  SET status = 'broadcast', txid = p_txid,
      actual_fee_sats = p_actual_fee_sats,
      absorbed_sats = p_actual_fee_sats - v_share_sum,
      updated_at = now()
  WHERE id = p_batch_id;

  RETURN 'settled';
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_payment_link_btc_settlement(p_attempt_id uuid, p_payment_method text)
 RETURNS TABLE(owner_transaction_id uuid, merchant_credit_sats bigint, platform_fee_sats bigint, already_settled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt public.payment_link_btc_attempts;
  v_link public.payment_links;
  v_platform_user UUID;
  v_fee BIGINT;
  v_shortfall BIGINT;
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

  v_shortfall := GREATEST(0, v_attempt.required_sats - v_attempt.received_sats);

  IF v_attempt.status = 'settled' THEN
    owner_transaction_id := v_attempt.owner_transaction_id;
    platform_fee_sats := GREATEST(0,
      LEAST(v_attempt.fee_sats, v_attempt.received_sats) - v_shortfall);
    merchant_credit_sats := v_attempt.received_sats - platform_fee_sats;
    already_settled := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_attempt.status IN ('partial_credited', 'failed') THEN
    RAISE EXCEPTION 'Payment attempt can no longer settle';
  END IF;
  -- Coverage: full payment, or a provider-deduction shortfall that
  -- the record RPC already validated against the band (P1). The
  -- deduction column can only be non-zero when that validation ran.
  IF v_attempt.received_sats < v_attempt.required_sats - v_attempt.provider_deduction_sats THEN
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
  -- P1: a provider-deduction shortfall is absorbed out of the fee
  -- first, so the merchant is made whole whenever the shortfall fits
  -- inside the fee.
  v_fee := LEAST(v_attempt.fee_sats, v_attempt.received_sats);
  v_fee := GREATEST(0, v_fee - v_shortfall);
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
       'sats', v_merchant_credit,
       'received_sats', v_attempt.received_sats,
       'fee_sats', v_fee,
       'net_sats', v_merchant_credit,
       'provider_deduction_sats', v_attempt.provider_deduction_sats,
       'absorbed_shortfall_sats', v_shortfall,
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
       jsonb_build_object('attempt_id', v_attempt.id, 'sats', v_fee, 'fee_sats', v_fee));

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
       jsonb_build_object('attempt_id', v_attempt.id, 'sats', v_fee, 'fee_sats', v_fee));
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
$function$;

CREATE OR REPLACE FUNCTION public.finalize_payment_link_btc_partial(p_attempt_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       'sats', v_attempt.received_sats,
       'received_sats', v_attempt.received_sats,
       'required_sats', v_attempt.required_sats));

  UPDATE public.payment_link_btc_attempts
  SET status = 'partial_credited', updated_at = now()
  WHERE id = v_attempt.id;

  RETURN 'partial_credited';
END;
$function$;

CREATE OR REPLACE FUNCTION public.btc_record_consolidation(p_run_id uuid, p_operator_user_id uuid, p_txid text, p_fee_sats bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_run public.btc_consolidation_runs;
BEGIN
  SELECT * INTO v_run FROM public.btc_consolidation_runs
  WHERE id = p_run_id FOR UPDATE;
  IF v_run.id IS NULL THEN
    RAISE EXCEPTION 'Consolidation run not found';
  END IF;
  IF v_run.fee_booked THEN
    RETURN 'already_booked';
  END IF;
  IF p_fee_sats IS NULL OR p_fee_sats < 0 THEN
    RAISE EXCEPTION 'Invalid consolidation fee';
  END IF;

  IF p_fee_sats > 0 THEN
    PERFORM public.btc_adjust_crypto_wallet(
      p_operator_user_id, -p_fee_sats, -p_fee_sats);

    INSERT INTO public.transactions
      (user_id, amount, currency, direction, payment_method, status,
       description, reference, category, idempotency_key, metadata)
    VALUES
      (p_operator_user_id,
       (p_fee_sats::numeric / 100000000), 'BTC', 'outgoing',
       'bitcoin_onchain', 'completed',
       'Bitcoin UTXO consolidation — network fee',
       p_txid, 'btc_consolidation',
       'btc-cons:' || p_run_id::text,
       jsonb_build_object(
         'sats', p_fee_sats,
         'run_id', p_run_id,
         'txid', p_txid,
         'fee_sats', p_fee_sats,
         'input_count', v_run.input_count));
  END IF;

  UPDATE public.btc_consolidation_runs
  SET status = 'broadcast', txid = p_txid, fee_sats = p_fee_sats,
      fee_booked = true, updated_at = now()
  WHERE id = p_run_id;
  RETURN 'booked';
END;
$function$;
