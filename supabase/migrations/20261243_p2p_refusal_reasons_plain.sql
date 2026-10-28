-- =====================================================================
-- 20261243_p2p_refusal_reasons_plain.sql
--
-- SWEEPB (pre-launch sweep, 2026-10-28): P2P refusal messages leaked
-- internal reason codes to users. A T0 (unverified) user attempting
-- to post an ad or open a trade was told, verbatim:
--   "You cannot post a sell ad yet: [\"kyc_required\"]"
--   "You cannot trade right now: [\"kyc_required\"]"
-- The bracketed array is the machine `reasons` list from
-- p2p_effective_limits — it breaks the standing crafted-error rule
-- (plain language, what happened, what to do next).
--
-- This migration adds public.p2p_reasons_plain(jsonb), which maps the
-- reason codes to plain sentences, and re-creates p2p_create_ad /
-- p2p_create_order with ONLY the three RAISE interpolations changed
-- to use it. The function bodies below are the live definitions
-- (pg_get_functiondef, 2026-10-28) with exactly those substitutions —
-- no logic, gate, fee or escrow behaviour changes. CREATE OR REPLACE
-- preserves the existing ACLs ({postgres, service_role}).
-- =====================================================================

-- Maps the machine reason codes in p2p_effective_limits' `reasons`
-- array to plain language for user-facing refusal messages. Before
-- this helper, p2p_create_ad / p2p_create_order interpolated the raw
-- array into the exception text, so an unverified user was told:
--   You cannot trade right now: ["kyc_required"]
-- — an internal code where the crafted-error rule requires plain
-- language saying what happened and what to do next.
CREATE OR REPLACE FUNCTION public.p2p_reasons_plain(p_reasons jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_out text[] := ARRAY[]::text[];
  v_r text;
BEGIN
  IF p_reasons IS NULL OR jsonb_typeof(p_reasons) <> 'array' THEN
    RETURN 'some requirements are not met yet — check your verification status in Settings';
  END IF;
  FOR v_r IN SELECT jsonb_array_elements_text(p_reasons) LOOP
    v_out := array_append(v_out, CASE
      WHEN v_r = 'kyc_required' THEN 'you need to complete identity verification first — finish KYC in Settings, then try again'
      WHEN v_r = 'marketplace_paused' THEN 'P2P trading is paused right now'
      WHEN v_r = 'account_too_new' THEN 'your account is less than 24 hours old — P2P opens a day after you sign up'
      WHEN v_r = 'identity_review_hold' THEN 'your account is being reviewed — trading opens again once the review finishes'
      WHEN v_r = 'daily_order_cap_reached' THEN 'you have reached today''s order limit'
      WHEN v_r LIKE 'sanctioned_rung_%' THEN 'a trading restriction is active on your account — contact support'
      WHEN v_r = 'new_trader_limits' THEN 'new-trader limits apply to your account'
      ELSE 'some requirements are not met yet — check your verification status in Settings' END);
  END LOOP;
  IF array_length(v_out, 1) IS NULL THEN
    RETURN 'some requirements are not met yet — check your verification status in Settings';
  END IF;
  RETURN array_to_string(v_out, '; ');
END;
$function$;

REVOKE ALL ON FUNCTION public.p2p_reasons_plain(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_reasons_plain(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_reasons_plain(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_reasons_plain(jsonb) TO service_role;

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
        public.p2p_reasons_plain(v_limits -> 'reasons');
    END IF;
  ELSE
    IF NOT COALESCE((v_limits ->> 'can_trade')::boolean, false) THEN
      RAISE EXCEPTION 'You cannot post ads yet: %',
        public.p2p_reasons_plain(v_limits -> 'reasons');
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
$function$

CREATE OR REPLACE FUNCTION public.p2p_create_order(p_taker_id uuid, p_ad_id uuid, p_fiat_amount_zmw numeric DEFAULT NULL::numeric, p_crypto_amount_minor bigint DEFAULT NULL::bigint, p_seller_payment_method_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_taker_ack_offmarket boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing public.p2p_orders%ROWTYPE;
  v_replay jsonb;
  v_ad public.p2p_ads%ROWTYPE;
  v_snapshot public.p2p_price_snapshots%ROWTYPE;
  v_stale_minutes integer := 5;
  v_taker_limits jsonb;
  v_advertiser_limits jsonb;
  v_seller_id uuid;
  v_buyer_id uuid;
  v_advertiser_id uuid;
  v_price numeric;
  v_fiat numeric;
  v_crypto bigint;
  v_remaining_minor bigint;
  v_method public.p2p_payment_methods%ROWTYPE;
  v_method_snapshot jsonb;
  v_order public.p2p_orders%ROWTYPE;
  v_result jsonb;
  v_pair_today integer := 0;
  v_buyer_paid_marked integer := 0;
  v_buyer_cancels_today integer := 0;
  v_disputes_lost_30d integer := 0;
  v_median_completed numeric;
BEGIN
  -- Idempotent replay (§2.3 invariant 4): the create key is
  -- unique on the order row; a retry returns the ORIGINAL
  -- outcome and creates nothing.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.p2p_orders
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.taker_id <> p_taker_id THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      v_replay := public.p2p_idem_replay(v_existing.id, 'order_created', p_idempotency_key);
      IF v_replay IS NOT NULL THEN
        RETURN v_replay;
      END IF;
      RETURN jsonb_build_object('success', true, 'replayed', true,
                                'order', to_jsonb(v_existing));
    END IF;
  END IF;

  -- Delta-audit D1: per-user advisory transaction locks for BOTH
  -- parties, taken in a deterministic (sorted) order BEFORE any
  -- limit is read. The caps below are read-then-act (daily totals,
  -- open-order counts, the pair cap); two concurrent creates for
  -- the same pair could each read "under the cap" and both land.
  -- The ad owner's id is read unlocked solely to key the locks —
  -- ad ownership never changes — and the authoritative FOR UPDATE
  -- read follows immediately. Locks release at transaction end.
  SELECT a.owner_id INTO v_advertiser_id
    FROM public.p2p_ads a
   WHERE a.id = p_ad_id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'p2p-order-user:' || LEAST(p_taker_id::text, v_advertiser_id::text), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'p2p-order-user:' || GREATEST(p_taker_id::text, v_advertiser_id::text), 0));
  END IF;

  SELECT * INTO v_ad
    FROM public.p2p_ads
   WHERE id = p_ad_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ad not found';
  END IF;
  IF v_ad.status <> 'active' THEN
    RAISE EXCEPTION 'This ad is not open for orders right now';
  END IF;
  IF v_ad.asset <> 'BTC' THEN
    RAISE EXCEPTION 'USDT trading is not available yet — P2P is Bitcoin-only for now';
  END IF;
  IF v_ad.owner_id = p_taker_id THEN
    RAISE EXCEPTION 'You cannot open an order on your own ad';
  END IF;

  -- Blocks (§3.4): no orders between a blocked pair, either way.
  IF EXISTS (
    SELECT 1 FROM public.p2p_blocks b
     WHERE (b.blocker_id = p_taker_id AND b.blocked_id = v_ad.owner_id)
        OR (b.blocker_id = v_ad.owner_id AND b.blocked_id = p_taker_id)
  ) THEN
    RAISE EXCEPTION 'Orders are not possible between you and this trader';
  END IF;

  -- Shared identity signals (§3.4(b), §3.8): counterparties who
  -- share an ID fingerprint / phone / payment account never
  -- trade — reputation farming and self-dealing die here.
  IF EXISTS (
    SELECT 1
      FROM public.p2p_identity_signals sa
      JOIN public.p2p_identity_signals sb
        ON sb.signal_type = sa.signal_type
       AND sb.signal_hash = sa.signal_hash
     WHERE sa.user_id = p_taker_id
       AND sb.user_id = v_ad.owner_id
  ) THEN
    PERFORM public.p2p_write_risk(p_taker_id, v_ad.owner_id, NULL,
      'shared_identity_signal', 25, jsonb_build_object('ad_id', v_ad.id));
    PERFORM public.p2p_write_risk(v_ad.owner_id, p_taker_id, NULL,
      'shared_identity_signal', 25, jsonb_build_object('ad_id', v_ad.id));
    RAISE EXCEPTION 'This trade is not allowed — the accounts share identity records and have been flagged for review';
  END IF;

  -- Gate BOTH parties through the one limits function (§3.3).
  v_taker_limits := public.p2p_effective_limits(p_taker_id);
  IF NOT COALESCE((v_taker_limits ->> 'can_trade')::boolean, false) THEN
    RAISE EXCEPTION 'You cannot trade right now: %',
      public.p2p_reasons_plain(v_taker_limits -> 'reasons');
  END IF;
  v_advertiser_limits := public.p2p_effective_limits(v_ad.owner_id);
  IF NOT COALESCE((v_advertiser_limits ->> 'can_trade')::boolean, false) THEN
    RAISE EXCEPTION 'This advertiser cannot trade right now — try another ad';
  END IF;

  -- Risk score (§3.8): at/above threshold, trading pauses for
  -- human review — stated to the user, never a shadow-ban.
  IF public.p2p_risk_score(p_taker_id) >= 100 THEN
    RAISE EXCEPTION 'Your P2P trading is paused for a safety review — contact support if you believe this is a mistake';
  END IF;
  IF public.p2p_risk_score(v_ad.owner_id) >= 100 THEN
    RAISE EXCEPTION 'This advertiser is under a safety review — try another ad';
  END IF;

  -- Price (§2.2): the index must be fresh and verified, for BOTH
  -- price types — never trade on a price we cannot verify.
  SELECT s.p2p_price_stale_minutes INTO v_stale_minutes
    FROM public.platform_settings s WHERE s.id;
  v_stale_minutes := COALESCE(v_stale_minutes, 5);

  SELECT * INTO v_snapshot
    FROM public.p2p_price_snapshots ps
   WHERE ps.asset = 'BTC'
   ORDER BY ps.created_at DESC
   LIMIT 1;

  IF NOT FOUND OR v_snapshot.is_stale
     OR v_snapshot.created_at < now() - make_interval(mins => v_stale_minutes) THEN
    RAISE EXCEPTION 'The BTC price index is stale right now — orders are paused until it recovers';
  END IF;

  IF v_ad.price_type = 'fixed' THEN
    v_price := v_ad.fixed_price_zmw;
  ELSE
    v_price := round(v_snapshot.index_zmw * (1 + v_ad.margin_percent / 100), 2);
  END IF;

  -- Bait warning (§3.8, §5.4 case 12): > 10% off index, the
  -- taker must explicitly acknowledge before the order opens.
  IF abs(v_price - v_snapshot.index_zmw) / v_snapshot.index_zmw > 0.10
     AND NOT COALESCE(p_taker_ack_offmarket, false) THEN
    RAISE EXCEPTION 'This ad is priced more than 10%% away from the market price — if you understand and want to continue, confirm the warning and try again';
  END IF;

  -- Amounts: exactly one of fiat / crypto is specified (§2.3).
  IF (p_fiat_amount_zmw IS NULL) = (p_crypto_amount_minor IS NULL) THEN
    RAISE EXCEPTION 'Specify either a ZMW amount or a BTC amount, not both';
  END IF;
  IF p_fiat_amount_zmw IS NOT NULL THEN
    v_fiat := round(p_fiat_amount_zmw, 2);
    v_crypto := floor(v_fiat / v_price * 100000000)::bigint;
  ELSE
    v_crypto := p_crypto_amount_minor;
    v_fiat := round(v_crypto::numeric / 100000000 * v_price, 2);
  END IF;
  IF v_crypto <= 0 OR v_fiat <= 0 THEN
    RAISE EXCEPTION 'The order amount is too small';
  END IF;
  IF v_fiat < v_ad.min_order_zmw OR v_fiat > v_ad.max_order_zmw THEN
    RAISE EXCEPTION 'Orders on this ad are between K% and K%', v_ad.min_order_zmw, v_ad.max_order_zmw;
  END IF;

  -- Remaining ad inventory (listings do not lock; orders do).
  SELECT v_ad.total_amount_minor - COALESCE(SUM(o.crypto_amount_minor), 0)
    INTO v_remaining_minor
    FROM public.p2p_orders o
   WHERE o.ad_id = v_ad.id
     AND o.status IN ('escrow_locked', 'paid_marked', 'disputed', 'completed');
  IF v_crypto > COALESCE(v_remaining_minor, v_ad.total_amount_minor) THEN
    RAISE EXCEPTION 'This ad does not have enough remaining amount for that order';
  END IF;

  -- Amount gates against BOTH parties' limits (§3.3).
  IF v_fiat > (v_taker_limits ->> 'max_order_zmw')::numeric THEN
    RAISE EXCEPTION 'That amount is above your per-order limit of K%', v_taker_limits ->> 'max_order_zmw';
  END IF;
  IF v_fiat > (v_advertiser_limits ->> 'max_order_zmw')::numeric THEN
    RAISE EXCEPTION 'That amount is above the advertiser''s per-order limit';
  END IF;
  IF v_fiat > (v_taker_limits ->> 'daily_remaining_zmw')::numeric THEN
    RAISE EXCEPTION 'That order would exceed your remaining daily limit of K%', v_taker_limits ->> 'daily_remaining_zmw';
  END IF;
  IF v_fiat > (v_advertiser_limits ->> 'daily_remaining_zmw')::numeric THEN
    RAISE EXCEPTION 'That order would exceed the advertiser''s remaining daily limit';
  END IF;

  -- Velocity hard caps (§3.3): open orders and orders/day come
  -- from the limits payload; the pair cap, the fake-paid brake,
  -- the cancels tariff and the dispute brakes are computed here.
  IF (v_taker_limits ->> 'open_orders')::integer >= (v_taker_limits ->> 'max_open_orders')::integer THEN
    RAISE EXCEPTION 'You already have the maximum of % open orders — finish or cancel one first', v_taker_limits ->> 'max_open_orders';
  END IF;
  IF (v_advertiser_limits ->> 'open_orders')::integer >= (v_advertiser_limits ->> 'max_open_orders')::integer THEN
    RAISE EXCEPTION 'This advertiser already has the maximum number of open orders';
  END IF;

  IF v_ad.side = 'sell_crypto' THEN
    v_seller_id := v_ad.owner_id;
    v_buyer_id := p_taker_id;
  ELSE
    v_seller_id := p_taker_id;
    v_buyer_id := v_ad.owner_id;
  END IF;

  SELECT COUNT(*) INTO v_pair_today
    FROM public.p2p_orders o
   WHERE ((o.taker_id = p_taker_id AND o.advertiser_id = v_ad.owner_id)
       OR (o.taker_id = v_ad.owner_id AND o.advertiser_id = p_taker_id))
     AND o.status IN ('escrow_locked', 'paid_marked', 'disputed', 'completed')
     AND o.created_at >= date_trunc('day', now());
  IF v_pair_today >= 3 THEN
    RAISE EXCEPTION 'You have reached today''s limit of 3 orders with the same trader';
  END IF;

  SELECT COUNT(*) INTO v_buyer_paid_marked
    FROM public.p2p_orders o
   WHERE o.fiat_buyer_id = v_buyer_id
     AND o.status = 'paid_marked';
  IF v_buyer_paid_marked > 5 THEN
    RAISE EXCEPTION 'Too many paid-but-unreleased orders — new orders are paused until some complete';
  END IF;

  -- OKX tariff (§3.9 amendment): 3 buyer cancels in a day stops
  -- buying for the rest of that day.
  SELECT COUNT(*) INTO v_buyer_cancels_today
    FROM public.p2p_orders o
   WHERE o.fiat_buyer_id = v_buyer_id
     AND o.status = 'cancelled_unpaid'
     AND o.cancelled_at >= date_trunc('day', now());
  IF v_buyer_cancels_today >= 3 THEN
    RAISE EXCEPTION 'You cancelled 3 orders today — buying is paused until tomorrow';
  END IF;

  -- Dispute brakes (§3.6, §3.8): an open dispute suspends new
  -- orders above K500 for BOTH parties; > 3 disputes lost in 30
  -- days pauses a trader pending review.
  IF v_fiat > 500 AND EXISTS (
    SELECT 1
      FROM public.p2p_disputes d
      JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.status = 'open'
       AND (o.advertiser_id IN (p_taker_id, v_ad.owner_id)
            OR o.taker_id IN (p_taker_id, v_ad.owner_id))
  ) THEN
    RAISE EXCEPTION 'A dispute is open on an existing trade — orders above K500 are paused until it is resolved';
  END IF;

  SELECT COUNT(*) INTO v_disputes_lost_30d
    FROM public.p2p_disputes d
    JOIN public.p2p_orders o ON o.id = d.order_id
   WHERE d.ruled_at >= now() - interval '30 days'
     AND d.status IN ('ruled_release', 'ruled_refund', 'negotiated_release', 'negotiated_refund')
     AND ((d.status IN ('ruled_release', 'negotiated_release') AND o.crypto_seller_id = p_taker_id)
       OR (d.status IN ('ruled_refund', 'negotiated_refund') AND o.fiat_buyer_id = p_taker_id));
  IF v_disputes_lost_30d > 3 THEN
    RAISE EXCEPTION 'Your P2P trading is paused pending review after several lost disputes';
  END IF;

  -- The ad's counterparty requirements (§2.1) bind the taker.
  IF public.p2p_tier_rank(v_taker_limits ->> 'tier')
       < public.p2p_tier_rank(v_ad.min_counterparty_tier) THEN
    RAISE EXCEPTION 'This advertiser requires a % verified account or higher', v_ad.min_counterparty_tier;
  END IF;
  IF COALESCE((SELECT t.trades_completed
                 FROM public.p2p_trader_profiles t
                WHERE t.user_id = p_taker_id), 0) < v_ad.min_counterparty_trades THEN
    RAISE EXCEPTION 'This advertiser requires at least % completed trades', v_ad.min_counterparty_trades;
  END IF;

  -- First 5 completed trades (§3.3): new traders pair only with
  -- established (T2+) advertisers while they learn the flow.
  IF COALESCE((SELECT t.trades_completed
                 FROM public.p2p_trader_profiles t
                WHERE t.user_id = p_taker_id), 0) < 5
     AND public.p2p_tier_rank(v_advertiser_limits ->> 'tier') < 2 THEN
    RAISE EXCEPTION 'While you are new, you can only trade with fully verified (T2+) advertisers';
  END IF;

  -- The seller's receiving method comes FROM THE REGISTRY (§2.4),
  -- never typed per-order: for a sell ad it is the advertiser's
  -- primary active method of an accepted type; for a buy ad the
  -- taker-seller names their own registered method explicitly.
  IF v_ad.side = 'sell_crypto' THEN
    SELECT * INTO v_method
      FROM public.p2p_payment_methods m
     WHERE m.user_id = v_seller_id
       AND m.status = 'active'
       AND m.type = ANY (v_ad.payment_method_types)
     ORDER BY m.is_primary DESC, m.created_at ASC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The advertiser has no active payment method for this ad';
    END IF;
  ELSE
    IF p_seller_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'Choose the registered payment method you want to receive payment on';
    END IF;
    SELECT * INTO v_method
      FROM public.p2p_payment_methods m
     WHERE m.id = p_seller_payment_method_id;
    IF NOT FOUND OR v_method.user_id <> v_seller_id OR v_method.status <> 'active' THEN
      RAISE EXCEPTION 'That payment method is not one of your active registered methods';
    END IF;
    IF NOT (v_method.type = ANY (v_ad.payment_method_types)) THEN
      RAISE EXCEPTION 'That payment method type is not accepted by this ad';
    END IF;
  END IF;

  v_method_snapshot := jsonb_build_object(
    'method_id', v_method.id,
    'type', v_method.type,
    'account_number', v_method.account_number,
    'account_name', v_method.account_name,
    'bank_name', v_method.bank_name);

  -- Create the order, then LOCK — one transaction (§2.3). If the
  -- lock raises (insufficient available), everything above rolls
  -- back with it: no order exists and no payment details were
  -- ever returned.
  BEGIN
    INSERT INTO public.p2p_orders (
      ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
      asset, crypto_amount_minor, fiat_amount_zmw, price_zmw, index_snapshot,
      payment_method_snapshot, settle_delay_minutes, status, expires_at,
      idempotency_key
    ) VALUES (
      v_ad.id, v_ad.owner_id, p_taker_id, v_seller_id, v_buyer_id,
      'BTC', v_crypto, v_fiat, v_price,
      jsonb_build_object('index_zmw', v_snapshot.index_zmw,
                         'snapshot_id', v_snapshot.id,
                         'captured_at', v_snapshot.created_at,
                         'sources', v_snapshot.sources),
      v_method_snapshot, v_ad.settle_delay_minutes, 'escrow_locked',
      now() + make_interval(mins => v_ad.payment_window_minutes),
      p_idempotency_key
    )
    RETURNING * INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent create with the same key won the race: return
    -- its outcome instead of duplicating the order.
    SELECT * INTO v_existing
      FROM public.p2p_orders
     WHERE idempotency_key = p_idempotency_key;
    IF v_existing.taker_id <> p_taker_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    v_replay := public.p2p_idem_replay(v_existing.id, 'order_created', p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
    RETURN jsonb_build_object('success', true, 'replayed', true,
                              'order', to_jsonb(v_existing));
  END;

  PERFORM public.p2p_lock_crypto_btc(v_order.id, v_seller_id, v_buyer_id, v_crypto);

  v_result := jsonb_build_object(
    'success', true,
    'order', to_jsonb(v_order),
    'payment_method_snapshot', v_method_snapshot);

  PERFORM public.p2p_write_audit(v_order.id, p_taker_id, 'user', 'order_created',
    jsonb_build_object('ad_id', v_ad.id, 'fiat_amount_zmw', v_fiat,
                       'crypto_amount_minor', v_crypto, 'price_zmw', v_price,
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_write_audit(v_order.id, NULL, 'system', 'escrow_locked',
    jsonb_build_object('amount_minor', v_crypto, 'asset', 'BTC'));

  PERFORM public.p2p_system_message(v_order.id,
    'Escrow locked: ' || trim(to_char(v_crypto::numeric / 100000000, 'FM0.00000000'))
    || ' BTC is held by BMaGlass Pay until the seller confirms payment.');
  PERFORM public.p2p_system_message(v_order.id,
    'Stay safe: only pay the account shown on this order. Never trust a screenshot — the seller must check inside their own account. BMaGlass staff will never message you inside a trade, never ask you to cancel or release, and never ask you to move to WhatsApp. Anyone claiming to be support here is a scammer — report them.');

  -- Unusual amount (§3.8 soft signal): > 3x the taker's median
  -- completed order.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.fiat_amount_zmw)
    INTO v_median_completed
    FROM public.p2p_orders o
   WHERE (o.taker_id = p_taker_id OR o.advertiser_id = p_taker_id)
     AND o.status = 'completed';
  IF v_median_completed IS NOT NULL AND v_median_completed > 0
     AND v_fiat > 3 * v_median_completed THEN
    PERFORM public.p2p_write_risk(p_taker_id, v_ad.owner_id, v_order.id,
      'unusual_amount', 10,
      jsonb_build_object('fiat_amount_zmw', v_fiat, 'median_completed_zmw', v_median_completed));
  END IF;

  PERFORM public.p2p_eval_fraud_rules(p_taker_id, v_ad.owner_id, v_order.id, v_fiat);

  -- An ad whose remaining amount is fully committed is exhausted.
  IF v_crypto >= COALESCE(v_remaining_minor, v_ad.total_amount_minor) THEN
    UPDATE public.p2p_ads
       SET status = 'exhausted', updated_at = now()
     WHERE id = v_ad.id;
  END IF;

  RETURN v_result;
END;
$function$
