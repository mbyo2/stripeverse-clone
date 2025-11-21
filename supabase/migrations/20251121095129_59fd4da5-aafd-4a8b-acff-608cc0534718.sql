-- Create wallet reconciliation table
CREATE TABLE IF NOT EXISTS public.wallet_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
  reconciliation_type TEXT NOT NULL CHECK (reconciliation_type IN ('manual', 'automated', 'scheduled')),
  calculated_balance NUMERIC(15, 2) NOT NULL,
  recorded_balance NUMERIC(15, 2) NOT NULL,
  difference NUMERIC(15, 2) NOT NULL,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'pending', 'failed')),
  performed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Add indexes for performance
CREATE INDEX idx_wallet_reconciliations_wallet_id ON public.wallet_reconciliations(wallet_id);
CREATE INDEX idx_wallet_reconciliations_created_at ON public.wallet_reconciliations(created_at DESC);
CREATE INDEX idx_wallet_reconciliations_status ON public.wallet_reconciliations(status);

-- Enable RLS
ALTER TABLE public.wallet_reconciliations ENABLE ROW LEVEL SECURITY;

-- Admins can view all reconciliations
CREATE POLICY "Admins can view all reconciliations"
  ON public.wallet_reconciliations
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Admins can insert reconciliations
CREATE POLICY "Admins can insert reconciliations"
  ON public.wallet_reconciliations
  FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own wallet reconciliations
CREATE POLICY "Users can view own wallet reconciliations"
  ON public.wallet_reconciliations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.wallets
      WHERE wallets.id = wallet_reconciliations.wallet_id
      AND wallets.user_id = auth.uid()
    )
  );

