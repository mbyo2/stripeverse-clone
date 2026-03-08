
-- Create the update_updated_at function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Webhook delivery logs table
CREATE TABLE public.webhook_delivery_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  webhook_url text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamp with time zone,
  last_attempt_at timestamp with time zone,
  error_message text,
  response_status integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_delivery_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Business owners view webhook logs"
  ON public.webhook_delivery_logs FOR SELECT
  USING (EXISTS (SELECT 1 FROM merchant_accounts ma WHERE ma.id = webhook_delivery_logs.business_id AND ma.user_id = auth.uid()));

CREATE POLICY "System manages webhook logs"
  ON public.webhook_delivery_logs FOR ALL USING (true);

-- Settlement reports table
CREATE TABLE public.settlement_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL,
  period_start timestamp with time zone NOT NULL,
  period_end timestamp with time zone NOT NULL,
  total_transactions integer NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  total_fees numeric NOT NULL DEFAULT 0,
  net_amount numeric NOT NULL DEFAULT 0,
  refunds_amount numeric NOT NULL DEFAULT 0,
  chargebacks_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZMW',
  status text NOT NULL DEFAULT 'pending',
  settled_at timestamp with time zone,
  payout_reference text,
  bank_account_id uuid REFERENCES bank_accounts(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.settlement_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own settlements"
  ON public.settlement_reports FOR SELECT USING (auth.uid() = merchant_id);

CREATE POLICY "System manages settlements"
  ON public.settlement_reports FOR ALL USING (true);

-- Card tokens table for PCI tokenization
CREATE TABLE public.card_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  card_last_four text NOT NULL,
  card_brand text NOT NULL DEFAULT 'visa',
  card_exp_month integer NOT NULL,
  card_exp_year integer NOT NULL,
  cardholder_name text,
  fingerprint text,
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  billing_address jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.card_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own card tokens"
  ON public.card_tokens FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_webhook_logs_business ON webhook_delivery_logs(business_id);
CREATE INDEX idx_webhook_logs_status ON webhook_delivery_logs(status, next_retry_at);
CREATE INDEX idx_settlement_merchant ON settlement_reports(merchant_id);
CREATE INDEX idx_card_tokens_user ON card_tokens(user_id);

-- Triggers
CREATE TRIGGER update_webhook_delivery_logs_updated_at
  BEFORE UPDATE ON webhook_delivery_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settlement_reports_updated_at
  BEFORE UPDATE ON settlement_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_card_tokens_updated_at
  BEFORE UPDATE ON card_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
