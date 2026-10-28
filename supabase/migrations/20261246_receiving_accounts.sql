-- ============================================================================
-- Local receiving accounts (virtual USD / EUR / GBP) — platform side.
--
-- Payoneer-gap programme (CEO order 2026-10-28: "Do a research and
-- implement"). This migration builds the registry, the admin
-- assignment workbench and the inbound-credit ledger. The banking
-- partner that ISSUES account details is a separate commercial step.
--
-- Honesty doctrine (non-negotiable):
--   * The platform NEVER invents account numbers, IBANs, sort codes
--     or routing numbers. Detail fields stay NULL until an admin
--     records details actually issued by a partner whose status is
--     'live', and the assignment RPC refuses any other partner.
--   * platform_settings.receiving_accounts_enabled defaults FALSE.
--     While off, requests are refused (RPC) and the user surface
--     explains the feature is being set up. Flipping the flag on
--     does NOT by itself produce account details for anyone.
--   * KYC is just-in-time: requesting an account requires verified
--     KYC (kyc_verifications.verified_at), reusing the existing
--     verification — no new KYC is built here.
--
-- Money doctrine (same as the telco ledger, 20261237):
--   * An inbound payment is first RECORDED by an admin against an
--     assigned/active account (no balance movement), then CREDITED
--     by a separate locked RPC. The credit runs exactly once: the
--     deposit row is locked FOR UPDATE and only a 'recorded' row can
--     transition to 'credited'; a replay answers 'already_credited'
--     and moves nothing.
--   * The credit creates the user's matching-currency wallet when
--     absent (main account scope, account_id NULL), inside the same
--     transaction, guarded by an advisory lock on (user, currency).
--
-- Access model:
--   * The user request RPC is called with the caller's JWT
--     (EXECUTE to authenticated; anon revoked) — it moves no money.
--   * Admin RPCs are EXECUTE-granted to service_role ONLY and are
--     reached exclusively through the receiving-admin edge function,
--     which verifies the caller's JWT, gates on admin/super_admin,
--     then calls them JWT-free with p_actor_id. This is the house
--     money pattern (see _shared/supabase-client.ts): the
--     protect_wallet_balance trigger neutralises balance UPDATEs
--     made while a user JWT is in scope, so the credit RPC must run
--     without one. The RPCs still re-check the actor's role
--     (has_role(admin) OR has_role(super_admin)) and write an
--     audit_logs row per action under the actor id.
--   * RLS is enabled on every table; clients can only SELECT their
--     own rows (admins: all rows). There are no client write
--     policies and no direct table write grants.
--   * GRANTs follow the CEO rule of 2026-10-28: explicit and scoped,
--     in the same migration as the CREATE TABLE; never TO public.
-- ============================================================================

-- ── Kill switch ──────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS receiving_accounts_enabled boolean NOT NULL DEFAULT false;

-- ── Partners ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.receiving_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  currencies TEXT[] NOT NULL DEFAULT '{}'
    CHECK (currencies <@ ARRAY['USD', 'EUR', 'GBP']::text[]),
  status TEXT NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'onboarding', 'live')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.receiving_partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view all receiving partners" ON public.receiving_partners;
CREATE POLICY "Admins view all receiving partners"
ON public.receiving_partners FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role));

DROP POLICY IF EXISTS "Users view live receiving partners" ON public.receiving_partners;
CREATE POLICY "Users view live receiving partners"
ON public.receiving_partners FOR SELECT TO authenticated
USING (status = 'live');

GRANT SELECT ON public.receiving_partners TO authenticated;

-- ── Receiving accounts ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.receiving_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_id UUID REFERENCES public.receiving_partners(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'pending_partner', 'assigned', 'active', 'suspended', 'closed')),
  account_holder_name TEXT,
  -- USD details (partner-issued only; NULL until assigned)
  routing_number TEXT,
  account_number TEXT,
  -- EUR details
  iban TEXT,
  bic TEXT,
  -- GBP details (uses account_number above, plus sort code)
  sort_code TEXT,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

