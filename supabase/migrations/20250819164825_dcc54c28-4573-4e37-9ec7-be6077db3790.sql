-- Create subscriptions table for PayPal integration
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  paypal_subscription_id TEXT,
  paypal_plan_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create invoices table for payment tracking
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subscription_id UUID REFERENCES public.subscriptions(id),
  paypal_order_id TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  invoice_number TEXT UNIQUE,
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create marketplace transactions for multi-party payments
CREATE TABLE public.marketplace_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payer_user_id UUID NOT NULL,
  receiver_user_id UUID NOT NULL,
  paypal_order_id TEXT,
  gross_amount NUMERIC NOT NULL,
  platform_fee NUMERIC NOT NULL DEFAULT 0,
  net_amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_transactions ENABLE ROW LEVEL SECURITY;

-- Subscription policies
CREATE POLICY "Users can view their own subscriptions"
ON public.subscriptions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscriptions"
ON public.subscriptions FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "System can manage subscriptions"
ON public.subscriptions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Invoice policies
CREATE POLICY "Users can view their own invoices"
ON public.invoices FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "System can manage invoices"
ON public.invoices FOR ALL
USING (true);

-- Marketplace transaction policies
CREATE POLICY "Users can view transactions they're involved in"
ON public.marketplace_transactions FOR SELECT
USING (auth.uid() = payer_user_id OR auth.uid() = receiver_user_id);

CREATE POLICY "System can manage marketplace transactions"
ON public.marketplace_transactions FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create function to generate invoice numbers
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TEXT AS $$
DECLARE
  invoice_num TEXT;
  counter INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM '[0-9]+$') AS INTEGER)), 0) + 1
  INTO counter
  FROM public.invoices
  WHERE invoice_number ~ '^INV-[0-9]+$';
  
  invoice_num := 'INV-' || LPAD(counter::TEXT, 6, '0');
  RETURN invoice_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;