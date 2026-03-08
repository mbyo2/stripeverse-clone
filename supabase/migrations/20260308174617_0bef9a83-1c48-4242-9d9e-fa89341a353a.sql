
-- Bank accounts for transfers
CREATE TABLE public.bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  bank_code TEXT,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT 'savings',
  currency TEXT NOT NULL DEFAULT 'ZMW',
  country TEXT NOT NULL DEFAULT 'ZM',
  swift_code TEXT,
  routing_number TEXT,
  is_verified BOOLEAN DEFAULT false,
  is_primary BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bank accounts" ON public.bank_accounts FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_bank_accounts_user ON public.bank_accounts(user_id);

-- Payment links (shareable checkout pages)
CREATE TABLE public.payment_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  amount NUMERIC,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  link_code TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(8), 'hex'),
  status TEXT NOT NULL DEFAULT 'active',
  payment_count INTEGER DEFAULT 0,
  total_collected NUMERIC DEFAULT 0,
  max_payments INTEGER,
  expires_at TIMESTAMPTZ,
  redirect_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own payment links" ON public.payment_links FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Public can view active payment links" ON public.payment_links FOR SELECT USING (status = 'active');
CREATE INDEX idx_payment_links_code ON public.payment_links(link_code);
CREATE INDEX idx_payment_links_user ON public.payment_links(user_id);

-- Subaccounts for split payments
CREATE TABLE public.subaccounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_name TEXT NOT NULL,
  account_email TEXT,
  bank_account_id UUID REFERENCES public.bank_accounts(id),
  split_type TEXT NOT NULL DEFAULT 'percentage',
  split_value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  total_received NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subaccounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own subaccounts" ON public.subaccounts FOR ALL USING (auth.uid() = owner_id);
CREATE INDEX idx_subaccounts_owner ON public.subaccounts(owner_id);

-- Split rules for transactions
CREATE TABLE public.split_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  subaccount_id UUID NOT NULL REFERENCES public.subaccounts(id) ON DELETE CASCADE,
  split_type TEXT NOT NULL DEFAULT 'percentage',
  split_value NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.split_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own split rules" ON public.split_rules FOR ALL USING (auth.uid() = owner_id);

-- Currency conversions history
CREATE TABLE public.currency_conversions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  from_amount NUMERIC NOT NULL,
  to_amount NUMERIC NOT NULL,
  exchange_rate NUMERIC NOT NULL,
  fee_amount NUMERIC DEFAULT 0,
  from_wallet_id UUID REFERENCES public.wallets(id),
  to_wallet_id UUID REFERENCES public.wallets(id),
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.currency_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own conversions" ON public.currency_conversions FOR ALL USING (auth.uid() = user_id);

-- Bulk payments
CREATE TABLE public.bulk_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  total_items INTEGER NOT NULL DEFAULT 0,
  completed_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  status TEXT NOT NULL DEFAULT 'draft',
  processed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bulk_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bulk payments" ON public.bulk_payments FOR ALL USING (auth.uid() = user_id);

-- Bulk payment items
CREATE TABLE public.bulk_payment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bulk_payment_id UUID NOT NULL REFERENCES public.bulk_payments(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  recipient_account TEXT,
  recipient_bank TEXT,
  recipient_phone TEXT,
  recipient_email TEXT,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  transaction_id UUID,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bulk_payment_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bulk payment items" ON public.bulk_payment_items FOR ALL 
  USING (EXISTS (SELECT 1 FROM public.bulk_payments bp WHERE bp.id = bulk_payment_id AND bp.user_id = auth.uid()));

-- Refunds
CREATE TABLE public.refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZMW',
  reason TEXT NOT NULL,
  refund_type TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own refunds" ON public.refunds FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users create own refunds" ON public.refunds FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage all refunds" ON public.refunds FOR ALL USING (
  public.has_role(auth.uid(), 'admin')
);

-- Add triggers for updated_at
CREATE TRIGGER update_bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_payment_links_updated_at BEFORE UPDATE ON public.payment_links FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_subaccounts_updated_at BEFORE UPDATE ON public.subaccounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_split_rules_updated_at BEFORE UPDATE ON public.split_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_bulk_payments_updated_at BEFORE UPDATE ON public.bulk_payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER update_refunds_updated_at BEFORE UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
