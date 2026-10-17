-- Escrow, bulk payments, and refunds: real money movement support.
--
-- 1. escrow_transactions: track the hold transaction and settlement
-- 2. bulk_payment_items: ensure error tracking columns exist
-- 3. refunds: ensure approval workflow columns exist

-- ── Escrow: track settlement ──
ALTER TABLE public.escrow_transactions
ADD COLUMN IF NOT EXISTS hold_transaction_id UUID,
ADD COLUMN IF NOT EXISTS settlement_transaction_id UUID,
ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- ── Bulk payment items: ensure status tracking ──
-- (columns already exist per 20260308174617; verify error_message exists)
ALTER TABLE public.bulk_payment_items
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS transaction_id UUID,
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- ── Refunds: approval workflow ──
-- (status, approved_by, approved_at already exist per 20260308174617)
-- Add rejected tracking and settlement reference
ALTER TABLE public.refunds
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS settlement_transaction_id UUID;

-- Allow refund recipients (original transaction counterparties) to update status
-- The existing "Admins manage all refunds" policy covers admins.
-- Users need to update refunds where they are the approver.
DROP POLICY IF EXISTS "Recipients can approve refunds" ON public.refunds;
CREATE POLICY "Recipients can approve refunds"
ON public.refunds FOR UPDATE TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
