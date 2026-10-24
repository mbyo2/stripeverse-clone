-- =====================================================================
-- 20261117_rls_initplan_cluster5.sql — scalability fix #2, cluster 5
--
-- Mechanical initplan rewrite (auth.uid() -> (SELECT auth.uid())) for
-- transaction_disputes, dispute_messages, merchant_accounts, from the
-- verbatim live pg_policies dump of 2026-10-24. No meaning changes.
-- The dispute_messages EXISTS shape into transaction_disputes is
-- preserved (inner identity call wrapped too), per the cluster-2/4
-- rule. The three "Admins can manage..." FOR ALL policies are
-- admin-only (no super_admin) — pre-existing asymmetry, recorded,
-- not changed by a mechanical pass.
-- Proof: PR8 (cross-user blindness on disputes/messages/merchant
-- accounts) run at relay time.
-- =====================================================================

-- ── transaction_disputes ───────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can manage all disputes" ON public.transaction_disputes;
CREATE POLICY "Admins can manage all disputes"
  ON public.transaction_disputes FOR ALL TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can insert their own disputes" ON public.transaction_disputes;
CREATE POLICY "Users can insert their own disputes"
  ON public.transaction_disputes FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their pending disputes" ON public.transaction_disputes;
CREATE POLICY "Users can update their pending disputes"
  ON public.transaction_disputes FOR UPDATE TO public
  USING (((SELECT auth.uid()) = user_id) AND (status = 'pending'::text));

DROP POLICY IF EXISTS "Users can view their own disputes" ON public.transaction_disputes;
CREATE POLICY "Users can view their own disputes"
  ON public.transaction_disputes FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── dispute_messages ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can manage all dispute messages" ON public.dispute_messages;
CREATE POLICY "Admins can manage all dispute messages"
  ON public.dispute_messages FOR ALL TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can add messages to their disputes" ON public.dispute_messages;
CREATE POLICY "Users can add messages to their disputes"
  ON public.dispute_messages FOR INSERT TO public
  WITH CHECK (
    (SELECT auth.uid()) = sender_id
    AND EXISTS (
      SELECT 1 FROM public.transaction_disputes d
      WHERE d.id = dispute_messages.dispute_id
        AND d.user_id = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can view non-internal messages for their disputes" ON public.dispute_messages;
CREATE POLICY "Users can view non-internal messages for their disputes"
  ON public.dispute_messages FOR SELECT TO public
  USING (
    is_internal = false
    AND EXISTS (
      SELECT 1 FROM public.transaction_disputes d
      WHERE d.id = dispute_messages.dispute_id
        AND d.user_id = (SELECT auth.uid())
    )
  );

-- ── merchant_accounts ──────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins can manage merchant accounts" ON public.merchant_accounts;
CREATE POLICY "Admins can manage merchant accounts"
  ON public.merchant_accounts FOR ALL TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can create their own merchant account" ON public.merchant_accounts;
CREATE POLICY "Users can create their own merchant account"
  ON public.merchant_accounts FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their merchant account" ON public.merchant_accounts;
CREATE POLICY "Users can update their merchant account"
  ON public.merchant_accounts FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their merchant account" ON public.merchant_accounts;
CREATE POLICY "Users can view their merchant account"
  ON public.merchant_accounts FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);