CREATE INDEX IF NOT EXISTS idx_receiving_accounts_status
  ON public.receiving_accounts(status, created_at);
CREATE INDEX IF NOT EXISTS idx_receiving_accounts_partner
  ON public.receiving_accounts(partner_id)
  WHERE partner_id IS NOT NULL;

ALTER TABLE public.receiving_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own receiving accounts" ON public.receiving_accounts;
CREATE POLICY "Users view own receiving accounts"
ON public.receiving_accounts FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all receiving accounts" ON public.receiving_accounts;
CREATE POLICY "Admins view all receiving accounts"
ON public.receiving_accounts FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role));

GRANT SELECT ON public.receiving_accounts TO authenticated;

-- ── Receiving deposits (inbound payments) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.receiving_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_account_id UUID NOT NULL REFERENCES public.receiving_accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(20, 2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL CHECK (currency IN ('USD', 'EUR', 'GBP')),
  sender_name TEXT,
  sender_reference TEXT,
  status TEXT NOT NULL DEFAULT 'recorded'
    CHECK (status IN ('recorded', 'credited', 'rejected')),
  wallet_id UUID REFERENCES public.wallets(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES public.transactions(uuid_id) ON DELETE SET NULL,
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  credited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  credited_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_receiving_deposits_account
  ON public.receiving_deposits(receiving_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receiving_deposits_user
  ON public.receiving_deposits(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_receiving_deposits_status
  ON public.receiving_deposits(status, created_at)
  WHERE status = 'recorded';

ALTER TABLE public.receiving_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own receiving deposits" ON public.receiving_deposits;
CREATE POLICY "Users view own receiving deposits"
ON public.receiving_deposits FOR SELECT TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all receiving deposits" ON public.receiving_deposits;
CREATE POLICY "Admins view all receiving deposits"
ON public.receiving_deposits FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role)
       OR public.has_role(auth.uid(), 'super_admin'::app_role));

GRANT SELECT ON public.receiving_deposits TO authenticated;

-- ── Helper: receiving-accounts flag ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.receiving_accounts_flag_on()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT receiving_accounts_enabled FROM public.platform_settings
     WHERE id = true),
    false);
$$;

REVOKE EXECUTE ON FUNCTION public.receiving_accounts_flag_on() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receiving_accounts_flag_on() TO authenticated;

