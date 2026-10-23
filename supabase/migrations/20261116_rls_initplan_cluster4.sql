-- =====================================================================
-- 20261116_rls_initplan_cluster4.sql — scalability fix #2, cluster 4
--
-- Mechanical initplan rewrite (auth.uid() -> (SELECT auth.uid())) for
-- escrow_transactions, payouts, scheduled_payments, from the verbatim
-- live pg_policies dump of 2026-10-24. No policy's meaning changes.
--
-- Notes:
--   * The payouts draft-batch policies keep their EXISTS shape into
--     payout_batches, with the inner identity call wrapped too —
--     the same preserve-the-shape rule as the P2P participant
--     policies in cluster 2 (20261113).
--   * payouts "Owners view their payouts" is admin-only (no
--     super_admin) — pre-existing asymmetry, recorded, not changed;
--     widening is a policy decision, not a mechanical rewrite.
--   * scheduled_payments' service_role policy (qual true) holds no
--     identity call and is untouched.
-- Proof: PR7 (cross-user blindness on payouts/scheduled/escrow,
-- admin payout visibility) run at relay time.
-- =====================================================================

-- ── escrow_transactions ────────────────────────────────────────────
DROP POLICY IF EXISTS "Buyers can create escrow" ON public.escrow_transactions;
CREATE POLICY "Buyers can create escrow"
  ON public.escrow_transactions FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.uid()) = buyer_id) AND (seller_id <> buyer_id)
    AND (status = 'pending'::text) AND (funded_at IS NULL)
    AND (released_at IS NULL) AND (disputed_at IS NULL)
    AND (cancelled_at IS NULL) AND (hold_transaction_id IS NULL)
    AND (settlement_transaction_id IS NULL));

DROP POLICY IF EXISTS "Buyers can delete unfunded escrow" ON public.escrow_transactions;
CREATE POLICY "Buyers can delete unfunded escrow"
  ON public.escrow_transactions FOR DELETE TO authenticated
  USING (((SELECT auth.uid()) = buyer_id) AND (status = 'pending'::text));

DROP POLICY IF EXISTS "Participants can flag escrow transitions" ON public.escrow_transactions;
CREATE POLICY "Participants can flag escrow transitions"
  ON public.escrow_transactions FOR UPDATE TO authenticated
  USING ((((SELECT auth.uid()) = buyer_id) OR ((SELECT auth.uid()) = seller_id))
    AND (status = ANY (ARRAY['pending'::text, 'funded'::text])))
  WITH CHECK ((((SELECT auth.uid()) = buyer_id) OR ((SELECT auth.uid()) = seller_id))
    AND (status = ANY (ARRAY['funded'::text, 'disputed'::text])));

DROP POLICY IF EXISTS "Users can view their escrow transactions" ON public.escrow_transactions;
CREATE POLICY "Users can view their escrow transactions"
  ON public.escrow_transactions FOR SELECT TO public
  USING (((SELECT auth.uid()) = buyer_id) OR ((SELECT auth.uid()) = seller_id));

-- ── payouts ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Owners create payouts in draft batches" ON public.payouts;
CREATE POLICY "Owners create payouts in draft batches"
  ON public.payouts FOR INSERT TO authenticated
  WITH CHECK (((SELECT auth.uid()) = user_id)
    AND ((batch_id IS NULL) OR (EXISTS (
      SELECT 1 FROM payout_batches b
      WHERE ((b.id = payouts.batch_id) AND (b.user_id = (SELECT auth.uid()))
        AND (b.status = 'draft'::text))))));

DROP POLICY IF EXISTS "Owners delete payouts in draft batches" ON public.payouts;
CREATE POLICY "Owners delete payouts in draft batches"
  ON public.payouts FOR DELETE TO authenticated
  USING (((SELECT auth.uid()) = user_id) AND (EXISTS (
    SELECT 1 FROM payout_batches b
    WHERE ((b.id = payouts.batch_id) AND (b.user_id = (SELECT auth.uid()))
      AND (b.status = 'draft'::text)))));

DROP POLICY IF EXISTS "Owners edit payouts in draft batches" ON public.payouts;
CREATE POLICY "Owners edit payouts in draft batches"
  ON public.payouts FOR UPDATE TO authenticated
  USING (((SELECT auth.uid()) = user_id) AND (EXISTS (
    SELECT 1 FROM payout_batches b
    WHERE ((b.id = payouts.batch_id) AND (b.user_id = (SELECT auth.uid()))
      AND (b.status = 'draft'::text)))))
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners view their payouts" ON public.payouts;
CREATE POLICY "Owners view their payouts"
  ON public.payouts FOR SELECT TO authenticated
  USING (((SELECT auth.uid()) = user_id)
    OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ── scheduled_payments ─────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can delete their own scheduled payments" ON public.scheduled_payments;
CREATE POLICY "Users can delete their own scheduled payments"
  ON public.scheduled_payments FOR DELETE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own scheduled payments" ON public.scheduled_payments;
CREATE POLICY "Users can insert their own scheduled payments"
  ON public.scheduled_payments FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own scheduled payments" ON public.scheduled_payments;
CREATE POLICY "Users can update their own scheduled payments"
  ON public.scheduled_payments FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own scheduled payments" ON public.scheduled_payments;
CREATE POLICY "Users can view their own scheduled payments"
  ON public.scheduled_payments FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = user_id);
