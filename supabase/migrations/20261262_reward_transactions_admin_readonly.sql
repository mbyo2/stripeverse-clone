-- 20261262_reward_transactions_admin_readonly.sql
-- Audit-trail hardening, 2026-11-11 (item B1): reward_transactions carried
-- an admin ALL policy ("System can manage reward transactions"), leaving
-- the reward ledger editable and deletable by any admin through the API.
-- The only legitimate writer is award_transaction_points — a SECURITY
-- DEFINER trigger function on transactions, owned by postgres — so
-- issuance never passes through this policy and is unaffected by the
-- narrowing. Client code only ever SELECTs the table (useRewards).
--
-- The ALL policy is replaced with a SELECT-only policy for the admin
-- role. The existing "Users can view their own reward transactions"
-- SELECT policy is untouched.

DROP POLICY IF EXISTS "System can manage reward transactions" ON public.reward_transactions;

DROP POLICY IF EXISTS "Admins can view reward transactions" ON public.reward_transactions;
CREATE POLICY "Admins can view reward transactions" ON public.reward_transactions
  FOR SELECT TO public
  USING (has_role(auth.uid(), 'admin'::app_role));
