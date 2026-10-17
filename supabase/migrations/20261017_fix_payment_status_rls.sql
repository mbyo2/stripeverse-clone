-- Fix: enable RLS on payment_status_updates (if the table exists).
-- The original migration (20250917165237) had a typo:
--   ENABLE ROW_LEVEL SECURITY  (invalid — underscores)
-- instead of:
--   ENABLE ROW LEVEL SECURITY  (correct — spaces)
-- Note: the table may not exist in all environments (it was never
-- applied to some databases). This is conditional to be safe.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'payment_status_updates') THEN
    ALTER TABLE public.payment_status_updates ENABLE ROW LEVEL SECURITY;

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
  END IF;
END $$;
