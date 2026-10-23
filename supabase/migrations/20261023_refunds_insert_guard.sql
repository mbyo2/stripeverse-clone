-- =====================================================================
-- 20261023_refunds_insert_guard.sql — close the born-approved refund.
--
-- Found live 2026-10-23 during the Phase 3 re-proofs (F4): the
-- refunds INSERT policy ("Users create own refunds") checked only
-- auth.uid() = user_id, so a user could INSERT a refund already in
-- status 'approved' with approved_by = themselves. The UPDATE-side
-- self-approval was closed in the B4 batch (20261023_p0_policy_
-- remediation.sql); the INSERT side was not constrained. No money
-- moves off a bare 'approved' row today (settlement_transaction_id
-- stays NULL until an approver settles), but the record itself is a
-- forgery. Fix mirrors the escrow B3 pattern: a user-created refund
-- must be born 'pending' with all approval/settlement fields NULL.
-- =====================================================================

DROP POLICY IF EXISTS "Users create own refunds" ON public.refunds;
CREATE POLICY "Users create own refunds" ON public.refunds
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND settlement_transaction_id IS NULL
  );
