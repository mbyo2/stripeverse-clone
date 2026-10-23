-- =====================================================================
-- 20261112_rls_initplan_cluster1.sql — scalability fix #2, cluster 1
--
-- Postgres evaluates a bare auth.uid() call in an RLS policy once
-- PER ROW. Wrapping it as (SELECT auth.uid()) turns it into an
-- initplan evaluated ONCE per statement. Semantics are identical;
-- only the evaluation count changes. This cluster covers the three
-- hottest tables: profiles, transactions, wallets (11 policies
-- dumped verbatim from live pg_policies on 2026-10-23 before this
-- rewrite was authored).
--
-- ONE deliberate deviation, flagged: "Admins can view all
-- transactions" was the only oversight policy still testing plain
-- 'admin' exact-match (roles {public}). It is widened to
-- (admin OR super_admin) — the foundation's own pattern, already
-- applied to profiles/wallets oversight (20261105) and to
-- refunds/role_requests (20261110) — because a super_admin-only
-- operator was locked out of the platform transaction view. The
-- roles stay {public}: has_role(NULL) is false, so anon gains
-- nothing.
--
-- Untouched: "Block client-side transaction inserts" (no uid call),
-- and the duplicate own-row wallet SELECTs (kept; dedupe is a
-- separate decision). has_role() calls keep their shape — the
-- function is STABLE over an indexed table; the win is evaluating
-- its ARGUMENT once.
-- =====================================================================

-- ── profiles ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);

-- ── transactions ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.transactions;
CREATE POLICY "Admins can view all transactions"
  ON public.transactions FOR SELECT TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
CREATE POLICY "Users can view their own transactions"
  ON public.transactions FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── wallets ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin oversight can view all wallets" ON public.wallets;
CREATE POLICY "Admin oversight can view all wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users can view their own wallets" ON public.wallets;
CREATE POLICY "Users can view their own wallets"
  ON public.wallets FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users create own wallets" ON public.wallets;
CREATE POLICY "Users create own wallets"
  ON public.wallets FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.uid()) = user_id)
    AND (balance = (0)::numeric)
    AND (status = 'active'::text)
    AND (currency = ANY (ARRAY['ZMW'::text, 'USD'::text, 'EUR'::text, 'GBP'::text, 'ZAR'::text, 'NGN'::text, 'KES'::text, 'TZS'::text, 'BWP'::text]))
    AND ((account_id IS NULL) OR (EXISTS (
      SELECT 1 FROM accounts a
      WHERE ((a.id = wallets.account_id)
        AND (a.user_id = (SELECT auth.uid()))
        AND (a.status <> 'closed'::text))))));

DROP POLICY IF EXISTS "Users view own wallets" ON public.wallets;
CREATE POLICY "Users view own wallets"
  ON public.wallets FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
