-- 20261129 — RLS initplan rewrite, cluster 17: paypal_withdrawals, plan_installment_payments,
-- pos_payment_requests, pricing_tiers, provider_intents, rate_limits, saved_contacts,
-- settlement_reports.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24 07:40 CAT. NOT touched: pricing_tiers "Authenticated can view active
-- pricing tiers" and "Public can view active pricing tiers" (is_active = true only, no auth.uid()).
-- Recorded: plan_installment_payments keeps its EXISTS-into-merchant_payment_plans shape in both USING
-- and WITH CHECK (acyclic), inner uid wrapped; provider_intents keeps its owner-OR-admin shape.
-- pricing_tiers "Admins can manage pricing tiers" is FOR ALL with a NULL live WITH CHECK — recreated
-- WITHOUT a WITH CHECK clause (Postgres applies USING as the check — identical semantics).
-- plan_installment_payments: relayed 2026-10-24 in a SIMPLIFIED paren-equivalent form (one USING paren
-- around EXISTS, no redundant inner grouping — AND has no OR to reorder). The fully-parenthesised
-- verbatim form failed live with 42601 because the dashboard editor inserted 3 extra ")" during paste
-- (DB echo: 19 closes vs 16 opens); the simplified form carries the identical predicate and the same
-- wrapped (SELECT auth.uid()). The repo file matches the live policy text.
-- Proof: PR20 (others-blindness + admin visibility on pricing_tiers/rate_limits) and the strict recheck.

DROP POLICY IF EXISTS "Users can read their own PayPal withdrawals" ON public.paypal_withdrawals;
CREATE POLICY "Users can read their own PayPal withdrawals" ON public.paypal_withdrawals FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Merchants manage own plan payments" ON public.plan_installment_payments;
CREATE POLICY "Merchants manage own plan payments" ON public.plan_installment_payments FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM merchant_payment_plans p WHERE p.id = plan_installment_payments.plan_id AND p.merchant_id = (SELECT auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM merchant_payment_plans p WHERE p.id = plan_installment_payments.plan_id AND p.merchant_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Merchants view own pos requests" ON public.pos_payment_requests;
CREATE POLICY "Merchants view own pos requests" ON public.pos_payment_requests FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can manage pricing tiers" ON public.pricing_tiers;
CREATE POLICY "Admins can manage pricing tiers" ON public.pricing_tiers FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Owners view their provider intents" ON public.provider_intents;
CREATE POLICY "Owners view their provider intents" ON public.provider_intents FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Only admins can view rate limits" ON public.rate_limits;
CREATE POLICY "Only admins can view rate limits" ON public.rate_limits FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can manage their own contacts" ON public.saved_contacts;
CREATE POLICY "Users can manage their own contacts" ON public.saved_contacts FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own settlements" ON public.settlement_reports;
CREATE POLICY "Users view own settlements" ON public.settlement_reports FOR SELECT TO public USING ((SELECT auth.uid()) = merchant_id);
