-- 20261123 — RLS initplan rewrite, cluster 11: btc_deposit_addresses, btc_onchain_deposits,
-- marketplace_transactions, merchant_fee_schedules, notifications, role_audit.
-- Every bare auth.uid() wrapped as (SELECT auth.uid()) (InitPlan). Semantics preserved 1:1 from the live
-- pg_policies dump of 2026-10-24. NOT touched (no auth.uid()): role_audit "Block client writes to role
-- audit" (false/false) and "Service role can insert role audits" (true). Recorded: role_audit admin
-- SELECT exists twice (admin-only, and admin OR super_admin); btc_deposit_addresses owner SELECT exists
-- twice (one with an admin OR-branch); marketplace_transactions keys on payer_user_id/receiver_user_id;
-- merchant_fee_schedules on merchant_user_id.
-- Proof: PR14 (others-blindness + marketplace visible-set equality + role_audit admin/super_admin
-- visibility and plain-user blindness) and the strict recheck.

-- ============ btc_deposit_addresses (2) ============
DROP POLICY IF EXISTS "Users view own btc addresses" ON public.btc_deposit_addresses;
CREATE POLICY "Users view own btc addresses" ON public.btc_deposit_addresses FOR SELECT TO authenticated USING (((SELECT auth.uid()) = user_id) OR public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users view own deposit addresses" ON public.btc_deposit_addresses;
CREATE POLICY "Users view own deposit addresses" ON public.btc_deposit_addresses FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

-- ============ btc_onchain_deposits (2) ============
DROP POLICY IF EXISTS "btc_deposits_admin_select" ON public.btc_onchain_deposits;
CREATE POLICY "btc_deposits_admin_select" ON public.btc_onchain_deposits FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "btc_deposits_select_own" ON public.btc_onchain_deposits;
CREATE POLICY "btc_deposits_select_own" ON public.btc_onchain_deposits FOR SELECT TO authenticated USING ((user_id = (SELECT auth.uid())));

-- ============ marketplace_transactions (2) ============
DROP POLICY IF EXISTS "System can manage marketplace transactions" ON public.marketplace_transactions;
CREATE POLICY "System can manage marketplace transactions" ON public.marketplace_transactions FOR ALL TO public USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "Users can view transactions they're involved in" ON public.marketplace_transactions;
CREATE POLICY "Users can view transactions they're involved in" ON public.marketplace_transactions FOR SELECT TO public USING (((SELECT auth.uid()) = payer_user_id) OR ((SELECT auth.uid()) = receiver_user_id));

-- ============ merchant_fee_schedules (2) ============
DROP POLICY IF EXISTS "fees_admin_all" ON public.merchant_fee_schedules;
CREATE POLICY "fees_admin_all" ON public.merchant_fee_schedules FOR ALL TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role)) WITH CHECK (public.has_role((SELECT auth.uid()), 'admin'::app_role));

DROP POLICY IF EXISTS "fees_select_own" ON public.merchant_fee_schedules;
CREATE POLICY "fees_select_own" ON public.merchant_fee_schedules FOR SELECT TO authenticated USING ((merchant_user_id = (SELECT auth.uid())));

-- ============ notifications (2) ============
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE TO public USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT TO public USING ((SELECT auth.uid()) = user_id);

-- ============ role_audit (2 of 4; two uid-free policies untouched) ============
DROP POLICY IF EXISTS "Admins can view all role audits" ON public.role_audit;
CREATE POLICY "Admins can view all role audits" ON public.role_audit FOR SELECT TO authenticated USING ((public.has_role((SELECT auth.uid()), 'admin'::app_role) OR public.has_role((SELECT auth.uid()), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view role audit" ON public.role_audit;
CREATE POLICY "Admins can view role audit" ON public.role_audit FOR SELECT TO authenticated USING (public.has_role((SELECT auth.uid()), 'admin'::app_role));
