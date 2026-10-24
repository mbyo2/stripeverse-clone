-- 20261125 — RLS initplan rewrite, cluster 13: subscriptions, used_totp_tokens, user_rewards,
-- user_sanctions, user_sessions, webhook_delivery_logs.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24, including NULL with_check on FOR ALL policies (recreated without the
-- clause). webhook_delivery_logs business view keeps its EXISTS-into-merchant_accounts shape (acyclic),
-- inner uid wrapped too.
-- Proof: PR16 (others-blindness + webhook-log visible-set equality + admin visibility) and the recheck.

-- ============ subscriptions (2) ============
DROP POLICY IF EXISTS "System can manage subscriptions" ON public.subscriptions;
CREATE POLICY "System can manage subscriptions" ON public.subscriptions FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own subscriptions" ON public.subscriptions;
CREATE POLICY "Users can view their own subscriptions" ON public.subscriptions FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ used_totp_tokens (2) ============
DROP POLICY IF EXISTS "Users can insert their own used tokens" ON public.used_totp_tokens;
CREATE POLICY "Users can insert their own used tokens" ON public.used_totp_tokens FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own used tokens" ON public.used_totp_tokens;
CREATE POLICY "Users can view their own used tokens" ON public.used_totp_tokens FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ user_rewards (2) ============
DROP POLICY IF EXISTS "System can manage user rewards" ON public.user_rewards;
CREATE POLICY "System can manage user rewards" ON public.user_rewards FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own rewards" ON public.user_rewards;
CREATE POLICY "Users can view their own rewards" ON public.user_rewards FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ user_sanctions (2) ============
DROP POLICY IF EXISTS "Admins can view all sanctions" ON public.user_sanctions;
CREATE POLICY "Admins can view all sanctions" ON public.user_sanctions FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own sanctions" ON public.user_sanctions;
CREATE POLICY "Users can view their own sanctions" ON public.user_sanctions FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ user_sessions (2) ============
DROP POLICY IF EXISTS "Users can manage their own sessions" ON public.user_sessions;
CREATE POLICY "Users can manage their own sessions" ON public.user_sessions FOR ALL TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own sessions" ON public.user_sessions;
CREATE POLICY "Users can view their own sessions" ON public.user_sessions FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ webhook_delivery_logs (2) ============
DROP POLICY IF EXISTS "Admins view all webhook logs" ON public.webhook_delivery_logs;
CREATE POLICY "Admins view all webhook logs" ON public.webhook_delivery_logs FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Business owners view webhook logs" ON public.webhook_delivery_logs;
CREATE POLICY "Business owners view webhook logs" ON public.webhook_delivery_logs FOR SELECT TO public USING ((EXISTS (SELECT 1 FROM merchant_accounts ma WHERE ((ma.id = webhook_delivery_logs.business_id) AND (ma.user_id = (SELECT auth.uid()))))));
