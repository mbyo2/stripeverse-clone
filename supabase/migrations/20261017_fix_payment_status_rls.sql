-- Fix: enable RLS on payment_status_updates.
-- The original migration (20250917165237) had a typo:
--   ENABLE ROW_LEVEL SECURITY  (invalid — underscores)
-- instead of:
--   ENABLE ROW LEVEL SECURITY  (correct — spaces)
-- The statement failed silently, leaving payment history readable
-- without restriction. This migration corrects it.

ALTER TABLE public.payment_status_updates ENABLE ROW LEVEL SECURITY;

-- Users can view status updates for their own payments.
-- (Restrictive: service role bypasses RLS for system writes.)
DROP POLICY IF EXISTS "Users view own payment status updates" ON public.payment_status_updates;
CREATE POLICY "Users view own payment status updates"
ON public.payment_status_updates FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = payment_status_updates.transaction_id
    AND t.user_id = auth.uid()
  )
);
