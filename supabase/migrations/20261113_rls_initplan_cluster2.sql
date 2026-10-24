-- =====================================================================
-- 20261113_rls_initplan_cluster2.sql — scalability fix #2, cluster 2
--
-- Same mechanical rewrite as cluster 1 (20261112): every auth.uid()
-- becomes (SELECT auth.uid()) so Postgres evaluates identity once
-- per statement (initplan) instead of per row. Authored from the
-- verbatim live pg_policies dump of 2026-10-23 (31 policies across
-- accounts, btc_deposits, crypto_wallets, payment_links and the
-- p2p_* tables). p2p_price_snapshots' policy has no uid call and is
-- untouched, as is "Public can view active payment links".
--
-- DELIBERATE DEVIATION (documented, same class as 20261110/20261112):
-- the p2p_* "Admins can view ..." SELECT policies tested plain
-- 'admin' only. They are widened to the platform's own P2P staff
-- definition — admin OR super_admin OR p2p_admin — matching
-- public.p2p_is_admin() (the DB gate the dispute RPCs already use)
-- and the /admin/p2p route gating shipped with the superadmin
-- console. Without it, a p2p_admin's console reads return zero rows
-- and a super_admin-only holder is blind on P2P operations data.
-- The widening is SELECT-only; all P2P writes remain RPC/edge-only.
-- =====================================================================

-- ── accounts ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin oversight can view all accounts" ON public.accounts;
CREATE POLICY "Admin oversight can view all accounts"
  ON public.accounts FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users manage own accounts" ON public.accounts;
CREATE POLICY "Users manage own accounts"
  ON public.accounts FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── btc_deposits ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin oversight can view all btc deposits" ON public.btc_deposits;
CREATE POLICY "Admin oversight can view all btc deposits"
  ON public.btc_deposits FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users view own btc deposits" ON public.btc_deposits;
CREATE POLICY "Users view own btc deposits"
  ON public.btc_deposits FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);

-- ── crypto_wallets ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin oversight can view all crypto wallets" ON public.crypto_wallets;
CREATE POLICY "Admin oversight can view all crypto wallets"
  ON public.crypto_wallets FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users can view their own crypto wallets" ON public.crypto_wallets;
CREATE POLICY "Users can view their own crypto wallets"
  ON public.crypto_wallets FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── payment_links ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin oversight can view all payment links" ON public.payment_links;
CREATE POLICY "Admin oversight can view all payment links"
  ON public.payment_links FOR SELECT TO authenticated
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users manage own payment links" ON public.payment_links;
CREATE POLICY "Users manage own payment links"
  ON public.payment_links FOR ALL TO public
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ── p2p_ads ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Anyone can view active P2P ads" ON public.p2p_ads;
CREATE POLICY "Anyone can view active P2P ads"
  ON public.p2p_ads FOR SELECT TO public
  USING ((status = 'active'::text)
      OR (owner_id = (SELECT auth.uid()))
      OR public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

-- ── p2p_audit_log ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view the P2P audit log" ON public.p2p_audit_log;
CREATE POLICY "Admins can view the P2P audit log"
  ON public.p2p_audit_log FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

-- ── p2p_blocks ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all P2P blocks" ON public.p2p_blocks;
CREATE POLICY "Admins can view all P2P blocks"
  ON public.p2p_blocks FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own P2P blocks" ON public.p2p_blocks;
CREATE POLICY "Users can view their own P2P blocks"
  ON public.p2p_blocks FOR SELECT TO authenticated
  USING (blocker_id = (SELECT auth.uid()));

-- ── p2p_dispute_evidence ──────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all dispute evidence" ON public.p2p_dispute_evidence;
CREATE POLICY "Admins can view all dispute evidence"
  ON public.p2p_dispute_evidence FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Dispute parties can view evidence" ON public.p2p_dispute_evidence;
CREATE POLICY "Dispute parties can view evidence"
  ON public.p2p_dispute_evidence FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM (p2p_disputes d JOIN p2p_orders o ON ((o.id = d.order_id)))
    WHERE ((d.id = p2p_dispute_evidence.dispute_id)
      AND ((o.advertiser_id = (SELECT auth.uid()))
        OR (o.taker_id = (SELECT auth.uid()))))));

