-- =====================================================================
-- 20261211_p2p_sell_ads_t2_open.sql
--
-- CEO POLICY DECISION (2026-10-24 19:26, P2P go-live): "Fully
-- verified (T2) users can post sell ads immediately — keep limits,
-- escrow and sanctions."
--
-- p2p_effective_limits' advertiser gate previously ALSO required
-- account age >= 14 days, >= 5 completed trades AS BUYER, and being
-- outside the first-7-days-after-verification window. On a new
-- marketplace those conjuncts deadlock the cold start: nobody has 5
-- buyer trades, so nobody can post the first sell ad (proven by the
-- go-live gauntlet). This migration removes exactly those three
-- conjuncts from can_post_ads:
--
--   can_post_ads = p2p_enabled (v_enabled)
--                  AND tier IN ('T2','T3')
--                  AND can_trade
--                  AND sanction_level < 2
--
-- NOTHING else changes: daily caps, max-order limits, the
-- new-trader limit modifiers (first-7-days caps, first-5-trades
-- max-order cap), can_trade logic, sanctions, the identity-review
-- hold, and every output field keep byte-equivalent behaviour.
-- CREATE OR REPLACE preserves the function's ACL
-- ({postgres, service_role}).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.p2p_effective_limits(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier text;
  v_enabled boolean := false;
  v_cooldown_hours integer := 24;
  v_account_created_at timestamptz;
  v_verified_at timestamptz;
  v_trades_completed integer := 0;
  v_trades_as_buyer integer := 0;
  v_daily_cap numeric := 0;
  v_max_order numeric := 0;
  v_orders_day_cap integer := 20;  -- §3.3 velocity hard cap: 20 orders/day
  v_max_open_orders integer := 5;  -- §3.3 velocity hard cap: 5 open orders
  v_daily_used numeric := 0;
  v_open_orders integer := 0;
  v_orders_today integer := 0;
  v_can_trade boolean := true;
  v_can_post_ads boolean := false;
  v_trade_hold boolean := false;
  v_hold_reason text;
  v_reasons text[] := ARRAY[]::text[];
  v_sanction_level integer;
BEGIN
  v_tier := public.p2p_kyc_tier(p_user_id);

  -- Settings (wide single-row table; established read pattern — a
  -- missing row falls back to paused + 24h cooldown).
  SELECT COALESCE(s.p2p_enabled, false),
         COALESCE(s.p2p_new_account_cooldown_hours, 24)
    INTO v_enabled, v_cooldown_hours
    FROM public.platform_settings s
   WHERE s.id;
  IF NOT FOUND THEN
    v_enabled := false;
    v_cooldown_hours := 24;
  END IF;

  SELECT u.created_at
    INTO v_account_created_at
    FROM auth.users u
   WHERE u.id = p_user_id;

  SELECT k.verified_at
    INTO v_verified_at
    FROM public.kyc_verifications k
   WHERE k.user_id = p_user_id;

  SELECT t.trades_completed, t.trades_as_buyer
    INTO v_trades_completed, v_trades_as_buyer
    FROM public.p2p_trader_profiles t
   WHERE t.user_id = p_user_id;
  IF NOT FOUND THEN
    v_trades_completed := 0;
    v_trades_as_buyer := 0;
  END IF;

  -- Tier rights (§3.2 launch defaults; constants by design — the
  -- settings-tunable values are the ones with settings columns).
  IF v_tier = 'T1' THEN
    v_daily_cap := 2000;
    v_max_order := 1000;
  ELSIF v_tier = 'T2' THEN
    v_daily_cap := 50000;
    v_max_order := 10000;
  ELSIF v_tier = 'T3' THEN
    v_daily_cap := 250000;
    v_max_order := 100000;
  ELSE
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'kyc_required');
  END IF;

  -- Master switch (§4.1): ops can pause the whole marketplace
  -- without a deploy; while paused, nobody trades.
  IF NOT v_enabled THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'marketplace_paused');
  END IF;

  -- Account-age cooldown (§3.3): no P2P at all before it (default
  -- 24h, from platform_settings.p2p_new_account_cooldown_hours).
  IF v_account_created_at IS NULL
     OR now() - v_account_created_at < make_interval(hours => v_cooldown_hours) THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'account_too_new');
  END IF;

  -- First 7 days after T1 (§3.3): daily cap K500, max 3
  -- orders/day. (Cap modifiers only — sell-ad eligibility is
  -- decided solely by the advertiser gate below.)
  IF v_verified_at IS NOT NULL
     AND now() < v_verified_at + interval '7 days' THEN
    v_daily_cap := LEAST(v_daily_cap, 500);
    v_orders_day_cap := LEAST(v_orders_day_cap, 3);
    v_reasons := array_append(v_reasons, 'new_trader_limits');
  END IF;

  -- First 5 completed trades (§3.3): max order K500.
  IF v_trades_completed < 5 THEN
    v_max_order := LEAST(v_max_order, 500);
  END IF;

  -- Today's usage / open orders / orders today, from the real
  -- p2p_orders (Phase 1: the guard Phase 0 shipped is removed;
  -- filters and attribution unchanged from the guarded branch).
  SELECT COALESCE(SUM(o.fiat_amount_zmw)
             FILTER (WHERE o.status IN ('escrow_locked', 'paid_marked', 'completed')), 0),
         COALESCE(COUNT(*) FILTER (WHERE o.status IN ('escrow_locked', 'paid_marked')), 0),
         COALESCE(COUNT(*), 0)
    INTO v_daily_used, v_open_orders, v_orders_today
    FROM public.p2p_orders o
   WHERE (o.taker_id = p_user_id OR o.advertiser_id = p_user_id)
     AND o.created_at >= date_trunc('day', now());

  IF v_orders_today >= v_orders_day_cap THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'daily_order_cap_reached');
  END IF;

  -- Sanctions (§3.9): the highest ACTIVE, in-window rung in p2p or
  -- platform scope governs. Expired / revoked / not-yet-started
  -- rows are ignored. Rung 1+ pauses trading; rung 2+ also kills
  -- ads (advertiser gate below).
  SELECT MAX(s.level)
    INTO v_sanction_level
    FROM public.user_sanctions s
   WHERE s.user_id = p_user_id
     AND s.status = 'active'
     AND s.scope IN ('p2p', 'platform')
     AND s.starts_at <= now()
     AND (s.expires_at IS NULL OR s.expires_at > now());

  IF COALESCE(v_sanction_level, 0) >= 1 THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'sanctioned_rung_' || v_sanction_level::text);
  END IF;

  -- Identity-review hold (§3.2 / §4.1): a pending review whose 72h
  -- hold is still running freezes trading until a human clears it.
  IF EXISTS (
    SELECT 1
      FROM public.p2p_reviews r
     WHERE r.user_id = p_user_id
       AND r.status = 'pending'
       AND r.hold_until IS NOT NULL
       AND r.hold_until > now()
  ) THEN
    v_trade_hold := true;
    v_hold_reason := 'identity_review_hold';
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'identity_review_hold');
  END IF;

  -- Advertiser gate (§3.3, CEO decision 2026-10-24): T2+ with
  -- trading itself allowed and no rung >= 2 sanction. The former
  -- conjuncts — account age >= 14 days, >= 5 completed trades AS
  -- BUYER, and the first-7-days exclusion — are REMOVED: a fully
  -- verified (T2) user may post sell ads immediately, so the
  -- marketplace can bootstrap its first sell-side liquidity. The
  -- graduated money limits above, escrow, and the sanctions
  -- ladder are unchanged.
  -- (The completed-trade / unique-counterparty bands that grow AD
  -- limits above this floor are enforced in p2p_create_ad, where
  -- the ad's own caps are set — header finding 7.)
  v_can_post_ads :=
       v_enabled
       AND v_tier IN ('T2', 'T3')
       AND v_can_trade
       AND COALESCE(v_sanction_level, 0) < 2;

  RETURN jsonb_build_object(
    'tier', v_tier,
    'can_trade', v_can_trade,
    'can_post_ads', v_can_post_ads,
    'max_order_zmw', v_max_order,
    'daily_cap_zmw', v_daily_cap,
    'daily_used_zmw', v_daily_used,
    'daily_remaining_zmw', GREATEST(v_daily_cap - v_daily_used, 0),
    'max_open_orders', v_max_open_orders,
    'open_orders', v_open_orders,
    'orders_today', v_orders_today,
    'orders_day_cap', v_orders_day_cap,
    'trade_hold', v_trade_hold,
    'hold_reason', v_hold_reason,
    'reasons', to_jsonb(v_reasons)
  );
END;
$function$
