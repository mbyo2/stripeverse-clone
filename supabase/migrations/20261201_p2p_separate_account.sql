-- =====================================================================
-- 20261201_p2p_separate_account.sql
--
-- Binance-style separate P2P account (CEO directive, 2026-10-24):
-- like Binance's funding account, P2P trades run from a DEDICATED
-- P2P wallet. Users move BTC main wallet -> P2P account before
-- trading; sells lock from the P2P account, buys credit the P2P
-- account, and the main wallet (public.crypto_wallets) is never
-- read or written by the trade path again.
--
-- WHAT THIS MIGRATION DOES
--   1. public.p2p_wallets — mirrors crypto_wallets semantics
--      (one row per (user, asset); balance_sats + available_sats)
--      with the wallet invariant as table CHECKs from birth:
--      balance >= 0, available >= 0, available <= balance.
--      RLS on, owner SELECT only, NO client writes.
--   2. public.p2p_account_transfers — the exactly-once ledger for
--      pocket-to-pocket moves (UNIQUE (user_id, idempotency_key);
--      a replay returns the stored result, never moves twice).
--   3. public.p2p_adjust_p2p_wallet — the p2p_wallets twin of
--      btc_adjust_crypto_wallet (upsert + row lock + non-negative),
--      service_role only.
--   4. public.p2p_account_transfer — the ONLY way sats change
--      pockets. Row-locked in a fixed order (main, then P2P),
--      FREE (own pockets), freeze-gated in BOTH directions
--      (profiles.is_frozen, the admin_set_user_frozen state), and
--      to_main is capped at P2P available MINUS unmatured T+1
--      holds (p2p_unmatured_withdrawal_hold_sats) — held sats
--      cannot change pockets. Audit row per transfer.
--   5. The trade money path is re-pointed at p2p_wallets:
--      p2p_lock_crypto_btc, p2p_unlock_crypto_btc,
--      p2p_release_crypto_btc (the delta-audit version, incl. the
--      fee-range assert), the p2p_create_ad inventory read, and
--      p2p_reconcile_escrow. Function bodies below are the LIVE
--      definitions with only the wallet source swapped.
--      The 0.5% completion fee now lands in the platform
--      operator's P2P wallet (it is P2P revenue; the operator
--      moves it to their main wallet with a normal transfer).
--
-- DELIBERATELY UNCHANGED
--   * btc_reserve_withdrawal still subtracts unmatured T+1 holds
--     on the main-wallet on-chain withdrawal path. With the
--     to_main cap, held sats can no longer reach the main wallet
--     before maturity, so that subtraction is now a conservative
--     second gate rather than the only one. Rewriting the
--     withdrawal path is out of scope for this change.
--   * Existing escrow holds/orders keep their meaning: a hold's
--     sats were reserved out of the seller's wallet at lock time;
--     from this migration on, locks reserve out of p2p_wallets.
--     (At apply time the marketplace is paused with no locked
--     holds outstanding — verified in the deploy spot-checks.)
-- =====================================================================

-- ── 1. p2p_wallets ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.p2p_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  asset TEXT NOT NULL DEFAULT 'BTC',
  balance_sats BIGINT NOT NULL DEFAULT 0,
  available_sats BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, asset),
  CONSTRAINT p2p_wallets_balance_nonneg CHECK (balance_sats >= 0),
  CONSTRAINT p2p_wallets_available_nonneg CHECK (available_sats >= 0),
  CONSTRAINT p2p_wallets_available_within_balance
    CHECK (available_sats <= balance_sats)
);

ALTER TABLE public.p2p_wallets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own p2p wallets"
  ON public.p2p_wallets;
CREATE POLICY "Users can view their own p2p wallets"
ON public.p2p_wallets FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
-- No INSERT / UPDATE / DELETE policies exist for any client role:
-- p2p_wallets rows are written only by the service-role RPCs below.

DROP TRIGGER IF EXISTS update_p2p_wallets_updated_at
  ON public.p2p_wallets;
CREATE TRIGGER update_p2p_wallets_updated_at
BEFORE UPDATE ON public.p2p_wallets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ── 2. p2p_account_transfers (exactly-once ledger) ─────────────────
CREATE TABLE IF NOT EXISTS public.p2p_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  direction TEXT NOT NULL
    CONSTRAINT p2p_account_transfers_direction
    CHECK (direction IN ('to_p2p', 'to_main')),
  asset TEXT NOT NULL DEFAULT 'BTC',
  amount_sats BIGINT NOT NULL
    CONSTRAINT p2p_account_transfers_amount_positive
    CHECK (amount_sats > 0),
  idempotency_key TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_p2p_account_transfers_user_created
  ON public.p2p_account_transfers (user_id, created_at DESC);