-- ── p2p_disputes ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all P2P disputes" ON public.p2p_disputes;
CREATE POLICY "Admins can view all P2P disputes"
  ON public.p2p_disputes FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Order participants can view their disputes" ON public.p2p_disputes;
CREATE POLICY "Order participants can view their disputes"
  ON public.p2p_disputes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM p2p_orders o
    WHERE ((o.id = p2p_disputes.order_id)
      AND ((o.advertiser_id = (SELECT auth.uid()))
        OR (o.taker_id = (SELECT auth.uid()))))));

-- ── p2p_order_messages ────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all trade messages" ON public.p2p_order_messages;
CREATE POLICY "Admins can view all trade messages"
  ON public.p2p_order_messages FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Order participants can view trade messages" ON public.p2p_order_messages;
CREATE POLICY "Order participants can view trade messages"
  ON public.p2p_order_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM p2p_orders o
    WHERE ((o.id = p2p_order_messages.order_id)
      AND ((o.advertiser_id = (SELECT auth.uid()))
        OR (o.taker_id = (SELECT auth.uid()))))));

-- ── p2p_orders ────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all P2P orders" ON public.p2p_orders;
CREATE POLICY "Admins can view all P2P orders"
  ON public.p2p_orders FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Order participants can view their P2P orders" ON public.p2p_orders;
CREATE POLICY "Order participants can view their P2P orders"
  ON public.p2p_orders FOR SELECT TO authenticated
  USING ((advertiser_id = (SELECT auth.uid()))
      OR (taker_id = (SELECT auth.uid())));

-- ── p2p_payment_claims ────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all payment claims" ON public.p2p_payment_claims;
CREATE POLICY "Admins can view all payment claims"
  ON public.p2p_payment_claims FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Order participants can view their payment claim" ON public.p2p_payment_claims;
CREATE POLICY "Order participants can view their payment claim"
  ON public.p2p_payment_claims FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM p2p_orders o
    WHERE ((o.id = p2p_payment_claims.order_id)
      AND ((o.advertiser_id = (SELECT auth.uid()))
        OR (o.taker_id = (SELECT auth.uid()))))));

-- ── p2p_payment_methods ───────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all P2P payment methods" ON public.p2p_payment_methods;
CREATE POLICY "Admins can view all P2P payment methods"
  ON public.p2p_payment_methods FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own payment methods" ON public.p2p_payment_methods;
CREATE POLICY "Users can view their own payment methods"
  ON public.p2p_payment_methods FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── p2p_reports ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view all P2P reports" ON public.p2p_reports;
CREATE POLICY "Admins can view all P2P reports"
  ON public.p2p_reports FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own P2P reports" ON public.p2p_reports;
CREATE POLICY "Users can view their own P2P reports"
  ON public.p2p_reports FOR SELECT TO authenticated
  USING (reporter_id = (SELECT auth.uid()));

-- ── p2p_reviews ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view P2P reviews" ON public.p2p_reviews;
CREATE POLICY "Admins can view P2P reviews"
  ON public.p2p_reviews FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

-- ── p2p_risk_events ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can view P2P risk events" ON public.p2p_risk_events;
CREATE POLICY "Admins can view P2P risk events"
  ON public.p2p_risk_events FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)
      OR public.has_role((SELECT auth.uid()), 'p2p_admin'::app_role));

-- ── p2p_trader_profiles ───────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view their own trader profile" ON public.p2p_trader_profiles;
CREATE POLICY "Users can view their own trader profile"
  ON public.p2p_trader_profiles FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);
