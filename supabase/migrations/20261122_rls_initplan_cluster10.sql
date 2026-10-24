-- 20261122 — RLS initplan rewrite, cluster 10: payout_batches, savings_accounts, security_events,
-- wallet_reconciliations.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched (no auth.uid() in them): security_events "Block client
-- writes to security events" (false/false) and "Service role can insert security events" (true).
-- Recorded: security_events carries two admin SELECT policies (one TO public, one TO authenticated);
-- savings_accounts INSERT pins balance and interest_earned to 0 — a creation guard, preserved exactly;
-- wallet_reconciliations owner view keeps its EXISTS-into-wallets shape (wallets policies do not
-- reference wallet_reconciliations — acyclic), inner uid wrapped too.
-- Proof: PR13 (others-blindness + wallet_reconciliations visible-set equality + admin visibility)
-- and the strict recheck.

-- ============ payout_batches (3) ============
DROP POLICY IF EXISTS "Owners create payout batches" ON public.payout_batches;
CREATE POLICY "Owners create payout batches" ON public.payout_batches FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners edit draft payout batches" ON public.payout_batches;
CREATE POLICY "Owners edit draft payout batches" ON public.payout_batches FOR UPDATE TO authenticated USING (((SELECT auth.uid()) = user_id) AND (status = 'draft'::text)) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Owners view their payout batches" ON public.payout_batches;
CREATE POLICY "Owners view their payout batches" ON public.payout_batches FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ============ savings_accounts (3) ============
DROP POLICY IF EXISTS "Users can create savings goals" ON public.savings_accounts;
CREATE POLICY "Users can create savings goals" ON public.savings_accounts FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id) AND (balance = (0)::numeric) AND (interest_earned = (0)::numeric));

DROP POLICY IF EXISTS "Users can update savings goal settings" ON public.savings_accounts;
CREATE POLICY "Users can update savings goal settings" ON public.savings_accounts FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their savings" ON public.savings_accounts;
CREATE POLICY "Users can view their savings" ON public.savings_accounts FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ security_events (3 of 5; two uid-free policies untouched) ============
DROP POLICY IF EXISTS "Admins can view all security events" ON public.security_events;
CREATE POLICY "Admins can view all security events" ON public.security_events FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view security events" ON public.security_events;
CREATE POLICY "Admins can view security events" ON public.security_events FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own security events" ON public.security_events;
CREATE POLICY "Users can view their own security events" ON public.security_events FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ wallet_reconciliations (3) ============
DROP POLICY IF EXISTS "Admins can insert reconciliations" ON public.wallet_reconciliations;
CREATE POLICY "Admins can insert reconciliations" ON public.wallet_reconciliations FOR INSERT TO public WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all reconciliations" ON public.wallet_reconciliations;
CREATE POLICY "Admins can view all reconciliations" ON public.wallet_reconciliations FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view own wallet reconciliations" ON public.wallet_reconciliations;
CREATE POLICY "Users can view own wallet reconciliations" ON public.wallet_reconciliations FOR SELECT TO public USING ((EXISTS (SELECT 1 FROM wallets WHERE ((wallets.id = wallet_reconciliations.wallet_id) AND (wallets.user_id = (SELECT auth.uid()))))));
