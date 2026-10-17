-- Merchant payment plan installment tracking.
--
-- merchant_payment_plans tracks the plan header (totals, counts, next date)
-- but had no per-installment record. This table records each collected
-- installment so merchants have a real payment history and per-installment
-- status instead of just a paid-count.

CREATE TABLE IF NOT EXISTS public.plan_installment_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.merchant_payment_plans(id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_method TEXT NOT NULL DEFAULT 'manual',
  reference TEXT,
  notes TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (plan_id, installment_number)
);

ALTER TABLE public.plan_installment_payments ENABLE ROW LEVEL SECURITY;

-- Merchants manage payments for their own plans
DROP POLICY IF EXISTS "Merchants manage own plan payments" ON public.plan_installment_payments;
CREATE POLICY "Merchants manage own plan payments"
ON public.plan_installment_payments FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.merchant_payment_plans p
    WHERE p.id = plan_installment_payments.plan_id
    AND p.merchant_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.merchant_payment_plans p
    WHERE p.id = plan_installment_payments.plan_id
    AND p.merchant_id = auth.uid()
  )
);

CREATE INDEX IF NOT EXISTS idx_plan_installment_payments_plan
ON public.plan_installment_payments (plan_id);
