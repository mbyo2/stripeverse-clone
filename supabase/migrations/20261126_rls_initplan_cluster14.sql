-- 20261126 — RLS initplan rewrite, cluster 14: api_ip_whitelist, api_keys, audit_logs, bank_accounts,
-- beta_feedback, bill_payments, billing_retry_queue, btc_address_assignments (one bare-uid policy each).
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched (no auth.uid()): audit_logs "Block client writes" (false)
-- and "Service role can insert audit logs" (true); beta_feedback "Anyone can submit feedback"
-- (field-validation check only). FOR ALL policies that carry an explicit WITH CHECK keep it; those
-- without one are recreated without (Postgres applies USING as the check — identical).
-- Proof: PR17 (others-blindness + admin visibility on audit_logs and beta_feedback) and the recheck.

DROP POLICY IF EXISTS "Users can manage their IP whitelist" ON public.api_ip_whitelist;
CREATE POLICY "Users can manage their IP whitelist" ON public.api_ip_whitelist FOR ALL TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own API keys" ON public.api_keys;
CREATE POLICY "Users manage own API keys" ON public.api_keys FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users manage own bank accounts" ON public.bank_accounts;
CREATE POLICY "Users manage own bank accounts" ON public.bank_accounts FOR ALL TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view all beta feedback" ON public.beta_feedback;
CREATE POLICY "Admins can view all beta feedback" ON public.beta_feedback FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can manage their bill payments" ON public.bill_payments;
CREATE POLICY "Users can manage their bill payments" ON public.bill_payments FOR ALL TO public USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own retries" ON public.billing_retry_queue;
CREATE POLICY "Users can view their own retries" ON public.billing_retry_queue FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own btc address" ON public.btc_address_assignments;
CREATE POLICY "Users view own btc address" ON public.btc_address_assignments FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