ALTER TABLE public.p2p_account_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own p2p transfers"
  ON public.p2p_account_transfers;
CREATE POLICY "Users can view their own p2p transfers"
ON public.p2p_account_transfers FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));
-- No client write policies: rows are written only by
-- p2p_account_transfer (SECURITY DEFINER, service_role execute).

-- ── 3. p2p_adjust_p2p_wallet ─────────────────────────────────────────
-- The p2p_wallets twin of btc_adjust_crypto_wallet: upsert the row,
-- lock it, refuse any adjustment that would drive balance or
-- available negative (the table CHECKs additionally pin
-- available <= balance on every write).
CREATE OR REPLACE FUNCTION public.p2p_adjust_p2p_wallet(
  p_user_id UUID,
  p_delta_balance BIGINT,
  p_delta_available BIGINT
)
RETURNS TABLE(balance_sats BIGINT, available_sats BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance BIGINT;
  v_available BIGINT;
BEGIN
  INSERT INTO public.p2p_wallets (user_id, asset, balance_sats, available_sats)
  VALUES (p_user_id, 'BTC', 0, 0)
  ON CONFLICT (user_id, asset) DO NOTHING;

  SELECT w.balance_sats, w.available_sats INTO v_balance, v_available
  FROM public.p2p_wallets w
  WHERE w.user_id = p_user_id AND w.asset = 'BTC'
  FOR UPDATE;

  IF v_balance + p_delta_balance < 0 OR v_available + p_delta_available < 0 THEN
    RAISE EXCEPTION 'Insufficient BTC balance';
  END IF;

  UPDATE public.p2p_wallets AS w
  SET balance_sats = w.balance_sats + p_delta_balance,
      available_sats = w.available_sats + p_delta_available,
      updated_at = now()
  WHERE w.user_id = p_user_id AND w.asset = 'BTC'
  RETURNING w.balance_sats, w.available_sats
  INTO v_balance, v_available;

  balance_sats := v_balance;
  available_sats := v_available;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_adjust_p2p_wallet(UUID, BIGINT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_adjust_p2p_wallet(UUID, BIGINT, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_adjust_p2p_wallet(UUID, BIGINT, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_adjust_p2p_wallet(UUID, BIGINT, BIGINT) TO service_role;

-- ── 4. p2p_account_transfer ──────────────────────────────────────────
-- The only door between the two pockets. Exactly-once: the ledger
-- row (UNIQUE (user_id, idempotency_key)) is written in the same
-- transaction as the balance moves, and a replay — including a
-- concurrent duplicate that waited on the wallet row locks —
-- returns the stored result without moving anything.
CREATE OR REPLACE FUNCTION public.p2p_account_transfer(
  p_user_id UUID,
  p_direction TEXT,
  p_amount_sats BIGINT,
  p_idempotency_key TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Replay: a key that already moved money returns its result.
  SELECT * INTO v_existing
    FROM public.p2p_account_transfers
   WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN v_existing.result || jsonb_build_object('replayed', true);
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
    RETURN v_existing.result || jsonb_build_object('replayed', true);
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
$$;

REVOKE ALL ON FUNCTION public.p2p_account_transfer(UUID, TEXT, BIGINT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_account_transfer(UUID, TEXT, BIGINT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_account_transfer(UUID, TEXT, BIGINT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_account_transfer(UUID, TEXT, BIGINT, TEXT) TO service_role;

-- ── 5. Trade money path re-pointed at p2p_wallets ───────────────────
-- The five definitions below are the LIVE bodies (extracted with
-- pg_get_functiondef at authoring time) with ONLY the wallet source
-- changed: btc_adjust_crypto_wallet -> p2p_adjust_p2p_wallet in
-- lock / unlock / release, and the inventory + reconciliation reads
-- moved from crypto_wallets to p2p_wallets. CREATE OR REPLACE
-- preserves each function's existing ACL (postgres + service_role);
-- the REVOKE/GRANT lines after each are re-asserted for safety.
CREATE OR REPLACE FUNCTION public.p2p_lock_crypto_btc(p_order_id uuid, p_seller_id uuid, p_buyer_id uuid, p_amount_minor bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hold_id uuid;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Lock amount must be positive';
  END IF;

  PERFORM public.p2p_adjust_p2p_wallet(p_seller_id, 0, -p_amount_minor);

  INSERT INTO public.p2p_escrow_holds (order_id, seller_id, buyer_id, asset, amount_minor)
  VALUES (p_order_id, p_seller_id, p_buyer_id, 'BTC', p_amount_minor)
  RETURNING id INTO v_hold_id;

  RETURN v_hold_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_unlock_crypto_btc(p_order_id uuid, p_settlement text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hold public.p2p_escrow_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_hold
    FROM public.p2p_escrow_holds
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow hold not found for this order';
  END IF;
  IF v_hold.status <> 'locked' THEN
    RAISE EXCEPTION 'Escrow hold is not locked (status %)', v_hold.status;
  END IF;

  PERFORM public.p2p_adjust_p2p_wallet(v_hold.seller_id, 0, v_hold.amount_minor);

  UPDATE public.p2p_escrow_holds
     SET status = 'unlocked',
         settlement = p_settlement,
         settled_at = now()
   WHERE id = v_hold.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_release_crypto_btc(p_order_id uuid, p_settlement text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hold public.p2p_escrow_holds%ROWTYPE;
  v_fee_percent numeric := 0;
  v_fee_minor bigint := 0;
  v_platform_user uuid;
  v_hold_hours integer := 24;
BEGIN
  SELECT * INTO v_hold
    FROM public.p2p_escrow_holds
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow hold not found for this order';
  END IF;
  IF v_hold.status <> 'locked' THEN
    RAISE EXCEPTION 'Escrow hold is not locked (status %)', v_hold.status;
  END IF;

  -- Fee (§2.5): completed trades only, read from settings with
  -- the defensive default the platform pattern uses (0 if the row
  -- is somehow missing — the commercial decision never blocks a
  -- settlement that has already been agreed).
  SELECT COALESCE(s.p2p_fee_percent, 0), COALESCE(s.p2p_withdrawal_hold_hours, 24)
    INTO v_fee_percent, v_hold_hours
    FROM public.platform_settings s
   WHERE s.id;
  IF NOT FOUND THEN
    v_fee_percent := 0;
    v_hold_hours := 24;
  END IF;

  -- Delta-audit D9: the CHECK on platform_settings makes an
  -- out-of-range fee unwritable; this assert is the second line —
  -- a release must never silently compute from a bad value.
  IF v_fee_percent < 0 OR v_fee_percent > 100 THEN
    RAISE EXCEPTION 'The P2P fee setting is invalid — releases are paused until it is corrected';
  END IF;

  IF v_fee_percent > 0 THEN
    v_fee_minor := floor(v_hold.amount_minor * v_fee_percent / 100)::bigint;
  END IF;

  IF v_fee_minor > 0 THEN
    -- The platform operator: earliest-created admin (finding 3).
    SELECT ur.user_id INTO v_platform_user
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
     ORDER BY ur.created_at, ur.user_id
     LIMIT 1;

    IF v_platform_user IS NULL
       OR v_platform_user = v_hold.seller_id
       OR v_platform_user = v_hold.buyer_id THEN
      -- No platform operator yet, or the operator IS a party:
      -- no fee (mirrors execute_payment_link_settlement).
      v_fee_minor := 0;
    END IF;
  END IF;

  PERFORM public.p2p_adjust_p2p_wallet(v_hold.seller_id, -v_hold.amount_minor, 0);
  PERFORM public.p2p_adjust_p2p_wallet(
    v_hold.buyer_id, v_hold.amount_minor - v_fee_minor, v_hold.amount_minor - v_fee_minor);
  IF v_fee_minor > 0 THEN
    PERFORM public.p2p_adjust_p2p_wallet(v_platform_user, v_fee_minor, v_fee_minor);
  END IF;

  UPDATE public.p2p_escrow_holds
     SET status = 'released',
         fee_minor = v_fee_minor,
         settlement = p_settlement,
         settled_at = now()
   WHERE id = v_hold.id;

  -- T+1 withdrawal hold on the buyer's net credit (§3.8
  -- amendment; finding 5).
  INSERT INTO public.p2p_withdrawal_holds (user_id, order_id, asset, amount_minor, matures_at)
  VALUES (v_hold.buyer_id, p_order_id, v_hold.asset,
          v_hold.amount_minor - v_fee_minor,
          now() + make_interval(hours => v_hold_hours));

  RETURN v_fee_minor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_create_ad(p_owner_id uuid, p_side text, p_asset text, p_price_type text, p_fixed_price_zmw numeric DEFAULT NULL::numeric, p_margin_percent numeric DEFAULT NULL::numeric, p_total_amount_minor bigint DEFAULT NULL::bigint, p_min_order_zmw numeric DEFAULT NULL::numeric, p_max_order_zmw numeric DEFAULT NULL::numeric, p_payment_method_types text[] DEFAULT ARRAY[]::text[], p_payment_window_minutes integer DEFAULT 30, p_settle_delay_minutes integer DEFAULT 0, p_terms text DEFAULT NULL::text, p_min_counterparty_tier text DEFAULT 'T1'::text, p_min_counterparty_trades integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limits jsonb;
  v_ad public.p2p_ads%ROWTYPE;
  v_snapshot public.p2p_price_snapshots%ROWTYPE;
  v_stale_minutes integer := 5;
  v_price numeric;
  v_band_factor numeric := 0.25;
  v_trades integer := 0;
  v_counterparties integer := 0;
  v_available_sats bigint := 0;
  v_total_value numeric;
  v_ad_max_cap numeric;
  v_has_snapshot boolean := false;
  v_off_market boolean := false;
BEGIN
  -- BTC only (CEO decision 2026-10-23): USDT is a designed
  -- refusal, not an error of the caller's making.
  IF p_asset = 'USDT' THEN
    RAISE EXCEPTION 'USDT trading is not available yet — P2P is Bitcoin-only for now';
  END IF;
  IF p_asset <> 'BTC' THEN
    RAISE EXCEPTION 'Unsupported asset: %', p_asset;
  END IF;
  IF p_side NOT IN ('sell_crypto', 'buy_crypto') THEN
    RAISE EXCEPTION 'Invalid ad side: %', p_side;
  END IF;
  IF p_price_type NOT IN ('fixed', 'margin') THEN
    RAISE EXCEPTION 'Invalid price type: %', p_price_type;
  END IF;
  IF p_price_type = 'fixed'
     AND (p_fixed_price_zmw IS NULL OR p_fixed_price_zmw <= 0) THEN
    RAISE EXCEPTION 'A fixed price is required for a fixed-price ad';
  END IF;
  IF p_price_type = 'margin'
     AND (p_margin_percent IS NULL OR p_margin_percent < -30 OR p_margin_percent > 30) THEN
    RAISE EXCEPTION 'Margin must be between -30%% and +30%%';
  END IF;
  IF p_total_amount_minor IS NULL OR p_total_amount_minor <= 0 THEN
    RAISE EXCEPTION 'The ad amount must be positive';
  END IF;
  IF p_min_order_zmw IS NULL OR p_min_order_zmw < 10 THEN
    RAISE EXCEPTION 'The minimum order is K10';
  END IF;
  IF p_max_order_zmw IS NULL OR p_max_order_zmw < p_min_order_zmw THEN
    RAISE EXCEPTION 'The maximum order must be at least the minimum order';
  END IF;
  IF p_payment_window_minutes NOT IN (15, 30, 45, 60, 120) THEN
    RAISE EXCEPTION 'Payment window must be 15, 30, 45, 60 or 120 minutes';
  END IF;
  IF p_settle_delay_minutes IS NULL OR p_settle_delay_minutes < 0 OR p_settle_delay_minutes > 1440 THEN
    RAISE EXCEPTION 'Settle delay must be between 0 and 1440 minutes';
  END IF;
  IF p_payment_method_types IS NULL OR array_length(p_payment_method_types, 1) IS NULL THEN
    RAISE EXCEPTION 'Choose at least one payment method type';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_payment_method_types) AS t
     WHERE t NOT IN ('mobile_money', 'bank')
  ) THEN
    RAISE EXCEPTION 'Unsupported payment method type in ad';
  END IF;
  IF p_min_counterparty_tier NOT IN ('T1', 'T2', 'T3') THEN
    RAISE EXCEPTION 'Invalid minimum counterparty tier';
  END IF;

  -- Terms scan (§3.7): phone-like digit runs, URLs, and the
  -- off-platform solicitation keywords are refused at posting.
  IF p_terms IS NOT NULL AND (
       length(regexp_replace(p_terms, '\D', '', 'g')) >= 9
       OR p_terms ~* 'https?://|www\.|wa\.me|whatsapp|telegram'
  ) THEN
    RAISE EXCEPTION 'Ad terms cannot contain contact details or links — trades stay inside BMaGlass Pay';
  END IF;

  v_limits := public.p2p_effective_limits(p_owner_id);

  IF p_side = 'sell_crypto' THEN
    IF NOT COALESCE((v_limits ->> 'can_post_ads')::boolean, false) THEN
      RAISE EXCEPTION 'You cannot post a sell ad yet: %',
        COALESCE(v_limits ->> 'reasons', 'requirements not met');
    END IF;
  ELSE
    IF NOT COALESCE((v_limits ->> 'can_trade')::boolean, false) THEN
      RAISE EXCEPTION 'You cannot post ads yet: %',
        COALESCE(v_limits ->> 'reasons', 'requirements not met');
    END IF;
  END IF;

  -- The advertiser must actually hold a registered, active
  -- payment method of a type the ad names (§2.4): sellers receive
  -- only on registered methods; buyers pay only from them.
  IF NOT EXISTS (
    SELECT 1
      FROM public.p2p_payment_methods m
     WHERE m.user_id = p_owner_id
       AND m.status = 'active'
       AND m.type = ANY (p_payment_method_types)
  ) THEN
    RAISE EXCEPTION 'Register an active payment method of the chosen type before posting this ad';
  END IF;

  -- Current index (margin pricing + sell inventory valuation +
  -- the off-market badge). A margin ad cannot be priced without
  -- a trustworthy index (§2.2).
  SELECT s.p2p_price_stale_minutes INTO v_stale_minutes
    FROM public.platform_settings s WHERE s.id;
  v_stale_minutes := COALESCE(v_stale_minutes, 5);

  SELECT * INTO v_snapshot
    FROM public.p2p_price_snapshots ps
   WHERE ps.asset = 'BTC'
   ORDER BY ps.created_at DESC
   LIMIT 1;
  v_has_snapshot := FOUND;

  IF p_price_type = 'margin' THEN
    IF NOT v_has_snapshot OR v_snapshot.is_stale
       OR v_snapshot.created_at < now() - make_interval(mins => v_stale_minutes) THEN
      RAISE EXCEPTION 'The BTC price index is unavailable right now — margin ads cannot be posted until it recovers';
    END IF;
    v_price := round(v_snapshot.index_zmw * (1 + p_margin_percent / 100), 2);
  ELSE
    v_price := p_fixed_price_zmw;
  END IF;

  IF p_side = 'sell_crypto' THEN
    -- Advertiser band (finding 7): completed trades AND unique
    -- counterparties grow the ad's max-order cap toward the tier
    -- ceiling.
    SELECT t.trades_completed INTO v_trades
      FROM public.p2p_trader_profiles t
     WHERE t.user_id = p_owner_id;
    v_trades := COALESCE(v_trades, 0);
    v_counterparties := public.p2p_distinct_counterparties(p_owner_id);

    IF v_trades >= 75 AND v_counterparties >= 40 THEN
      v_band_factor := 1.0;
    ELSIF v_trades >= 30 AND v_counterparties >= 20 THEN
      v_band_factor := 0.75;
    ELSIF v_trades >= 15 AND v_counterparties >= 10 THEN
      v_band_factor := 0.50;
    ELSE
      v_band_factor := 0.25;
    END IF;

    v_ad_max_cap := floor((v_limits ->> 'max_order_zmw')::numeric * v_band_factor);
    IF p_max_order_zmw > v_ad_max_cap THEN
      RAISE EXCEPTION 'Your current trader band caps an ad''s maximum order at K% — complete more trades with more counterparties to raise it', v_ad_max_cap;
    END IF;

    -- Inventory (§2.1): a sell ad is backed by the seller's
    -- AVAILABLE balance at posting (re-checked at every order).
    SELECT COALESCE(c.available_sats, 0) INTO v_available_sats
      FROM public.p2p_wallets c
     WHERE c.user_id = p_owner_id AND c.asset = 'BTC';
    v_available_sats := COALESCE(v_available_sats, 0);
    v_total_value := p_total_amount_minor::numeric * v_price / 100000000;
    IF v_total_value > v_available_sats::numeric * v_price / 100000000 THEN
      RAISE EXCEPTION 'This ad is larger than the Bitcoin you currently have available';
    END IF;
  END IF;

  INSERT INTO public.p2p_ads (
    owner_id, side, asset, price_type, fixed_price_zmw, margin_percent,
    total_amount_minor, min_order_zmw, max_order_zmw, payment_method_types,
    payment_window_minutes, settle_delay_minutes, terms,
    min_counterparty_tier, min_counterparty_trades
  ) VALUES (
    p_owner_id, p_side, 'BTC', p_price_type, p_fixed_price_zmw, p_margin_percent,
    p_total_amount_minor, p_min_order_zmw, p_max_order_zmw, p_payment_method_types,
    p_payment_window_minutes, p_settle_delay_minutes, p_terms,
    p_min_counterparty_tier, COALESCE(p_min_counterparty_trades, 0)
  )
  RETURNING * INTO v_ad;

  PERFORM public.p2p_write_audit(NULL, p_owner_id, 'user', 'ad_created',
    jsonb_build_object('ad_id', v_ad.id, 'side', v_ad.side, 'asset', 'BTC',
                       'price_zmw', v_price));

  -- Bait pricing (§3.8): > 10% off index posts, but is flagged —
  -- the badge warns takers and the pattern feeds sanctions.
  v_off_market := v_has_snapshot AND NOT v_snapshot.is_stale
                  AND v_snapshot.index_zmw > 0
                  AND abs(v_price - v_snapshot.index_zmw) / v_snapshot.index_zmw > 0.10;
  IF v_off_market THEN
    PERFORM public.p2p_write_risk(p_owner_id, NULL, NULL, 'off_market_ad', 10,
      jsonb_build_object('ad_id', v_ad.id, 'price_zmw', v_price,
                         'index_zmw', v_snapshot.index_zmw));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ad', to_jsonb(v_ad),
    'price_zmw', v_price,
    'off_market', v_off_market);
END;
$function$;

CREATE OR REPLACE FUNCTION public.p2p_reconcile_escrow()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_locked_sum bigint:= 0;
  v_locked_count integer:= 0;
  v_wallet_gap bigint:= 0;
  v_orphans integer:= 0;
  v_missing integer:= 0;
  v_invariant_violations integer:= 0;
  v_report jsonb;
BEGIN
  SELECT COALESCE(SUM(h.amount_minor), 0), COUNT(*)
    INTO v_locked_sum, v_locked_count
    FROM public.p2p_escrow_holds h
   WHERE h.status = 'locked' AND h.asset = 'BTC';

  SELECT COALESCE(SUM(c.balance_sats - c.available_sats), 0)
    INTO v_wallet_gap
    FROM public.p2p_wallets c
   WHERE c.asset = 'BTC';

  SELECT COUNT(*) INTO v_orphans
    FROM public.p2p_escrow_holds h
    JOIN public.p2p_orders o ON o.id = h.order_id
   WHERE h.status = 'locked'
     AND o.status IN ('completed', 'refunded', 'cancelled_unpaid', 'expired_unpaid');

  SELECT COUNT(*) INTO v_missing
    FROM public.p2p_orders o
    LEFT JOIN public.p2p_escrow_holds h
      ON h.order_id = o.id AND h.status = 'locked'
   WHERE o.status IN ('escrow_locked', 'paid_marked', 'disputed')
     AND h.id IS NULL;


  SELECT COUNT(*) INTO v_invariant_violations
    FROM public.p2p_wallets c
   WHERE c.asset = 'BTC'
     AND (c.balance_sats < 0 OR c.available_sats < 0
          OR c.available_sats > c.balance_sats);

  v_report:= jsonb_build_object(
    'asset', 'BTC',
    'locked_holds_sats', v_locked_sum,
    'locked_hold_count', v_locked_count,
    'wallet_gap_sats', v_wallet_gap,
    'drift_sats', v_wallet_gap - v_locked_sum,
    'wallet_source', 'p2p_wallets',
    'invariant_violations', v_invariant_violations,
    'orphan_holds', v_orphans,
    'open_orders_without_locked_hold', v_missing,
    'reconciled_at', now());

  PERFORM public.p2p_write_audit(NULL, NULL, 'system', 'escrow_reconciled', v_report);

  RETURN v_report;
END;
$function$;

-- Grant re-assertions for the re-pointed functions (ACLs are
-- preserved by CREATE OR REPLACE; these keep the repo convention
-- of stating the intended grants next to each definition).
REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) TO service_role;

REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_release_crypto_btc(uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.p2p_reconcile_escrow() TO service_role;
-- p2p_create_ad keeps its existing ACL (service_role execute,
-- asserted by the Phase 1a migration and unchanged by CREATE OR
-- REPLACE).
