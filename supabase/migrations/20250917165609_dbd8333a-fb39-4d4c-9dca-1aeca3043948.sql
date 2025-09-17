-- Create webhook logs table for tracking webhook events
CREATE TABLE public.webhook_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  webhook_url TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'retrying')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_at TIMESTAMP WITH TIME ZONE,
  next_retry_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for webhook logs
CREATE POLICY "Only system can manage webhook logs" 
ON public.webhook_logs 
FOR ALL 
USING (true);

-- Create indexes for performance
CREATE INDEX idx_webhook_logs_event_id ON public.webhook_logs(event_id);
CREATE INDEX idx_webhook_logs_status ON public.webhook_logs(status);
CREATE INDEX idx_webhook_logs_next_retry ON public.webhook_logs(next_retry_at) WHERE next_retry_at IS NOT NULL;

-- Create payment processing table for card transactions
CREATE TABLE public.payment_processing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  transaction_id UUID,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  payment_method TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_transaction_id TEXT,
  provider_response JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS for payment processing
ALTER TABLE public.payment_processing ENABLE ROW LEVEL SECURITY;

-- Create policies for payment processing
CREATE POLICY "Users can view their own payment processing records"
ON public.payment_processing
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can manage payment processing"
ON public.payment_processing
FOR ALL
USING (true);

-- Create function to update webhook event log status
CREATE OR REPLACE FUNCTION public.update_webhook_log_status(
  p_event_id TEXT,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.webhook_logs
  SET 
    status = p_status,
    last_attempt_at = now(),
    attempt_count = attempt_count + 1,
    error_message = COALESCE(p_error_message, error_message),
    next_retry_at = CASE 
      WHEN p_status = 'failed' AND attempt_count < max_attempts 
      THEN now() + INTERVAL '5 minutes' * (attempt_count + 1)
      ELSE NULL
    END,
    updated_at = now()
  WHERE event_id = p_event_id;
  
  RETURN FOUND;
END;
$$;

-- Update timestamp triggers
CREATE TRIGGER update_webhook_logs_updated_at
  BEFORE UPDATE ON public.webhook_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payment_processing_updated_at
  BEFORE UPDATE ON public.payment_processing
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();