-- ── User: request a receiving account ────────────────────────────────
-- Outcomes: unauthenticated / feature_not_enabled / invalid_currency /
-- kyc_required / already_exists / requested.
CREATE OR REPLACE FUNCTION public.request_receiving_account(
  p_currency TEXT
)
RETURNS TABLE(outcome TEXT, account_id UUID, account_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_currency TEXT := upper(coalesce(p_currency, ''));
  v_existing public.receiving_accounts%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    outcome := 'unauthenticated'; account_id := NULL; account_status := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF NOT public.receiving_accounts_flag_on() THEN
    outcome := 'feature_not_enabled'; account_id := NULL; account_status := NULL;
    RETURN NEXT; RETURN;
  END IF;
  IF v_currency NOT IN ('USD', 'EUR', 'GBP') THEN
    outcome := 'invalid_currency'; account_id := NULL; account_status := NULL;
    RETURN NEXT; RETURN;
  END IF;
  -- Just-in-time KYC: a receiving account is issued in the user's
  -- legal name, so verified KYC is required at request time.
  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_verifications kv
    WHERE kv.user_id = v_user AND kv.verified_at IS NOT NULL
  ) THEN
    outcome := 'kyc_required'; account_id := NULL; account_status := NULL;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.receiving_accounts
  WHERE user_id = v_user AND currency = v_currency;

  IF FOUND AND v_existing.status <> 'closed' THEN
    outcome := 'already_exists';
    account_id := v_existing.id; account_status := v_existing.status;
    RETURN NEXT; RETURN;
  END IF;

  IF FOUND THEN
    -- Reopen a closed account as a fresh request; stale partner
    -- details are cleared — they are never resurrected for display.
    UPDATE public.receiving_accounts
    SET status = 'requested', partner_id = NULL,
        account_holder_name = NULL, routing_number = NULL,
        account_number = NULL, iban = NULL, bic = NULL,
        sort_code = NULL, assigned_by = NULL, assigned_at = NULL,
        updated_at = now()
    WHERE id = v_existing.id;
    outcome := 'requested';
    account_id := v_existing.id; account_status := 'requested';
    RETURN NEXT; RETURN;
  END IF;

  INSERT INTO public.receiving_accounts (user_id, currency, status)
  VALUES (v_user, v_currency, 'requested')
  RETURNING id INTO account_id;
  outcome := 'requested'; account_status := 'requested';
  RETURN NEXT; RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_receiving_account(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_receiving_account(TEXT) TO authenticated;

-- ── Admin: partner management ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_create_receiving_partner(
  p_actor_id UUID,
  p_name TEXT,
  p_currencies TEXT[],
  p_status TEXT DEFAULT 'prospect',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can manage receiving partners';
  END IF;
  IF coalesce(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'A partner name is required';
  END IF;
  IF coalesce(p_status, 'prospect') NOT IN ('prospect', 'onboarding', 'live') THEN
    RAISE EXCEPTION 'Partner status must be prospect, onboarding or live';
  END IF;
  IF p_currencies IS NOT NULL
     AND NOT (p_currencies <@ ARRAY['USD', 'EUR', 'GBP']::text[]) THEN
    RAISE EXCEPTION 'Partner currencies can only be USD, EUR or GBP';
  END IF;

  INSERT INTO public.receiving_partners (name, currencies, status, notes, created_by)
  VALUES (trim(p_name), coalesce(p_currencies, '{}'), coalesce(p_status, 'prospect'),
          p_notes, p_actor_id)
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (p_actor_id, 'receiving_partner_created', 'receiving_partners', v_id::text,
          jsonb_build_object('name', trim(p_name),
                             'currencies', coalesce(p_currencies, '{}'),
                             'status', coalesce(p_status, 'prospect')));
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_receiving_partner(UUID, TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_receiving_partner(UUID, TEXT, TEXT[], TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_update_receiving_partner(
  p_actor_id UUID,
  p_partner_id UUID,
  p_status TEXT DEFAULT NULL,
  p_currencies TEXT[] DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner public.receiving_partners%ROWTYPE;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can manage receiving partners';
  END IF;
  SELECT * INTO v_partner FROM public.receiving_partners WHERE id = p_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That partner could not be found';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('prospect', 'onboarding', 'live') THEN
    RAISE EXCEPTION 'Partner status must be prospect, onboarding or live';
  END IF;
  IF p_currencies IS NOT NULL
     AND NOT (p_currencies <@ ARRAY['USD', 'EUR', 'GBP']::text[]) THEN
    RAISE EXCEPTION 'Partner currencies can only be USD, EUR or GBP';
  END IF;

  UPDATE public.receiving_partners
  SET status = coalesce(p_status, status),
      currencies = coalesce(p_currencies, currencies),
      notes = coalesce(p_notes, notes),
      updated_at = now()
  WHERE id = p_partner_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (p_actor_id, 'receiving_partner_updated', 'receiving_partners', p_partner_id::text,
          jsonb_build_object('status', v_partner.status, 'currencies', v_partner.currencies),
          jsonb_build_object('status', coalesce(p_status, v_partner.status),
                             'currencies', coalesce(p_currencies, v_partner.currencies)));
  RETURN 'updated';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_receiving_partner(UUID, UUID, TEXT, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_receiving_partner(UUID, UUID, TEXT, TEXT[], TEXT) TO service_role;

-- ── Admin: assign partner-issued details ─────────────────────────────
-- The ONLY path by which detail fields are ever written. The partner
-- must be 'live' and must support the account currency; the fields
-- required for that currency must be present.
CREATE OR REPLACE FUNCTION public.admin_assign_receiving_account(
  p_actor_id UUID,
  p_account_id UUID,
  p_partner_id UUID,
  p_account_holder_name TEXT,
  p_routing_number TEXT DEFAULT NULL,
  p_account_number TEXT DEFAULT NULL,
  p_iban TEXT DEFAULT NULL,
  p_bic TEXT DEFAULT NULL,
  p_sort_code TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
  v_partner public.receiving_partners%ROWTYPE;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can assign receiving account details';
  END IF;

  SELECT * INTO v_account FROM public.receiving_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That receiving account could not be found';
  END IF;
  IF v_account.status IN ('active', 'suspended', 'closed') THEN
    RAISE EXCEPTION 'This account already has details assigned — suspend or close it before reassigning';
  END IF;

  SELECT * INTO v_partner FROM public.receiving_partners WHERE id = p_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That partner could not be found';
  END IF;
  IF v_partner.status <> 'live' THEN
    RAISE EXCEPTION 'Details can only be recorded from a live partner — this partner is not live yet';
  END IF;
  IF NOT (v_account.currency = ANY (v_partner.currencies)) THEN
    RAISE EXCEPTION 'This partner does not issue accounts in that currency';
  END IF;
  IF coalesce(trim(p_account_holder_name), '') = '' THEN
    RAISE EXCEPTION 'The account holder name exactly as issued is required';
  END IF;
  IF v_account.currency = 'USD'
     AND (coalesce(trim(p_routing_number), '') = ''
          OR coalesce(trim(p_account_number), '') = '') THEN
    RAISE EXCEPTION 'A USD account needs the routing number and account number exactly as issued';
  END IF;
  IF v_account.currency = 'EUR' AND coalesce(trim(p_iban), '') = '' THEN
    RAISE EXCEPTION 'A EUR account needs the IBAN exactly as issued';
  END IF;
  IF v_account.currency = 'GBP'
     AND (coalesce(trim(p_sort_code), '') = ''
          OR coalesce(trim(p_account_number), '') = '') THEN
    RAISE EXCEPTION 'A GBP account needs the sort code and account number exactly as issued';
  END IF;

  UPDATE public.receiving_accounts
  SET partner_id = p_partner_id,
      status = 'assigned',
      account_holder_name = trim(p_account_holder_name),
      routing_number = nullif(trim(coalesce(p_routing_number, '')), ''),
      account_number = nullif(trim(coalesce(p_account_number, '')), ''),
      iban = nullif(trim(coalesce(p_iban, '')), ''),
      bic = nullif(trim(coalesce(p_bic, '')), ''),
      sort_code = nullif(trim(coalesce(p_sort_code, '')), ''),
      assigned_by = p_actor_id,
      assigned_at = now(),
      updated_at = now()
  WHERE id = p_account_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (p_actor_id, 'receiving_account_assigned', 'receiving_accounts', p_account_id::text,
          jsonb_build_object('partner_id', p_partner_id,
                             'currency', v_account.currency,
                             'user_id', v_account.user_id));
  RETURN 'assigned';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_assign_receiving_account(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_receiving_account(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ── Admin: account lifecycle (activate / suspend / reinstate / close) ─
CREATE OR REPLACE FUNCTION public.admin_set_receiving_account_status(
  p_actor_id UUID,
  p_account_id UUID,
  p_status TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can change a receiving account status';
  END IF;
  IF p_status NOT IN ('pending_partner', 'active', 'suspended', 'closed') THEN
    RAISE EXCEPTION 'That status change is not available here';
  END IF;
  SELECT * INTO v_account FROM public.receiving_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That receiving account could not be found';
  END IF;
  IF p_status = 'pending_partner' AND v_account.status <> 'requested' THEN
    RAISE EXCEPTION 'Only a requested account can move to pending with partner';
  END IF;
  IF p_status = 'active' AND v_account.status NOT IN ('assigned', 'suspended') THEN
    RAISE EXCEPTION 'Only an assigned or suspended account can be activated';
  END IF;
  IF p_status = 'suspended' AND v_account.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active account can be suspended';
  END IF;
  IF p_status = 'closed' AND v_account.status = 'closed' THEN
    RAISE EXCEPTION 'That account is already closed';
  END IF;

  UPDATE public.receiving_accounts
  SET status = p_status, updated_at = now()
  WHERE id = p_account_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
  VALUES (p_actor_id, 'receiving_account_status_changed', 'receiving_accounts', p_account_id::text,
          jsonb_build_object('status', v_account.status),
          jsonb_build_object('status', p_status));
  RETURN p_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_receiving_account_status(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_receiving_account_status(UUID, UUID, TEXT) TO service_role;

-- ── Admin: record an arrived payment (no balance movement) ───────────
CREATE OR REPLACE FUNCTION public.admin_record_receiving_deposit(
  p_actor_id UUID,
  p_account_id UUID,
  p_amount NUMERIC,
  p_sender_name TEXT DEFAULT NULL,
  p_sender_reference TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
  v_id UUID;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can record a receiving deposit';
  END IF;
  SELECT * INTO v_account FROM public.receiving_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That receiving account could not be found';
  END IF;
  IF v_account.status NOT IN ('assigned', 'active') THEN
    RAISE EXCEPTION 'Payments can only be recorded against an account with issued details';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'The received amount must be greater than zero';
  END IF;

  INSERT INTO public.receiving_deposits (
    receiving_account_id, user_id, amount, currency,
    sender_name, sender_reference, recorded_by
  ) VALUES (
    p_account_id, v_account.user_id, p_amount, v_account.currency,
    nullif(trim(coalesce(p_sender_name, '')), ''),
    nullif(trim(coalesce(p_sender_reference, '')), ''),
    p_actor_id
  )
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (p_actor_id, 'receiving_deposit_recorded', 'receiving_deposits', v_id::text,
          jsonb_build_object('account_id', p_account_id,
                             'user_id', v_account.user_id,
                             'amount', p_amount,
                             'currency', v_account.currency));
  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_record_receiving_deposit(UUID, UUID, NUMERIC, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_record_receiving_deposit(UUID, UUID, NUMERIC, TEXT, TEXT) TO service_role;

-- ── Admin: credit a recorded deposit — EXACTLY ONCE ──────────────────
CREATE OR REPLACE FUNCTION public.admin_credit_receiving_deposit(
  p_actor_id UUID,
  p_deposit_id UUID
)
RETURNS TABLE(outcome TEXT, deposit_id UUID, transaction_id UUID, wallet_balance NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit public.receiving_deposits%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_transaction_id UUID := gen_random_uuid();
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can credit a receiving deposit';
  END IF;

  SELECT * INTO v_deposit
  FROM public.receiving_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit could not be found';
  END IF;
  IF v_deposit.status = 'credited' THEN
    outcome := 'already_credited';
    deposit_id := v_deposit.id;
    transaction_id := v_deposit.transaction_id;
    SELECT balance INTO wallet_balance FROM public.wallets WHERE id = v_deposit.wallet_id;
    RETURN NEXT; RETURN;
  END IF;
  IF v_deposit.status = 'rejected' THEN
    outcome := 'deposit_rejected';
    deposit_id := v_deposit.id;
    transaction_id := NULL;
    wallet_balance := NULL;
    RETURN NEXT; RETURN;
  END IF;

  -- Find-or-create the user's matching-currency wallet (main scope).
  PERFORM pg_advisory_xact_lock(
    hashtext('receiving_wallet:' || v_deposit.user_id::text || ':' || v_deposit.currency));
  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = v_deposit.user_id
    AND currency = v_deposit.currency
    AND account_id IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.wallets (user_id, currency, balance, status, account_id)
    VALUES (v_deposit.user_id, v_deposit.currency, 0, 'active', NULL)
    RETURNING * INTO v_wallet;
  END IF;
  IF v_wallet.status = 'closed' THEN
    RAISE EXCEPTION 'The receiving wallet is closed — this deposit cannot be credited';
  END IF;

  INSERT INTO public.transactions (
    uuid_id, user_id, wallet_id, amount, currency, direction, status,
    payment_method, provider, reference, transaction_id,
    recipient_name, recipient_account, description, category,
    metadata, idempotency_key
  ) VALUES (
    v_transaction_id, v_deposit.user_id, v_wallet.id, v_deposit.amount,
    v_deposit.currency, 'incoming', 'completed',
    'bank_transfer', 'receiving_account',
    coalesce(v_deposit.sender_reference, v_deposit.id::text),
    'receiving:' || v_deposit.id::text,
    v_deposit.sender_name,
    NULL,
    'Payment received to your ' || v_deposit.currency || ' receiving account',
    'deposit',
    jsonb_build_object(
      'kind', 'receiving_deposit',
      'deposit_id', v_deposit.id,
      'receiving_account_id', v_deposit.receiving_account_id
    ),
    'receiving-deposit:' || v_deposit.id::text
  );

  UPDATE public.wallets
  SET balance = balance + v_deposit.amount, updated_at = now()
  WHERE id = v_wallet.id
  RETURNING balance INTO wallet_balance;

  UPDATE public.receiving_deposits
  SET status = 'credited', wallet_id = v_wallet.id,
      transaction_id = v_transaction_id,
      credited_by = p_actor_id, credited_at = now(), updated_at = now()
  WHERE id = v_deposit.id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (p_actor_id, 'receiving_deposit_credited', 'receiving_deposits', v_deposit.id::text,
          jsonb_build_object('user_id', v_deposit.user_id,
                             'amount', v_deposit.amount,
                             'currency', v_deposit.currency,
                             'transaction_id', v_transaction_id));

  outcome := 'credited';
  deposit_id := v_deposit.id;
  transaction_id := v_transaction_id;
  RETURN NEXT; RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_credit_receiving_deposit(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_credit_receiving_deposit(UUID, UUID) TO service_role;

-- ── Admin: reject a recorded deposit (never credited) ────────────────
CREATE OR REPLACE FUNCTION public.admin_reject_receiving_deposit(
  p_actor_id UUID,
  p_deposit_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deposit public.receiving_deposits%ROWTYPE;
BEGIN
  IF NOT (public.has_role(p_actor_id, 'admin'::app_role)
          OR public.has_role(p_actor_id, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only an admin can reject a receiving deposit';
  END IF;
  SELECT * INTO v_deposit
  FROM public.receiving_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That deposit could not be found';
  END IF;
  IF v_deposit.status = 'credited' THEN
    RAISE EXCEPTION 'A credited deposit cannot be rejected';
  END IF;
  IF v_deposit.status = 'rejected' THEN
    RETURN 'already_rejected';
  END IF;

  UPDATE public.receiving_deposits
  SET status = 'rejected', rejection_reason = p_reason, updated_at = now()
  WHERE id = p_deposit_id;

  INSERT INTO public.audit_logs (user_id, action, table_name, record_id, new_values)
  VALUES (p_actor_id, 'receiving_deposit_rejected', 'receiving_deposits', p_deposit_id::text,
          jsonb_build_object('reason', p_reason));
  RETURN 'rejected';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_reject_receiving_deposit(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_receiving_deposit(UUID, UUID, TEXT) TO service_role;
