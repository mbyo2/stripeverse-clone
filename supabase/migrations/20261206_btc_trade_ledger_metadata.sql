-- 20261206_btc_trade_ledger_metadata.sql
-- Final-QA FIX-5: btc_execute_trade's BTC ledger legs land in
-- public.transactions with amount 0.00 (the column is 2dp-scaled and
-- sats/1e8 rounds away) and metadata NULL — and the history UI
-- (TransactionList fetches ALL user transactions, renders
-- amount.toFixed(2) + currency) surfaces them as misleading
-- "0.00 BTC" rows. Both legs now stamp
-- metadata {asset:'BTC', sats, side} so the sats value — the leg's
-- real amount — survives on the row. Body is the live definition
-- with only the two INSERT column/value lists extended; CREATE OR
-- REPLACE preserves the proacl (re-verified after apply).

CREATE OR REPLACE FUNCTION public.btc_execute_trade(p_user_id uuid, p_quote_id uuid, p_idempotency_key text)
 RETURNS TABLE(quote_id uuid, side text, amount_zmw numeric, amount_sats bigint, new_zmw_balance numeric, new_btc_sats bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.btc_quotes%ROWTYPE;
  v_zmw_id UUID;
  v_zmw_balance NUMERIC;
  v_crypto_balance BIGINT;
  v_crypto_available BIGINT;
  v_existing UUID;
  v_existing_user UUID;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.uuid_id, t.user_id INTO v_existing, v_existing_user
    FROM public.transactions t
    WHERE t.idempotency_key = p_idempotency_key || ':zmw'
    LIMIT 1;
    IF v_existing IS NOT NULL AND v_existing_user <> p_user_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    IF v_existing IS NOT NULL THEN
      SELECT q.* INTO v_quote FROM public.btc_quotes q WHERE q.id = p_quote_id;
      SELECT w.balance INTO v_zmw_balance FROM public.wallets w
        WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL;
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
  WHERE w.user_id = p_user_id AND w.currency = 'ZMW' AND w.account_id IS NULL
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
     description, reference, category, idempotency_key, metadata)
  VALUES
    (p_user_id, v_zmw_id, v_quote.amount_zmw, 'ZMW',
     CASE WHEN v_quote.side = 'buy' THEN 'outgoing' ELSE 'incoming' END,
     'bitcoin_trade', 'completed',
CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':zmw' END,
     jsonb_build_object('asset', 'BTC', 'sats', v_quote.amount_sats,
                        'side', v_quote.side));

  INSERT INTO public.transactions
    (user_id, amount, currency, direction, payment_method, status,
     description, reference, category, idempotency_key, metadata)
  VALUES
    (p_user_id, v_quote.amount_sats::numeric / 100000000, 'BTC',
     CASE WHEN v_quote.side = 'buy' THEN 'incoming' ELSE 'outgoing' END,
     'bitcoin_trade', 'completed',
     CASE WHEN v_quote.side = 'buy' THEN 'Buy Bitcoin' ELSE 'Sell Bitcoin' END,
     v_quote.id::text, 'btc_trade',
     CASE WHEN p_idempotency_key IS NULL THEN NULL
          ELSE p_idempotency_key || ':btc' END,
     -- FIX-5: the BTC leg's amount column is 2dp-scaled, so the sats
     -- value (its real amount) survives ONLY here. Without this the
     -- history UI renders the leg as a misleading 0.00 BTC row.
     jsonb_build_object('asset', 'BTC', 'sats', v_quote.amount_sats,
                        'side', v_quote.side));

  UPDATE public.btc_quotes
  SET consumed_at = now()
  WHERE id = v_quote.id;

  quote_id := v_quote.id; side := v_quote.side;
  amount_zmw := v_quote.amount_zmw; amount_sats := v_quote.amount_sats;
  RETURN NEXT;
END;
$function$
