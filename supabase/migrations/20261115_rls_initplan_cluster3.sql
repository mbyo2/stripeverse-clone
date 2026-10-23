-- =====================================================================
-- 20261115_rls_initplan_cluster3.sql — scalability fix #2, cluster 3
--
-- Mechanical initplan rewrite (auth.uid() -> (SELECT auth.uid())) for
-- virtual_cards, refunds, payment_methods, from the verbatim live
-- pg_policies dump of 2026-10-24. No policy's meaning changes:
-- same names, commands, roles and expressions, with the identity call
-- wrapped so Postgres evaluates it once per query instead of per row.
--
-- Observations recorded, deliberately NOT changed in this pass:
--   * payment_methods carries overlapping owner policies (a FOR ALL
--     "manage" policy beside per-command insert/update/view ones) and
--     virtual_cards carries two identical owner SELECT policies.
--     Permissive policies OR together, so the duplicates are harmless
--     breadth, not holes; consolidation is a separate decision.
--   * virtual_cards "System can manage cards" is admin-only (no
--     super_admin) — a pre-existing asymmetry vs the refunds widening
--     (20261110). Left as-is here; widening a FOR ALL write policy is
--     a policy decision, not a mechanical rewrite.
--   * Where the live policy has no WITH CHECK, none is written: the
--     Postgres default (check = USING expression) is preserved.
-- Proofs: PR6 (refunds admin/super_admin equality, finance_admin
-- bounded, virtual_cards admin visibility) run at relay time.
-- =====================================================================

-- ── virtual_cards ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "System can manage cards" ON public.virtual_cards;
CREATE POLICY "System can manage cards"
  ON public.virtual_cards FOR ALL TO public
  USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can update own card settings" ON public.virtual_cards;
CREATE POLICY "Users can update own card settings"
  ON public.virtual_cards FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (((SELECT auth.uid()) = user_id)
    AND (status = ANY (ARRAY['active'::text, 'frozen'::text, 'cancelled'::text])));

DROP POLICY IF EXISTS "Users can view their own cards" ON public.virtual_cards;
CREATE POLICY "Users can view their own cards"
  ON public.virtual_cards FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own virtual cards" ON public.virtual_cards;
CREATE POLICY "Users can view their own virtual cards"
  ON public.virtual_cards FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── refunds ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins manage all refunds" ON public.refunds;
CREATE POLICY "Admins manage all refunds"
  ON public.refunds FOR ALL TO public
  USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)))
  WITH CHECK ((public.has_role((SELECT auth.uid()), 'admin'::app_role)
       OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Approvers can settle refunds" ON public.refunds;
CREATE POLICY "Approvers can settle refunds"
  ON public.refunds FOR UPDATE TO authenticated
  USING ((status = 'pending'::text) AND ((SELECT auth.uid()) <> user_id))
  WITH CHECK ((approved_by = (SELECT auth.uid())) AND ((SELECT auth.uid()) <> user_id));

DROP POLICY IF EXISTS "Users create own refunds" ON public.refunds;
CREATE POLICY "Users create own refunds"
  ON public.refunds FOR INSERT TO public
  WITH CHECK (((SELECT auth.uid()) = user_id) AND (status = 'pending'::text)
    AND (approved_by IS NULL) AND (approved_at IS NULL)
    AND (settlement_transaction_id IS NULL));

DROP POLICY IF EXISTS "Users view own refunds" ON public.refunds;
CREATE POLICY "Users view own refunds"
  ON public.refunds FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);

-- ── payment_methods ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can insert their own payment methods" ON public.payment_methods;
CREATE POLICY "Users can insert their own payment methods"
  ON public.payment_methods FOR INSERT TO public
  WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can manage their payment methods" ON public.payment_methods;
CREATE POLICY "Users can manage their payment methods"
  ON public.payment_methods FOR ALL TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own payment methods" ON public.payment_methods;
CREATE POLICY "Users can update their own payment methods"
  ON public.payment_methods FOR UPDATE TO public
  USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own payment methods" ON public.payment_methods;
CREATE POLICY "Users can view their own payment methods"
  ON public.payment_methods FOR SELECT TO public
  USING ((SELECT auth.uid()) = user_id);
