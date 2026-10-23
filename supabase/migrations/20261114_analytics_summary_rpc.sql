-- =====================================================================
-- 20261114_analytics_summary_rpc.sql — scalability fix #4
--
-- Server-side analytics aggregation (audit 2026-10-23, fix #4).
--
-- THE PROBLEM: src/pages/Analytics.tsx pulled up to .limit(5000)
-- transaction rows into the browser and aggregated client-side.
-- PostgREST's default max-rows (1,000) silently truncated the pull,
-- so the page was both slow AND wrong for any user with >1,000
-- transactions in the fetch window. The fetch window itself (365
-- days) also silently emptied the "previous period" comparison for
-- the 1-year view, whose previous window is 365–730 days back.
--
-- THE FIX: aggregation moves into Postgres. Both public entry points
-- below delegate to ONE internal implementation
-- (analytics_summary_impl), so the numbers the admin console and the
-- user page show are the same computation by construction:
--
--   admin_analytics_summary(p_from, p_to) — PLATFORM-WIDE summary.
--     Gate (inside the function, the admin_list_users pattern):
--     admin OR super_admin via public.has_role, otherwise raises
--     'Only an admin can view platform analytics'.
--   get_user_analytics(p_from, p_to) — the caller's OWN summary,
--     scoped to user_id = auth.uid(). This is what Analytics.tsx
--     calls: the page is a per-user page ("your transactions",
--     business + admin roles), so its figures stay the signed-in
--     user's own — only the computation moves server-side.
--
-- AGGREGATE DEFINITIONS — copied exactly from the page's previous
-- client-side computation (Analytics.tsx before this migration):
--   window        created_at >= p_from AND created_at < p_to
--                 (the page's inWindow: start inclusive, end
--                 exclusive; NULL created_at never counted)
--   revenue       SUM(amount) WHERE direction = 'incoming'
--                 AND status = 'completed' AND currency = 'ZMW'
--   sent          SUM(amount) WHERE direction = 'outgoing'
--                 AND status = 'completed' AND currency = 'ZMW'
--   success rate  completed_count / tx_count (computed client-side
--                 from the returned counts, as before)
--   counterparties  currency = 'ZMW' AND recipient_name non-empty
--                 (the page's JS truthiness test), grouped by
--                 recipient_name, top 5 by volume; the response also
--                 carries counterparty_total_volume — the share
--                 denominator over ALL named ZMW counterparties in
--                 the window, exactly as the page computed it.
-- Money is numeric, rounded to 2dp where the page's currency
-- formatting rounded. by_* volumes are SUM(amount) over every row in
-- the group (all statuses), matching the page's count-based method
-- distribution (counts) and extending it with volume as specced.
--
-- BUCKETING: monthly and daily series are bucketed in Africa/Lusaka
-- (the platform's home timezone). The old page bucketed in the
-- viewer's browser-local time — identical for the platform's
-- Zambian users; pinning the timezone server-side makes the series
-- deterministic instead of viewer-dependent. Buckets intersecting
-- the window are zero-filled (generate_series + LEFT JOIN).
-- One deliberate correction: the old page's monthly buckets were
-- built from `new Date()` with only setDate(1) applied, so each
-- "month" actually spanned the 1st at the viewer's time-of-day to
-- the next 1st at the same time — a row on the 1st before that
-- time was reported in the previous month. The RPC buckets true
-- calendar months, which is what the page's labels always claimed.
--
-- ACL (the admin_list_users pattern): the two entry points REVOKE
-- from PUBLIC and anon and GRANT EXECUTE to authenticated — the
-- authorisation gate lives INSIDE the functions. The internal
-- helper is revoked from every client role; only the two SECURITY
-- DEFINER wrappers (running as owner) can reach it.
-- =====================================================================

-- ── Internal implementation (NOT a client entry point) ─────────────
CREATE OR REPLACE FUNCTION public.analytics_summary_impl(
  p_from timestamptz,
  p_to timestamptz,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  WITH base AS (
    SELECT
      t.amount,
      t.currency,
      t.status,
      t.direction,
      t.payment_method,
      t.recipient_name,
      (t.created_at AT TIME ZONE 'Africa/Lusaka') AS local_ts
    FROM public.transactions t
    WHERE t.created_at >= p_from
      AND t.created_at < p_to
      AND (p_user_id IS NULL OR t.user_id = p_user_id)
  ),
  totals AS (
    SELECT
      count(*)::bigint AS tx_count,
      count(*) FILTER (WHERE status = 'completed')::bigint AS completed_count,
      count(*) FILTER (WHERE status = 'failed')::bigint AS failed_count,
      round(coalesce(sum(amount) FILTER (
        WHERE direction = 'incoming' AND status = 'completed' AND currency = 'ZMW'
      ), 0), 2) AS revenue_zmw,
      round(coalesce(sum(amount) FILTER (
        WHERE direction = 'outgoing' AND status = 'completed' AND currency = 'ZMW'
      ), 0), 2) AS sent_zmw
    FROM base
  ),
  by_status AS (
    SELECT status, count(*)::bigint AS n, round(sum(amount), 2) AS volume
    FROM base GROUP BY status
  ),
  by_direction AS (
    SELECT direction, count(*)::bigint AS n, round(sum(amount), 2) AS volume
    FROM base GROUP BY direction
  ),
  by_method AS (
    SELECT payment_method, count(*)::bigint AS n, round(sum(amount), 2) AS volume
    FROM base GROUP BY payment_method
  ),
  by_currency AS (
    SELECT currency, count(*)::bigint AS n, round(sum(amount), 2) AS volume
    FROM base GROUP BY currency
  ),
  months AS (
    SELECT generate_series(
      date_trunc('month', (p_from AT TIME ZONE 'Africa/Lusaka')),
      date_trunc('month', ((p_to - interval '1 microsecond') AT TIME ZONE 'Africa/Lusaka')),
      interval '1 month'
    ) AS m_start
  ),
  month_agg AS (
    SELECT
      date_trunc('month', local_ts) AS m_start,
      count(*)::bigint AS n,
      round(coalesce(sum(amount) FILTER (
        WHERE direction = 'incoming' AND status = 'completed' AND currency = 'ZMW'
      ), 0), 2) AS revenue,
      count(*) FILTER (WHERE status = 'completed')::bigint AS successful,
      count(*) FILTER (WHERE status = 'failed')::bigint AS failed
    FROM base GROUP BY 1
  ),
  days AS (
    SELECT generate_series(
      date_trunc('day', (p_from AT TIME ZONE 'Africa/Lusaka')),
      date_trunc('day', ((p_to - interval '1 microsecond') AT TIME ZONE 'Africa/Lusaka')),
      interval '1 day'
    ) AS d_start
  ),
  day_agg AS (
    SELECT
      date_trunc('day', local_ts) AS d_start,
      count(*)::bigint AS n,
      round(coalesce(sum(amount) FILTER (
        WHERE direction = 'incoming' AND status = 'completed' AND currency = 'ZMW'
      ), 0), 2) AS revenue,
      count(*) FILTER (WHERE status = 'completed')::bigint AS successful,
      count(*) FILTER (WHERE status = 'failed')::bigint AS failed
    FROM base GROUP BY 1
  ),
  parties AS (
    SELECT
      recipient_name AS name,
      round(sum(amount), 2) AS volume,
      count(*)::bigint AS n
    FROM base
    WHERE currency = 'ZMW'
      AND recipient_name IS NOT NULL
      AND recipient_name <> ''
    GROUP BY recipient_name
  )
  SELECT jsonb_build_object(
    'tx_count', (SELECT tx_count FROM totals),
    'completed_count', (SELECT completed_count FROM totals),
    'failed_count', (SELECT failed_count FROM totals),
    'revenue_zmw', (SELECT revenue_zmw FROM totals),
    'sent_zmw', (SELECT sent_zmw FROM totals),
    'by_status', (SELECT coalesce(jsonb_agg(
      jsonb_build_object('status', status, 'count', n, 'volume', volume)
      ORDER BY status), '[]'::jsonb) FROM by_status),
    'by_direction', (SELECT coalesce(jsonb_agg(
      jsonb_build_object('direction', direction, 'count', n, 'volume', volume)
      ORDER BY direction), '[]'::jsonb) FROM by_direction),
    'by_payment_method', (SELECT coalesce(jsonb_agg(
      jsonb_build_object('payment_method', payment_method, 'count', n, 'volume', volume)
      ORDER BY n DESC, payment_method), '[]'::jsonb) FROM by_method),
    'by_currency', (SELECT coalesce(jsonb_agg(
      jsonb_build_object('currency', currency, 'count', n, 'volume', volume)
      ORDER BY currency), '[]'::jsonb) FROM by_currency),
    'monthly', (SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'month_start', to_char(m.m_start, 'YYYY-MM-DD'),
        'transactions', coalesce(a.n, 0),
        'revenue', coalesce(a.revenue, 0),
        'successful', coalesce(a.successful, 0),
        'failed', coalesce(a.failed, 0)
      ) ORDER BY m.m_start), '[]'::jsonb)
      FROM months m LEFT JOIN month_agg a ON a.m_start = m.m_start),
    'daily', (SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'day', to_char(d.d_start, 'YYYY-MM-DD'),
        'revenue', coalesce(a.revenue, 0),
        'transactions', coalesce(a.n, 0),
        'successful', coalesce(a.successful, 0),
        'failed', coalesce(a.failed, 0)
      ) ORDER BY d.d_start), '[]'::jsonb)
      FROM days d LEFT JOIN day_agg a ON a.d_start = d.d_start),
    'top_counterparties', (SELECT coalesce(jsonb_agg(
      jsonb_build_object('name', name, 'volume', volume, 'transactions', n)
      ORDER BY volume DESC, name), '[]'::jsonb)
      FROM (SELECT * FROM parties ORDER BY volume DESC, name LIMIT 5) top5),
    'counterparty_total_volume', (SELECT round(coalesce(sum(volume), 0), 2) FROM parties)
  );
$$;

REVOKE ALL ON FUNCTION public.analytics_summary_impl(timestamptz, timestamptz, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.analytics_summary_impl(timestamptz, timestamptz, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.analytics_summary_impl(timestamptz, timestamptz, uuid) FROM authenticated;

-- ── Admin entry point: platform-wide summary ───────────────────────
CREATE OR REPLACE FUNCTION public.admin_analytics_summary(
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
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
  ) THEN
    RAISE EXCEPTION 'Only an admin can view platform analytics';
  END IF;

  RETURN public.analytics_summary_impl(p_from, p_to, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_analytics_summary(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_analytics_summary(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_analytics_summary(timestamptz, timestamptz) TO authenticated;

-- ── User entry point: the caller's own summary (Analytics page) ────
CREATE OR REPLACE FUNCTION public.get_user_analytics(
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You need to be signed in to view your analytics';
  END IF;

  RETURN public.analytics_summary_impl(p_from, p_to, auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_analytics(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_analytics(timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_analytics(timestamptz, timestamptz) TO authenticated;
