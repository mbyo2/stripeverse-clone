-- 20261124 — RLS initplan rewrite, cluster 12: contact_messages, crypto_address_nonces,
-- identity_verifications, newsletter_subscriptions, reward_transactions, subscribers.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched (no auth.uid() in them): contact_messages "Anyone can
-- submit contact messages" (field-validation check only), newsletter_subscriptions "Authenticated users
-- can subscribe their own email" (validates against auth.jwt() email — a different function, and an
-- INSERT check is single-row anyway), subscribers "Service role can create subscriptions" (true).
-- identity_verifications: only the two SELECT policies are rewritten; the column-scoped grants from
-- migration 20261031 are grants, not policies, and are unaffected.
-- Proof: PR15 (others-blindness + admin visibility) and the strict recheck.

-- ============ contact_messages (2 of 3) ============
DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
CREATE POLICY "Admins can update contact messages" ON public.contact_messages FOR UPDATE TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all contact messages" ON public.contact_messages;
CREATE POLICY "Admins can view all contact messages" ON public.contact_messages FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ============ crypto_address_nonces (2) ============
DROP POLICY IF EXISTS "Users insert own nonces" ON public.crypto_address_nonces;
CREATE POLICY "Users insert own nonces" ON public.crypto_address_nonces FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own nonces" ON public.crypto_address_nonces;
CREATE POLICY "Users view own nonces" ON public.crypto_address_nonces FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ identity_verifications (2) ============
DROP POLICY IF EXISTS "Admins view all identity verifications" ON public.identity_verifications;
CREATE POLICY "Admins view all identity verifications" ON public.identity_verifications FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users view own identity verifications" ON public.identity_verifications;
CREATE POLICY "Users view own identity verifications" ON public.identity_verifications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ newsletter_subscriptions (2 of 3) ============
DROP POLICY IF EXISTS "Admins can update newsletter subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can update newsletter subscriptions" ON public.newsletter_subscriptions FOR UPDATE TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins can view all newsletter subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can view all newsletter subscriptions" ON public.newsletter_subscriptions FOR SELECT TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ============ reward_transactions (2) ============
DROP POLICY IF EXISTS "System can manage reward transactions" ON public.reward_transactions;
CREATE POLICY "System can manage reward transactions" ON public.reward_transactions FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view their own reward transactions" ON public.reward_transactions;
CREATE POLICY "Users can view their own reward transactions" ON public.reward_transactions FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ subscribers (2 of 3) ============
DROP POLICY IF EXISTS "Admins can manage all subscriptions" ON public.subscribers;
CREATE POLICY "Admins can manage all subscriptions" ON public.subscribers FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view own subscription only" ON public.subscribers;
CREATE POLICY "Users can view own subscription only" ON public.subscribers FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);
