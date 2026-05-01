-- Vendor connected EVM addresses
CREATE TABLE public.vendor_crypto_wallets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  label TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMP WITH TIME ZONE,
  signature TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, chain_id, address)
);

CREATE INDEX idx_vendor_crypto_wallets_user ON public.vendor_crypto_wallets(user_id);

ALTER TABLE public.vendor_crypto_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors view own crypto wallets"
  ON public.vendor_crypto_wallets FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Vendors insert own crypto wallets"
  ON public.vendor_crypto_wallets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Vendors update own crypto wallets"
  ON public.vendor_crypto_wallets FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Vendors delete own crypto wallets"
  ON public.vendor_crypto_wallets FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_vendor_crypto_wallets_updated_at
  BEFORE UPDATE ON public.vendor_crypto_wallets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Payout requests
CREATE TABLE public.crypto_payout_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chain_id INTEGER NOT NULL,
  token_symbol TEXT NOT NULL,
  token_address TEXT,
  amount NUMERIC(38, 18) NOT NULL CHECK (amount > 0),
  destination_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','sent','failed')),
  tx_hash TEXT,
  admin_notes TEXT,
  processed_by UUID REFERENCES auth.users(id),
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_crypto_payout_requests_user ON public.crypto_payout_requests(user_id);
CREATE INDEX idx_crypto_payout_requests_status ON public.crypto_payout_requests(status);

ALTER TABLE public.crypto_payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Vendors view own payout requests"
  ON public.crypto_payout_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Vendors create own payout requests"
  ON public.crypto_payout_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins update payout requests"
  ON public.crypto_payout_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_crypto_payout_requests_updated_at
  BEFORE UPDATE ON public.crypto_payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Treasury config (admin-only)
CREATE TABLE public.crypto_treasury_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chain_id INTEGER NOT NULL UNIQUE,
  safe_address TEXT NOT NULL,
  label TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.crypto_treasury_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage treasury config"
  ON public.crypto_treasury_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_crypto_treasury_config_updated_at
  BEFORE UPDATE ON public.crypto_treasury_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Address ownership nonces (short-lived)
CREATE TABLE public.crypto_address_nonces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (now() + INTERVAL '10 minutes'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_crypto_address_nonces_user ON public.crypto_address_nonces(user_id);
CREATE INDEX idx_crypto_address_nonces_expires ON public.crypto_address_nonces(expires_at);

ALTER TABLE public.crypto_address_nonces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own nonces"
  ON public.crypto_address_nonces FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own nonces"
  ON public.crypto_address_nonces FOR SELECT TO authenticated
  USING (auth.uid() = user_id);