-- Create function to calculate wallet balance from transactions
CREATE OR REPLACE FUNCTION public.calculate_wallet_balance(p_wallet_id UUID)
RETURNS TABLE(
  calculated_balance NUMERIC,
  transaction_count INTEGER,
  last_transaction_date TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC := 0;
  v_count INTEGER := 0;
  v_last_date TIMESTAMP WITH TIME ZONE;
BEGIN
  -- Calculate balance from completed transactions
  SELECT 
    COALESCE(SUM(
      CASE 
        WHEN t.direction = 'incoming' THEN t.amount
        WHEN t.direction = 'outgoing' THEN -(t.amount + COALESCE(t.fee_amount, 0))
        ELSE 0
      END
    ), 0),
    COUNT(*),
    MAX(t.created_at)
  INTO v_balance, v_count, v_last_date
  FROM public.transactions t
  WHERE t.wallet_id = p_wallet_id
    AND t.status = 'completed';
  
  RETURN QUERY SELECT v_balance, v_count, v_last_date;
END;
$$;

-- Create function to reconcile single wallet
CREATE OR REPLACE FUNCTION public.reconcile_wallet(
  p_wallet_id UUID,
  p_reconciliation_type TEXT DEFAULT 'manual',
  p_performed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recorded_balance NUMERIC;
  v_calculated_balance NUMERIC;
  v_transaction_count INTEGER;
  v_difference NUMERIC;
  v_reconciliation_id UUID;
BEGIN
  -- Get current recorded balance
  SELECT balance INTO v_recorded_balance
  FROM public.wallets
  WHERE id = p_wallet_id;
  
  IF v_recorded_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  
  -- Calculate balance from transactions
  SELECT calculated_balance, transaction_count
  INTO v_calculated_balance, v_transaction_count
  FROM public.calculate_wallet_balance(p_wallet_id);
  
  -- Calculate difference
  v_difference := v_recorded_balance - v_calculated_balance;
  
  -- Insert reconciliation record
  INSERT INTO public.wallet_reconciliations (
    wallet_id,
    reconciliation_type,
    calculated_balance,
    recorded_balance,
    difference,
    transaction_count,
    status,
    performed_by,
    notes,
    metadata
  ) VALUES (
    p_wallet_id,
    p_reconciliation_type,
    v_calculated_balance,
    v_recorded_balance,
    v_difference,
    v_transaction_count,
    'completed',
    COALESCE(p_performed_by, auth.uid()),
    p_notes,
    jsonb_build_object(
      'reconciliation_timestamp', NOW(),
      'has_discrepancy', ABS(v_difference) > 0.01
    )
  )
  RETURNING id INTO v_reconciliation_id;
  
  -- If there's a discrepancy, log a security event
  IF ABS(v_difference) > 0.01 THEN
    PERFORM public.log_enhanced_security_event(
      (SELECT user_id FROM public.wallets WHERE id = p_wallet_id),
      'wallet_balance_discrepancy',
      jsonb_build_object(
        'wallet_id', p_wallet_id,
        'recorded_balance', v_recorded_balance,
        'calculated_balance', v_calculated_balance,
        'difference', v_difference,
        'reconciliation_id', v_reconciliation_id
      ),
      NULL,
      NULL,
      7 -- High risk score
    );
  END IF;
  
  RETURN v_reconciliation_id;
END;
$$;

-- Create function to reconcile all wallets
CREATE OR REPLACE FUNCTION public.reconcile_all_wallets()
RETURNS TABLE(
  wallet_id UUID,
  user_id UUID,
  reconciliation_id UUID,
  has_discrepancy BOOLEAN,
  difference NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet RECORD;
  v_reconciliation_id UUID;
BEGIN
  FOR v_wallet IN 
    SELECT w.id, w.user_id 
    FROM public.wallets w
    WHERE w.status = 'active'
  LOOP
    -- Reconcile each wallet
    v_reconciliation_id := public.reconcile_wallet(
      v_wallet.id,
      'automated',
      NULL,
      'Automated reconciliation run'
    );
    
    -- Return results
    RETURN QUERY
    SELECT 
      wr.wallet_id,
      v_wallet.user_id,
      wr.id as reconciliation_id,
      ABS(wr.difference) > 0.01 as has_discrepancy,
      wr.difference
    FROM public.wallet_reconciliations wr
    WHERE wr.id = v_reconciliation_id;
  END LOOP;
END;
$$;

-- Create function to fix wallet balance discrepancies
CREATE OR REPLACE FUNCTION public.fix_wallet_balance(
  p_wallet_id UUID,
  p_performed_by UUID DEFAULT NULL,
  p_notes TEXT DEFAULT 'Balance correction applied'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_calculated_balance NUMERIC;
  v_recorded_balance NUMERIC;
  v_user_id UUID;
BEGIN
  -- Get wallet info
  SELECT balance, user_id INTO v_recorded_balance, v_user_id
  FROM public.wallets
  WHERE id = p_wallet_id;
  
  IF v_recorded_balance IS NULL THEN
    RAISE EXCEPTION 'Wallet not found';
  END IF;
  
  -- Calculate correct balance
  SELECT calculated_balance INTO v_calculated_balance
  FROM public.calculate_wallet_balance(p_wallet_id);
  
  -- Update wallet balance
  UPDATE public.wallets
  SET 
    balance = v_calculated_balance,
    updated_at = NOW()
  WHERE id = p_wallet_id;
  
  -- Log the correction
  PERFORM public.log_enhanced_security_event(
    v_user_id,
    'wallet_balance_corrected',
    jsonb_build_object(
      'wallet_id', p_wallet_id,
      'old_balance', v_recorded_balance,
      'new_balance', v_calculated_balance,
      'performed_by', COALESCE(p_performed_by, auth.uid()),
      'notes', p_notes
    ),
    NULL,
    NULL,
    5 -- Medium risk score
  );
  
  -- Create reconciliation record
  PERFORM public.reconcile_wallet(
    p_wallet_id,
    'manual',
    COALESCE(p_performed_by, auth.uid()),
    p_notes || ' - Balance corrected'
  );
  
  RETURN TRUE;
END;
$$;