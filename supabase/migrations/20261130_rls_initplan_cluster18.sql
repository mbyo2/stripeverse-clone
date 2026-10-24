-- 20261130 — RLS initplan rewrite, cluster 18 (FINAL): spending_budgets, split_rules, subaccounts,
-- subscription_invoices, subscription_usage, transaction_categories.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24 08:05 CAT. NOT touched: transaction_categories "Authenticated can
-- view active categories" (is_active = true only, no auth.uid()).
-- Recorded: split_rules and transaction_categories "Admins can manage categories" are FOR ALL with a
-- NULL live WITH CHECK — recreated WITHOUT a WITH CHECK clause (Postgres applies USING as the check —
-- identical semantics, same treatment as cluster 17's pricing_tiers admin policy).
-- Proof: PR21 (others-blindness + admin visibility on transaction_categories) and the GLOBAL strict
-- recheck (must return 0 rows — that closes Fix #2).

DROP POLICY IF EXISTS "Users can manage their own budgets" ON public.spending_budgets;
CREATE POLICY "Users can manage their own budgets" ON public.spending_budgets FOR ALL TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users manage own split rules" ON public.split_rules;
CREATE POLICY "Users manage own split rules" ON public.split_rules FOR ALL TO public USING ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users manage own subaccounts" ON public.subaccounts;
CREATE POLICY "Users manage own subaccounts" ON public.subaccounts FOR ALL TO public USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users can view their own invoices" ON public.subscription_invoices;
CREATE POLICY "Users can view their own invoices" ON public.subscription_invoices FOR SELECT TO public USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Users can view their own usage" ON public.subscription_usage;
CREATE POLICY "Users can view their own usage" ON public.subscription_usage FOR SELECT TO public USING ((user_id = (SELECT auth.uid())));

DROP POLICY IF EXISTS "Admins can manage categories" ON public.transaction_categories;
CREATE POLICY "Admins can manage categories" ON public.transaction_categories FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));
