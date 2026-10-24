-- 20261205_p2p_replay_current_balances.sql
-- Final-QA FIX-4: p2p_account_transfer's replay response embedded the
-- ORIGINAL transfer's balance snapshot. DB state was always correct
-- (money moved exactly once); only the replay payload was stale.
-- Both replay branches now override the snapshot's balance fields
-- with CURRENT main + P2P balances (branch 1 reads them fresh;
-- branch 2 reuses the locked reads it already holds). Body below is
-- the live definition with only those two RETURN expressions changed;
-- CREATE OR REPLACE preserves the proacl (re-verified after apply:
-- {postgres, service_role}).

CREATE OR REPLACE FUNCTION public.p2p_account_transfer(p_user_id uuid, p_direction text, p_amount_sats bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.p2p_account_transfers%ROWTYPE;
  v_frozen boolean;
  v_main_bal BIGINT;
  v_main_avail BIGINT;
  v_p2p_bal BIGINT;
  v_p2p_avail BIGINT;
  v_unmatured BIGINT;
  v_transfer_id UUID;
  v_result JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A user is required for a P2P account transfer';
  END IF;
  IF p_direction IS NULL OR p_direction NOT IN ('to_p2p', 'to_main') THEN
    RAISE EXCEPTION 'Transfer direction must be to_p2p or to_main';
  END IF;
  IF p_amount_sats IS NULL OR p_amount_sats <= 0 THEN
    RAISE EXCEPTION 'Enter an amount of Bitcoin to move — it must be more than zero.';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'An idempotency key is required for a P2P account transfer';
  END IF;

  -- Replay: a key that already moved money returns its result —
  -- with the balance fields refreshed to CURRENT balances (FIX-4:
  -- the stored snapshot described the moment of the ORIGINAL
  -- transfer, which misleads any caller reconciling from a replay).
  SELECT * INTO v_existing
    FROM public.p2p_account_transfers
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    SELECT w.balance_sats, w.available_sats INTO v_main_bal, v_main_avail
      FROM public.crypto_wallets w
     WHERE w.user_id = p_user_id AND w.asset = 'BTC';
    SELECT w.balance_sats, w.available_sats INTO v_p2p_bal, v_p2p_avail
      FROM public.p2p_wallets w
     WHERE w.user_id = p_user_id AND w.asset = 'BTC';
    RETURN v_existing.result || jsonb_build_object(
      'replayed', true,
      'main_balance_sats', COALESCE(v_main_bal, 0),
      'main_available_sats', COALESCE(v_main_avail, 0),
      'p2p_balance_sats', COALESCE(v_p2p_bal, 0),
      'p2p_available_sats', COALESCE(v_p2p_avail, 0));
  END IF;

  -- Freeze gate, BOTH directions (a pocket-to-pocket move is how
  -- value would leave the P2P account, so it is money-out for
  -- containment). profiles.is_frozen is the platform freeze state,
  -- switched only by admin_set_user_frozen. Fail-closed: an
  -- unverifiable status refuses, mirroring the edge guard.
  SELECT is_frozen INTO v_frozen
    FROM public.profiles
   WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'We couldn''t verify your account status just now, so this can''t be completed yet. Please try again in a moment.';
  END IF;
  IF v_frozen THEN
    RAISE EXCEPTION 'Your account is currently frozen, so this can''t be completed right now. Please contact support and we''ll help you get it sorted out.';
  END IF;

  -- Ensure both pockets exist, then lock in a fixed order (main
  -- first, P2P second) so concurrent transfers cannot deadlock.
  INSERT INTO public.crypto_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;
  INSERT INTO public.p2p_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT w.balance_sats, w.available_sats INTO v_main_bal, v_main_avail
    FROM public.crypto_wallets w
   WHERE w.user_id = p_user_id AND w.asset = 'BTC'
   FOR UPDATE;
  SELECT w.balance_sats, w.available_sats INTO v_p2p_bal, v_p2p_avail
    FROM public.p2p_wallets w
   WHERE w.user_id = p_user_id AND w.asset = 'BTC'
   FOR UPDATE;

  -- Replay re-check under the locks: a concurrent duplicate that
  -- raced the first check sees the committed ledger row here.
  SELECT * INTO v_existing
    FROM public.p2p_account_transfers
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- FIX-4: same current-balance refresh as the first replay branch;
    -- the locked reads above already hold the current values.
    RETURN v_existing.result || jsonb_build_object(
      'replayed', true,
      'main_balance_sats', v_main_bal,
      'main_available_sats', v_main_avail,
      'p2p_balance_sats', v_p2p_bal,
      'p2p_available_sats', v_p2p_avail);
  END IF;

  IF p_direction = 'to_p2p' THEN
    IF v_main_avail < p_amount_sats THEN
      RAISE EXCEPTION 'You don''t have that much Bitcoin available in your main wallet. Bitcoin that is locked in a trade or on hold can''t be moved — check your available balance and try a smaller amount.';
    END IF;
    v_main_bal := v_main_bal - p_amount_sats;
    v_main_avail := v_main_avail - p_amount_sats;
    v_p2p_bal := v_p2p_bal + p_amount_sats;
    v_p2p_avail := v_p2p_avail + p_amount_sats;
  ELSE
    -- Held sats cannot change pockets: the transferable ceiling is
    -- P2P available minus the unmatured T+1 holds.
    v_unmatured := public.p2p_unmatured_withdrawal_hold_sats(p_user_id);
    IF p_amount_sats > v_p2p_avail - v_unmatured THEN
      RAISE EXCEPTION 'Some of this Bitcoin is still inside the 24-hour safety hold from a recent trade, so it has to stay in your P2P account for now. You can move the rest today — check your transferable balance and try a smaller amount.';
    END IF;
    v_p2p_bal := v_p2p_bal - p_amount_sats;
    v_p2p_avail := v_p2p_avail - p_amount_sats;
    v_main_bal := v_main_bal + p_amount_sats;
    v_main_avail := v_main_avail + p_amount_sats;
  END IF;

  UPDATE public.crypto_wallets
     SET balance_sats = v_main_bal,
         available_sats = v_main_avail,
         updated_at = now()
   WHERE user_id = p_user_id AND asset = 'BTC';
  UPDATE public.p2p_wallets
     SET balance_sats = v_p2p_bal,
         available_sats = v_p2p_avail,
         updated_at = now()
   WHERE user_id = p_user_id AND asset = 'BTC';

  v_result := jsonb_build_object(
    'success', true,
    'direction', p_direction,
    'amount_sats', p_amount_sats,
    'main_balance_sats', v_main_bal,
    'main_available_sats', v_main_avail,
    'p2p_balance_sats', v_p2p_bal,
    'p2p_available_sats', v_p2p_avail);

  INSERT INTO public.p2p_account_transfers
    (user_id, direction, asset, amount_sats, idempotency_key, result)
  VALUES
    (p_user_id, p_direction, 'BTC', p_amount_sats, p_idempotency_key, v_result)
  RETURNING id INTO v_transfer_id;

  v_result := v_result || jsonb_build_object('transfer_id', v_transfer_id);
  UPDATE public.p2p_account_transfers
     SET result = v_result
   WHERE id = v_transfer_id;

  PERFORM public.p2p_write_audit(
    NULL, p_user_id, 'user', 'p2p_account_transfer',
    v_result || jsonb_build_object('idempotency_key', p_idempotency_key));

  RETURN v_result;
END;
$function$
