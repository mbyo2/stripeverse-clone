-- 20261121 — RLS initplan rewrite, cluster 9: btc_withdrawals, crypto_payout_requests,
-- notification_preferences, payment_requests.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24, including NULL with_check entries (recreated without the clause).
-- payment_requests keys on requester_id / paid_by (not user_id) — preserved.
-- Proof: PR12 (others-blindness + exact visible-set equality for payment_requests and admin visibility
-- on crypto_payout_requests) and the strict recheck.

-- ============ btc_withdrawals (3) ============
DROP POLICY IF EXISTS "Admins update btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Admins update btc withdrawals" ON public.btc_withdrawals FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users insert own btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Users insert own btc withdrawals" ON public.btc_withdrawals FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users view own btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Users view own btc withdrawals" ON public.btc_withdrawals FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ crypto_payout_requests (3) ============
DROP POLICY IF EXISTS "Admins update payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Admins update payout requests" ON public.crypto_payout_requests FOR UPDATE TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Vendors create own payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Vendors create own payout requests" ON public.crypto_payout_requests FOR INSERT TO authenticated WITH CHECK (((SELECT auth.uid()) = user_id) AND (status = 'pending'::text));

DROP POLICY IF EXISTS "Vendors view own payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Vendors view own payout requests" ON public.crypto_payout_requests FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

-- ============ notification_preferences (3) ============
DROP POLICY IF EXISTS "Users can insert their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can insert their own notification preferences" ON public.notification_preferences FOR INSERT TO public WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update their own notification preferences" ON public.notification_preferences FOR UPDATE TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can view their own notification preferences" ON public.notification_preferences FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ payment_requests (3) ============
DROP POLICY IF EXISTS "Payer can mark request as paid" ON public.payment_requests;
CREATE POLICY "Payer can mark request as paid" ON public.payment_requests FOR UPDATE TO authenticated USING (((status = 'pending'::text) AND ((SELECT auth.uid()) = paid_by))) WITH CHECK ((SELECT auth.uid()) = paid_by);

DROP POLICY IF EXISTS "Users can create payment requests" ON public.payment_requests;
CREATE POLICY "Users can create payment requests" ON public.payment_requests FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = requester_id);

DROP POLICY IF EXISTS "Users can view their own requests" ON public.payment_requests;
CREATE POLICY "Users can view their own requests" ON public.payment_requests FOR SELECT TO authenticated USING (((SELECT auth.uid()) = requester_id) OR ((SELECT auth.uid()) = paid_by));
