
-- Scheduled/Recurring Payments table
CREATE TABLE public.scheduled_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  recipient_name text NOT NULL,
  recipient_account text,
  recipient_bank text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZMW',
  payment_method text NOT NULL DEFAULT 'wallet',
  frequency text NOT NULL DEFAULT 'monthly',
  description text,
  next_run_at timestamp with time zone NOT NULL,
  last_run_at timestamp with time zone,
  end_date timestamp with time zone,
  total_runs integer NOT NULL DEFAULT 0,
  max_runs integer,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.scheduled_payments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own scheduled payments"
  ON public.scheduled_payments FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own scheduled payments"
  ON public.scheduled_payments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scheduled payments"
  ON public.scheduled_payments FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scheduled payments"
  ON public.scheduled_payments FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service can manage all scheduled payments"
  ON public.scheduled_payments FOR ALL
  USING (true);

-- Index for finding due payments
CREATE INDEX idx_scheduled_payments_next_run ON public.scheduled_payments (next_run_at) WHERE status = 'active';
CREATE INDEX idx_scheduled_payments_user ON public.scheduled_payments (user_id);
