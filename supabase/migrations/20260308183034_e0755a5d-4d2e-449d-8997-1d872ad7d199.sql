
-- Merchant Payment Plans (merchant-created installments for their customers)
CREATE TABLE public.merchant_payment_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id UUID NOT NULL,
  customer_email TEXT NOT NULL,
  customer_name TEXT,
  description TEXT,
  total_amount NUMERIC NOT NULL,
  installment_amount NUMERIC NOT NULL,
  installments_total INTEGER NOT NULL DEFAULT 4,
  installments_paid INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  frequency TEXT NOT NULL DEFAULT 'monthly',
  next_payment_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_payment_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their payment plans" ON public.merchant_payment_plans FOR ALL USING (auth.uid() = merchant_id);

-- Escrow Transactions
CREATE TABLE public.escrow_transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL,
  seller_id UUID NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  release_conditions TEXT,
  funded_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  disputed_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.escrow_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their escrow transactions" ON public.escrow_transactions FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);
CREATE POLICY "Buyers can create escrow" ON public.escrow_transactions FOR INSERT WITH CHECK (auth.uid() = buyer_id);
CREATE POLICY "Participants can update escrow" ON public.escrow_transactions FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- Savings Accounts
CREATE TABLE public.savings_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'Savings',
  balance NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  interest_rate NUMERIC NOT NULL DEFAULT 3.5,
  interest_earned NUMERIC NOT NULL DEFAULT 0,
  last_interest_date TIMESTAMPTZ DEFAULT now(),
  target_amount NUMERIC,
  target_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  auto_save_amount NUMERIC,
  auto_save_frequency TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.savings_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their savings" ON public.savings_accounts FOR ALL USING (auth.uid() = user_id);

-- Bill Payments
CREATE TABLE public.bill_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  biller_name TEXT NOT NULL,
  biller_code TEXT,
  category TEXT NOT NULL DEFAULT 'utilities',
  account_number TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bill_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their bill payments" ON public.bill_payments FOR ALL USING (auth.uid() = user_id);

-- Agent Locations (cash-in/cash-out network)
CREATE TABLE public.agent_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_name TEXT NOT NULL,
  agent_code TEXT NOT NULL UNIQUE,
  location_name TEXT NOT NULL,
  address TEXT,
  city TEXT NOT NULL,
  province TEXT,
  country TEXT NOT NULL DEFAULT 'ZM',
  latitude NUMERIC,
  longitude NUMERIC,
  phone TEXT,
  services TEXT[] DEFAULT ARRAY['cash_in', 'cash_out'],
  operating_hours JSONB,
  is_active BOOLEAN NOT NULL DEFAULT true,
  daily_limit NUMERIC DEFAULT 50000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view active agents" ON public.agent_locations FOR SELECT USING (is_active = true);

-- Fraud Rules (transaction monitoring engine)
CREATE TABLE public.fraud_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rule_type TEXT NOT NULL DEFAULT 'velocity',
  conditions JSONB NOT NULL DEFAULT '{}',
  action TEXT NOT NULL DEFAULT 'flag',
  severity TEXT NOT NULL DEFAULT 'medium',
  is_active BOOLEAN NOT NULL DEFAULT true,
  merchant_id UUID,
  hits_count INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fraud_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can view fraud rules" ON public.fraud_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage fraud rules" ON public.fraud_rules FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- API IP Whitelist
CREATE TABLE public.api_ip_whitelist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  ip_address TEXT NOT NULL,
  label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.api_ip_whitelist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their IP whitelist" ON public.api_ip_whitelist FOR ALL USING (auth.uid() = user_id);

-- AML Screenings
CREATE TABLE public.aml_screenings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  screening_type TEXT NOT NULL DEFAULT 'sanctions',
  full_name TEXT NOT NULL,
  date_of_birth TEXT,
  country TEXT,
  risk_level TEXT NOT NULL DEFAULT 'low',
  match_found BOOLEAN NOT NULL DEFAULT false,
  match_details JSONB,
  status TEXT NOT NULL DEFAULT 'completed',
  screened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.aml_screenings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their screenings" ON public.aml_screenings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage screenings" ON public.aml_screenings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Add updated_at triggers
CREATE TRIGGER update_merchant_payment_plans_updated_at BEFORE UPDATE ON public.merchant_payment_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_escrow_transactions_updated_at BEFORE UPDATE ON public.escrow_transactions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_savings_accounts_updated_at BEFORE UPDATE ON public.savings_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bill_payments_updated_at BEFORE UPDATE ON public.bill_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_agent_locations_updated_at BEFORE UPDATE ON public.agent_locations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_fraud_rules_updated_at BEFORE UPDATE ON public.fraud_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
