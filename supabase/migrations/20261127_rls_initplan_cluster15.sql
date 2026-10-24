-- 20261127 — RLS initplan rewrite, cluster 15: btc_quotes, btc_settings, budget_goals,
-- bulk_payment_items, bulk_payments, card_tokens, crypto_invoices, crypto_treasury_config.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched: crypto_invoices "Anon can view payment-link invoices"
-- (no auth.uid() — public link-code visibility, unchanged). bulk_payment_items keeps its
-- EXISTS-into-bulk_payments shape in both USING and WITH CHECK (acyclic), inner uid wrapped.
-- Proof: PR18 (others-blindness + bulk_payment_items visible-set equality + non-admin blindness on the
-- two admin config tables) and the strict recheck.

DROP POLICY IF EXISTS "Users view own btc quotes" ON public.btc_quotes;
CREATE POLICY "Users view own btc quotes" ON public.btc_quotes FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins manage btc settings" ON public.btc_settings;
CREATE POLICY "Admins manage btc settings" ON public.btc_settings FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can manage their own goals" ON public.budget_goals;
CREATE POLICY "Users can manage their own goals" ON public.budget_goals FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own bulk payment items" ON public.bulk_payment_items;
CREATE POLICY "Users manage own bulk payment items" ON public.bulk_payment_items FOR ALL TO public USING ((EXISTS (SELECT 1 FROM bulk_payments bp WHERE ((bp.id = bulk_payment_items.bulk_payment_id) AND (bp.user_id = (SELECT auth.uid())))))) WITH CHECK ((EXISTS (SELECT 1 FROM bulk_payments bp WHERE ((bp.id = bulk_payment_items.bulk_payment_id) AND (bp.user_id = (SELECT auth.uid()))))));

DROP POLICY IF EXISTS "Users manage own bulk payments" ON public.bulk_payments;
CREATE POLICY "Users manage own bulk payments" ON public.bulk_payments FOR ALL TO public USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own card tokens" ON public.card_tokens;
CREATE POLICY "Users manage own card tokens" ON public.card_tokens FOR ALL TO public USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own crypto invoices" ON public.crypto_invoices;
CREATE POLICY "Users can view their own crypto invoices" ON public.crypto_invoices FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins manage treasury config" ON public.crypto_treasury_config;
CREATE POLICY "Admins manage treasury config" ON public.crypto_treasury_config FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));
