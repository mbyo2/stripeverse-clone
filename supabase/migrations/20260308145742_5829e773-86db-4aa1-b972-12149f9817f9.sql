
-- Payment Requests (Request Money & Payment Links)
CREATE TABLE public.payment_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id uuid NOT NULL,
  recipient_email text,
  recipient_phone text,
  amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZMW',
  description text,
  status text NOT NULL DEFAULT 'pending',
  payment_link_code text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  expires_at timestamp with time zone DEFAULT (now() + interval '7 days'),
  paid_at timestamp with time zone,
  paid_by uuid,
  transaction_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create payment requests" ON public.payment_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "Users can view their own requests" ON public.payment_requests FOR SELECT TO authenticated USING (auth.uid() = requester_id OR auth.uid() = paid_by);
CREATE POLICY "Anyone can view by payment link" ON public.payment_requests FOR SELECT USING (payment_link_code IS NOT NULL);
CREATE POLICY "Authenticated users can pay requests" ON public.payment_requests FOR UPDATE TO authenticated USING (status = 'pending');

-- Saved Contacts
CREATE TABLE public.saved_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  contact_name text NOT NULL,
  phone_number text,
  email text,
  is_favorite boolean NOT NULL DEFAULT false,
  last_transacted_at timestamp with time zone,
  transaction_count integer NOT NULL DEFAULT 0,
  avatar_url text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, phone_number),
  UNIQUE(user_id, email)
);

ALTER TABLE public.saved_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own contacts" ON public.saved_contacts FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Budget Goals
CREATE TABLE public.budget_goals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  target_amount numeric NOT NULL,
  current_amount numeric NOT NULL DEFAULT 0,
  category text,
  icon text DEFAULT 'piggy-bank',
  color text DEFAULT '#3B82F6',
  deadline timestamp with time zone,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.budget_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own goals" ON public.budget_goals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Merchant Invoices
CREATE TABLE public.merchant_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  merchant_id uuid NOT NULL,
  customer_email text NOT NULL,
  customer_name text,
  invoice_number text NOT NULL DEFAULT ('INV-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 4)),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'ZMW',
  due_date timestamp with time zone,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  payment_link_code text UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  paid_at timestamp with time zone,
  sent_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.merchant_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Merchants can manage their invoices" ON public.merchant_invoices FOR ALL TO authenticated USING (auth.uid() = merchant_id) WITH CHECK (auth.uid() = merchant_id);
CREATE POLICY "Anyone can view invoice by link" ON public.merchant_invoices FOR SELECT USING (payment_link_code IS NOT NULL);

-- BNPL Plans
CREATE TABLE public.bnpl_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  transaction_id uuid,
  total_amount numeric NOT NULL,
  installment_amount numeric NOT NULL,
  installments_total integer NOT NULL DEFAULT 4,
  installments_paid integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ZMW',
  next_payment_date timestamp with time zone,
  status text NOT NULL DEFAULT 'active',
  merchant_name text,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.bnpl_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own BNPL plans" ON public.bnpl_plans FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "System can manage BNPL plans" ON public.bnpl_plans FOR ALL USING (true);

-- Monthly spending budgets
CREATE TABLE public.spending_budgets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  category text NOT NULL,
  monthly_limit numeric NOT NULL,
  month_year text NOT NULL DEFAULT to_char(now(), 'YYYY-MM'),
  spent_amount numeric NOT NULL DEFAULT 0,
  alert_threshold numeric NOT NULL DEFAULT 0.8,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, category, month_year)
);

ALTER TABLE public.spending_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own budgets" ON public.spending_budgets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
