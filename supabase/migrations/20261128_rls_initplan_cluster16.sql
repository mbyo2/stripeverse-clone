-- 20261128 — RLS initplan rewrite, cluster 16: currency_conversions, exchange_rates, invoices,
-- lightning_payments, mastercard_move_payments, merchant_invoices, merchant_payment_plans,
-- paypal_provenance_balances.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched: exchange_rates "Public can view exchange rates" (true).
-- Recorded: currency_conversions' policy is named "Users view own conversions" but is FOR ALL with an
-- explicit WITH CHECK — recreated as found. mastercard_move_payments keeps its EXISTS-into-user_roles
-- role check (admin/super_admin by role text) instead of has_role — preserved as designed in migration
-- 20261029; merchant tables key on merchant_id.
-- Proof: PR19 (others-blindness + Move admin/super_admin visibility, plain-user blindness) and recheck.

DROP POLICY IF EXISTS "Users view own conversions" ON public.currency_conversions;
CREATE POLICY "Users view own conversions" ON public.currency_conversions FOR ALL TO public USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can manage exchange rates" ON public.exchange_rates;
CREATE POLICY "Admins can manage exchange rates" ON public.exchange_rates FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own invoices" ON public.invoices;
CREATE POLICY "Users can view their own invoices" ON public.invoices FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own lightning payments" ON public.lightning_payments;
CREATE POLICY "Users view own lightning payments" ON public.lightning_payments FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view Mastercard Move payments" ON public.mastercard_move_payments;
CREATE POLICY "Admins can view Mastercard Move payments" ON public.mastercard_move_payments FOR SELECT TO authenticated USING ((EXISTS (SELECT 1 FROM user_roles ur WHERE ((ur.user_id = (SELECT auth.uid())) AND ((ur.role)::text = ANY (ARRAY['admin'::text, 'super_admin'::text]))))));

DROP POLICY IF EXISTS "Merchants can manage their invoices" ON public.merchant_invoices;
CREATE POLICY "Merchants can manage their invoices" ON public.merchant_invoices FOR ALL TO authenticated USING ((SELECT auth.uid()) = merchant_id) WITH CHECK ((SELECT auth.uid()) = merchant_id);

DROP POLICY IF EXISTS "Users can manage their payment plans" ON public.merchant_payment_plans;
CREATE POLICY "Users can manage their payment plans" ON public.merchant_payment_plans FOR ALL TO public USING ((SELECT auth.uid()) = merchant_id) WITH CHECK ((SELECT auth.uid()) = merchant_id);

DROP POLICY IF EXISTS "Users can read their own PayPal provenance" ON public.paypal_provenance_balances;
CREATE POLICY "Users can read their own PayPal provenance" ON public.paypal_provenance_balances FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));
