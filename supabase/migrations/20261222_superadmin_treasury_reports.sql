-- =====================================================================
-- 20261222_superadmin_treasury_reports.sql — Superadmin Treasury &
-- Reports console (CEO order 2026-10-26).
--
-- THE GAP: the admin dashboard showed headline counts and the
-- transactions console listed rows, but there was no single place
-- where the platform owner could see the PLATFORM's money: the
-- platform wallet balances, the customer funds the platform holds,
-- the fee income by rail, and filterable reports that reconcile
-- with the ledger. This migration adds the read side of that
-- console: server-side aggregates behind SECURITY DEFINER functions,
-- gated to super_admin INSIDE the functions (the admin_list_users /
-- admin_analytics_summary pattern), so a non-super_admin gets
-- nothing even by calling the RPCs directly.
--
-- READ-SIDE ONLY: no settlement function, payment-link code or
-- existing object is touched. Everything below is a NEW object.
--
-- PLATFORM OPERATOR: fees across every rail credit "the platform":
-- the earliest-created user_roles 'admin' holder (the resolver every
-- fee RPC uses — execute_send_money_transfer, the transfer-fee RPC,
-- execute_payment_link_settlement, p2p_release_crypto_btc).
-- treasury_platform_user_id() replicates that resolver exactly.
--
-- FEE INCOME MAPPING (what counts as fee income, per rail — the
-- sources are DISJOINT, no fee is counted twice):
--   payment_link  public.transactions rows ON the platform user,
--                 direction 'incoming', status 'completed',
--                 category 'platform_fee' (written by
--                 execute_payment_link_settlement; description
--                 'Platform fee — payment link: <title>').
--   send_money    platform incoming 'completed' rows, category
--                 'transfer_fee', description prefix
--                 'Send fee for transfer to ' (written by
--                 execute_send_money_transfer).
--   transfer      platform incoming 'completed' rows, category
--                 'transfer_fee', description prefix
--                 'Transfer fee for transfer to ' (written by the
--                 atomic-transfer fee leg).
--   card_funding  SUM(fee_amount) over completed 'card_funding'
--                 rows (any user). fund-virtual-card charges the
--                 fee on top of the funding amount and records it
--                 as fee_amount on the user's funding row; it does
--                 NOT write a platform-wallet receipt row, so the
--                 funding rows are the system of record for this fee.
--   btc_trade     SUM(fee_zmw) over EXECUTED quotes
--                 (btc_quotes.consumed_at in window). The instant
--                 buy/sell fee is a spread against the platform
--                 treasury (btc_execute_trade), recorded on the
--                 quote; no platform-wallet ledger row exists.
--   p2p           SUM(fee_minor) in sats over RELEASED escrow
--                 holds (p2p_escrow_holds.status = 'released',
--                 settled_at in window). p2p_release_crypto_btc
--                 credits the fee straight to the platform's crypto
--                 wallet; fee_minor on the hold is the record.
-- LIMITS of the mapping:
--   * send vs transfer rests on the description prefix the two
--     RPCs write; both are pinned by tests. Any platform incoming
--     'platform_fee'/'transfer_fee' row matching NEITHER pattern
--     lands in the 'other_platform_fee' bucket so receipts always
--     reconcile — nothing silently vanishes.
--   * Only 'completed' ledger rows count as receipts; fee rows are
--     written completed by every rail above.
--   * card_funding / btc_trade / p2p figures are fees CHARGED /
--     EARNED per their source records; the first two rails' fees
--     are not separately credited to a platform wallet by their
--     code paths today (documented product behaviour, not a
--     reporting invention).
--
-- WINDOWS: [p_from, p_to) — start inclusive, end exclusive, the
-- analytics_summary convention. Balances are current-state and do
-- not depend on the window.
--
-- ACL: entry points REVOKE from PUBLIC and anon, GRANT EXECUTE to
-- authenticated; the gate inside does the real work. Impl and
-- helper functions are revoked from everyone (owner-only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: the platform operator (earliest-created 'admin' holder).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.treasury_platform_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT ur.user_id
  FROM public.user_roles ur
  WHERE ur.role = 'admin'
  ORDER BY ur.created_at, ur.user_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.treasury_platform_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_platform_user_id() FROM anon;
REVOKE ALL ON FUNCTION public.treasury_platform_user_id() FROM authenticated;

-- ---------------------------------------------------------------------
-- Overview impl: balances (current) + fees and metrics (windowed).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.treasury_overview_impl(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_platform uuid := public.treasury_platform_user_id();
  v_result jsonb;
BEGIN
  WITH
  platform_fiat AS (
    SELECT w.currency, SUM(w.balance) AS balance, COUNT(*)::int AS wallets
    FROM public.wallets w
    WHERE w.user_id = v_platform
    GROUP BY w.currency
  ),
  user_fiat AS (
    SELECT w.currency, SUM(w.balance) AS balance, COUNT(*)::int AS wallets
    FROM public.wallets w
    WHERE v_platform IS NOT NULL AND w.user_id <> v_platform
    GROUP BY w.currency
  ),
  fee_receipts AS (
    SELECT
      CASE
        WHEN t.category = 'platform_fee' THEN 'payment_link'
        WHEN t.category = 'transfer_fee'
             AND t.description LIKE 'Send fee for transfer to %' THEN 'send_money'
        WHEN t.category = 'transfer_fee'
             AND t.description LIKE 'Transfer fee for transfer to %' THEN 'transfer'
        ELSE 'other_platform_fee'
      END AS rail,
      t.currency AS currency,
      SUM(t.amount) AS amount,
      NULL::bigint AS amount_sats,
      COUNT(*)::int AS n
    FROM public.transactions t
    WHERE t.user_id = v_platform
      AND t.direction = 'incoming'
      AND t.status = 'completed'
      AND t.category IN ('platform_fee', 'transfer_fee')
      AND t.created_at >= p_from AND t.created_at < p_to
    GROUP BY 1, 2
  ),
  fee_card AS (
    SELECT 'card_funding'::text AS rail, t.currency,
           SUM(t.fee_amount) AS amount, NULL::bigint AS amount_sats,
           COUNT(*)::int AS n
    FROM public.transactions t
    WHERE t.category = 'card_funding'
      AND t.status = 'completed'
      AND COALESCE(t.fee_amount, 0) > 0
      AND t.created_at >= p_from AND t.created_at < p_to
    GROUP BY 1, 2
  ),
  fee_btc_trade AS (
    SELECT 'btc_trade'::text AS rail, 'ZMW'::text AS currency,
           SUM(q.fee_zmw) AS amount, NULL::bigint AS amount_sats,
           COUNT(*)::int AS n
    FROM public.btc_quotes q
    WHERE q.consumed_at IS NOT NULL
      AND q.consumed_at >= p_from AND q.consumed_at < p_to
    GROUP BY 1, 2
  ),
  fee_p2p AS (
    SELECT 'p2p'::text AS rail, 'BTC'::text AS currency,
           NULL::numeric AS amount, SUM(h.fee_minor) AS amount_sats,
           COUNT(*)::int AS n
    FROM public.p2p_escrow_holds h
    WHERE h.status = 'released'
      AND h.fee_minor > 0
      AND h.settled_at >= p_from AND h.settled_at < p_to
    GROUP BY 1, 2
  ),
  fees AS (
    SELECT * FROM fee_receipts
    UNION ALL SELECT * FROM fee_card
    UNION ALL SELECT * FROM fee_btc_trade
    UNION ALL SELECT * FROM fee_p2p
  ),
  tx_window AS (
    SELECT t.* FROM public.transactions t
    WHERE t.created_at >= p_from AND t.created_at < p_to
  ),
  by_status AS (
    SELECT tw.status, tw.currency, COUNT(*)::int AS n, SUM(tw.amount) AS volume
    FROM tx_window tw GROUP BY 1, 2
  ),
  by_type AS (
    SELECT COALESCE(tw.category, 'uncategorized') AS category, tw.currency,
           COUNT(*)::int AS n,
           COALESCE(SUM(tw.amount) FILTER (WHERE tw.status = 'completed'), 0) AS completed_volume
    FROM tx_window tw GROUP BY 1, 2
  ),
  volume AS (
    SELECT tw.currency, COUNT(*)::int AS n,
           COALESCE(SUM(tw.amount) FILTER (WHERE tw.status = 'completed'), 0) AS completed_volume
    FROM tx_window tw GROUP BY 1
  )
  SELECT jsonb_build_object(
    'platform_user_id', v_platform,
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'balances', jsonb_build_object(
      'platform_fiat', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'currency', pf.currency, 'balance', pf.balance, 'wallets', pf.wallets)
               ORDER BY pf.currency)
        FROM platform_fiat pf), '[]'::jsonb),
      'platform_btc_sats', COALESCE((
        SELECT SUM(c.balance_sats) FROM public.crypto_wallets c
        WHERE c.user_id = v_platform AND c.asset = 'BTC'), 0),
      'btc_treasury_float_sats', COALESCE((
        SELECT t.float_sats FROM public.btc_treasury t WHERE t.id = 1), 0),
      'user_fiat', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'currency', uf.currency, 'balance', uf.balance, 'wallets', uf.wallets)
               ORDER BY uf.currency)
        FROM user_fiat uf), '[]'::jsonb),
      'user_btc_sats', COALESCE((
        SELECT SUM(c.balance_sats) FROM public.crypto_wallets c
        WHERE v_platform IS NOT NULL AND c.user_id <> v_platform
          AND c.asset = 'BTC'), 0)
    ),
    'fees', jsonb_build_object(
      'by_rail', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'rail', f.rail, 'currency', f.currency,
                 'amount', f.amount, 'amount_sats', f.amount_sats,
                 'count', f.n)
               ORDER BY f.rail, f.currency)
        FROM fees f), '[]'::jsonb),
      'totals', COALESCE((
        SELECT jsonb_agg(x ORDER BY x.currency) FROM (
          SELECT fs.currency,
                 SUM(fs.amount) AS amount,
                 SUM(fs.amount_sats) AS amount_sats,
                 SUM(fs.n)::int AS count
          FROM fees fs GROUP BY fs.currency
        ) x), '[]'::jsonb)
    ),
    'metrics', jsonb_build_object(
      'tx_count', (SELECT COUNT(*)::int FROM tx_window),
      'by_status', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'status', bs.status, 'currency', bs.currency,
                 'count', bs.n, 'volume', bs.volume)
               ORDER BY bs.status, bs.currency)
        FROM by_status bs), '[]'::jsonb),
      'by_type', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'category', bt.category, 'currency', bt.currency,
                 'count', bt.n, 'completed_volume', bt.completed_volume)
               ORDER BY bt.category, bt.currency)
        FROM by_type bt), '[]'::jsonb),
      'volume', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'currency', v.currency, 'count', v.n,
                 'completed_volume', v.completed_volume)
               ORDER BY v.currency)
        FROM volume v), '[]'::jsonb),
      'new_users', (
        SELECT COUNT(*)::int FROM public.profiles p
        WHERE p.created_at >= p_from AND p.created_at < p_to),
      'users_total', (SELECT COUNT(*)::int FROM public.profiles),
      'wallets_total', (SELECT COUNT(*)::int FROM public.wallets),
      'wallets_active', (
        SELECT COUNT(*)::int FROM public.wallets w WHERE w.status = 'active'),
      'wallets_transacting', (
        SELECT COUNT(DISTINCT tw.wallet_id)::int FROM tx_window tw
        WHERE tw.wallet_id IS NOT NULL)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.treasury_overview_impl(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_overview_impl(timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.treasury_overview_impl(timestamptz, timestamptz) FROM authenticated;

-- ---------------------------------------------------------------------
-- Overview entry point: super_admin gate, then delegate.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.treasury_overview(
  p_from timestamptz,
  p_to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can view treasury data';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'A valid reporting period is required';
  END IF;
  RETURN public.treasury_overview_impl(p_from, p_to);
END;
$$;

REVOKE ALL ON FUNCTION public.treasury_overview(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_overview(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.treasury_overview(timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------
-- Report impl: filterable, paginated transactions + filtered totals.
-- Totals sum COMPLETED rows of the filtered set (money that actually
-- moved), split by direction; "total" counts every filtered row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.treasury_report_impl(
  p_from timestamptz,
  p_to timestamptz,
  p_currency text,
  p_category text,
  p_status text,
  p_direction text,
  p_search text,
  p_limit integer,
  p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 1000);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_search text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_result jsonb;
BEGIN
  WITH filtered AS (
    SELECT t.*, p.first_name, p.last_name, u.email AS user_email
    FROM public.transactions t
    LEFT JOIN public.profiles p ON p.id = t.user_id
    LEFT JOIN auth.users u ON u.id = t.user_id
    WHERE (p_from IS NULL OR t.created_at >= p_from)
      AND (p_to IS NULL OR t.created_at < p_to)
      AND (p_currency IS NULL OR t.currency = p_currency)
      AND (p_category IS NULL
           OR COALESCE(t.category, 'uncategorized') = p_category)
      AND (p_status IS NULL OR t.status = p_status)
      AND (p_direction IS NULL OR t.direction = p_direction)
      AND (v_search IS NULL OR (
             t.recipient_name ILIKE '%' || v_search || '%'
          OR t.reference ILIKE '%' || v_search || '%'
          OR t.transaction_id ILIKE '%' || v_search || '%'
          OR t.uuid_id::text ILIKE '%' || v_search || '%'
          OR t.description ILIKE '%' || v_search || '%'
          OR (COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, ''))
               ILIKE '%' || v_search || '%'
          OR u.email ILIKE '%' || v_search || '%'
      ))
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*)::int FROM filtered),
    'totals', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.currency) FROM (
        SELECT f.currency,
               COUNT(*)::int AS count,
               COALESCE(SUM(f.amount) FILTER (
                 WHERE f.status = 'completed' AND f.direction = 'incoming'), 0) AS incoming,
               COALESCE(SUM(f.amount) FILTER (
                 WHERE f.status = 'completed' AND f.direction = 'outgoing'), 0) AS outgoing
        FROM filtered f GROUP BY f.currency
      ) x), '[]'::jsonb),
    'rows', COALESCE((
      SELECT jsonb_agg(r ORDER BY r.created_at DESC, r.id DESC) FROM (
        SELECT f.id, f.uuid_id, f.transaction_id, f.created_at,
               f.user_id,
               NULLIF(btrim(COALESCE(f.first_name, '') || ' ' ||
                            COALESCE(f.last_name, '')), '') AS user_name,
               f.user_email,
               f.direction, f.amount, f.fee_amount, f.currency, f.status,
               COALESCE(f.category, 'uncategorized') AS category,
               f.payment_method, f.provider, f.recipient_name,
               f.reference, f.description
        FROM filtered f
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT v_limit OFFSET v_offset
      ) r), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.treasury_report_impl(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_report_impl(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.treasury_report_impl(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM authenticated;

-- ---------------------------------------------------------------------
-- Report entry point: super_admin gate, then delegate.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.treasury_report(
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_direction text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can view treasury data';
  END IF;
  RETURN public.treasury_report_impl(
    p_from, p_to, p_currency, p_category, p_status, p_direction,
    p_search, p_limit, p_offset);
END;
$$;

REVOKE ALL ON FUNCTION public.treasury_report(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.treasury_report(timestamptz, timestamptz, text, text, text, text, text, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.treasury_report(timestamptz, timestamptz, text, text, text, text, text, integer, integer) TO authenticated;

-- ---------------------------------------------------------------------
-- Indexes for the aggregate/report access paths (new objects only;
-- transactions already carries created_at / status / user indexes).
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_transactions_category_created
  ON public.transactions (category, created_at);
CREATE INDEX IF NOT EXISTS idx_btc_quotes_consumed
  ON public.btc_quotes (consumed_at);
CREATE INDEX IF NOT EXISTS idx_p2p_holds_status_settled
  ON public.p2p_escrow_holds (status, settled_at);
