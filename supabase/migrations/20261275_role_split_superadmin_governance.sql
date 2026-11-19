-- 20261275_role_split_superadmin_governance.sql
-- CEO order 2026-11-19: "Make superadmin and admin user roles different and
-- do different things in bmaglasspay.online."
-- admin = day-to-day operations; super_admin = platform governance ONLY for:
-- role management, platform/fee/pricing config, money release (payouts,
-- withdrawals, refunds, receiving credits), merchant status, KYB decisions,
-- fraud-rule editing, freeze of elevated accounts.
-- Generated from LIVE pg_policies / pg_get_functiondef state on 2026-11-19
-- (see ~/workspace/bmaglass-role-split/REPORT.md §4 for the full matrix).
-- Role checks go through the SECURITY DEFINER public.has_role() helper only.
-- No new tables/functions are created (CREATE OR REPLACE preserves ACLs),
-- so no new GRANTs are required; the two new policies are row-level rules,
-- not grantable objects.

-- =====================================================================
-- PART 1 — RLS policy narrowings (13 changes, §4a of the design report)
-- =====================================================================

-- #1 user_roles: role management is super_admin ONLY for every write.
--    Admin SELECT survives via the separate shared "Admins can view all roles".
DROP POLICY "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #2 role_requests: approving a role request IS granting a role.
DROP POLICY "Admins can update role requests" ON public.role_requests;
CREATE POLICY "Admins can update role requests" ON public.role_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #3 fraud_rules: platform rule EDITING super-only (shared SELECT keeps admin read-only).
DROP POLICY "Admins can manage all fraud rules" ON public.fraud_rules;
CREATE POLICY "Admins can manage all fraud rules" ON public.fraud_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #4 merchant_accounts: split — directory SELECT stays admin-tier, writes super-only.
DROP POLICY "Admins can manage merchant accounts" ON public.merchant_accounts;
CREATE POLICY "Admins can view merchant accounts" ON public.merchant_accounts
  FOR SELECT TO public
  USING ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)));
CREATE POLICY "Super admins can manage merchant accounts" ON public.merchant_accounts
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #5 merchant_kyb_applications: KYB review DECISIONS super-only (SELECT stays shared).
DROP POLICY "kyb_admin_update_all" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_admin_update_all" ON public.merchant_kyb_applications
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #6 merchant_fee_schedules: fee schedules are money configuration.
DROP POLICY "fees_admin_all" ON public.merchant_fee_schedules;
CREATE POLICY "fees_admin_all" ON public.merchant_fee_schedules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #7 pricing_tiers: pricing configuration is governance.
DROP POLICY "Admins can manage pricing tiers" ON public.pricing_tiers;
CREATE POLICY "Admins can manage pricing tiers" ON public.pricing_tiers
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #8 btc_settings: withdrawal minimums/limits are treasury-adjacent money config.
DROP POLICY "Admins manage btc settings" ON public.btc_settings;
CREATE POLICY "Admins manage btc settings" ON public.btc_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #9 exchange_rates: a manual rate write is money-critical config (cron writes via service role).
DROP POLICY "Admins can manage exchange rates" ON public.exchange_rates;
CREATE POLICY "Admins can manage exchange rates" ON public.exchange_rates
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #10 refunds: execution moves money. The ALL policy splits into a shared
--     SELECT (console view) + super-only management; the separate
--     "Approvers can settle refunds" UPDATE policy carried NO role check at
--     all (any non-owner user could settle) — it is narrowed to super_admin
--     in the same change (permissive-OR: both write paths must close).
DROP POLICY "Admins manage all refunds" ON public.refunds;
CREATE POLICY "Admins can view all refunds" ON public.refunds
  FOR SELECT TO public
  USING ((public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'super_admin'::app_role)));
CREATE POLICY "Super admins manage all refunds" ON public.refunds
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));
DROP POLICY "Approvers can settle refunds" ON public.refunds;
CREATE POLICY "Approvers can settle refunds" ON public.refunds
  FOR UPDATE TO authenticated
  USING ((status = 'pending'::text) AND (auth.uid() <> user_id) AND public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK ((approved_by = auth.uid()) AND (auth.uid() <> user_id) AND public.has_role(auth.uid(), 'super_admin'::app_role));

-- #11 crypto_payout_requests: payout APPROVAL releases platform money.
DROP POLICY "Admins update payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Admins update payout requests" ON public.crypto_payout_requests
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #12 btc_withdrawals: withdrawal processing releases money.
DROP POLICY "Admins update btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Admins update btc withdrawals" ON public.btc_withdrawals
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- #13 virtual_cards: card issuance/funding is a money instrument.
DROP POLICY "System can manage cards" ON public.virtual_cards;
CREATE POLICY "System can manage cards" ON public.virtual_cards
  FOR ALL TO public
  USING (public.has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::app_role));

-- =====================================================================
-- PART 2 — SQL function narrowings (7 changes, §4b of the design report)
-- Bodies are the live definitions with ONLY the gate lines changed.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.admin_create_receiving_partner(p_actor_id uuid, p_name text, p_currencies text[], p_status text DEFAULT 'prospect'::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can manage receiving partners';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_update_receiving_partner(p_actor_id uuid, p_partner_id uuid, p_status text DEFAULT NULL::text, p_currencies text[] DEFAULT NULL::text[], p_notes text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner public.receiving_partners%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can manage receiving partners';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_assign_receiving_account(p_actor_id uuid, p_account_id uuid, p_partner_id uuid, p_account_holder_name text, p_routing_number text DEFAULT NULL::text, p_account_number text DEFAULT NULL::text, p_iban text DEFAULT NULL::text, p_bic text DEFAULT NULL::text, p_sort_code text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
  v_partner public.receiving_partners%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can assign receiving account details';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_set_receiving_account_status(p_actor_id uuid, p_account_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change a receiving account status';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_record_receiving_deposit(p_actor_id uuid, p_account_id uuid, p_amount numeric, p_sender_name text DEFAULT NULL::text, p_sender_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account public.receiving_accounts%ROWTYPE;
  v_id UUID;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can record a receiving deposit';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_credit_receiving_deposit(p_actor_id uuid, p_deposit_id uuid)
 RETURNS TABLE(outcome text, deposit_id uuid, transaction_id uuid, wallet_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deposit public.receiving_deposits%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_transaction_id UUID := gen_random_uuid();
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can credit a receiving deposit';
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
$function$;


CREATE OR REPLACE FUNCTION public.admin_reject_receiving_deposit(p_actor_id uuid, p_deposit_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deposit public.receiving_deposits%ROWTYPE;
BEGIN
  IF NOT public.has_role(p_actor_id, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can reject a receiving deposit';
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
$function$;


CREATE OR REPLACE FUNCTION public.promote_user_role(p_target_user_id uuid, p_new_role app_role, p_reason text DEFAULT 'Role promotion'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        BEGIN
          IF auth.uid() IS NULL THEN
              RAISE EXCEPTION 'Not authenticated';
                END IF;
                  IF auth.uid() = p_target_user_id THEN
                      RAISE EXCEPTION 'Cannot promote yourself';
                        END IF;
                          IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
      RAISE EXCEPTION 'Only a super admin can change user roles';
                                          END IF;
                                            
                                                                            RETURN public.validate_role_change(
                                                                                p_target_user_id,
                                                                                    p_new_role::text,
                                                                                        auth.uid(),
                                                                                            p_reason
                                                                                              );
                                                                                              END;
                                                                                              $function$;


CREATE OR REPLACE FUNCTION public.validate_role_change(p_user_id uuid, p_new_role text, p_changed_by uuid, p_reason text DEFAULT 'Role change request'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  current_role TEXT;
    is_authorized BOOLEAN := false;
      role_is_valid BOOLEAN := false;
        role_is_elevated BOOLEAN := false;
        BEGIN
          SELECT role::text INTO current_role
            FROM public.user_roles
              WHERE user_id = p_user_id
                LIMIT 1;
                  SELECT EXISTS (
                      SELECT 1
                          FROM pg_enum e
                              JOIN pg_type t ON t.oid = e.enumtypid
                                  WHERE t.typname = 'app_role' AND e.enumlabel = p_new_role
                                    ) INTO role_is_valid;
                                      role_is_elevated := p_new_role IN (
                                          'admin', 'super_admin', 'p2p_admin',
                                              'support_admin', 'compliance_admin', 'finance_admin'
                                                );
                                                  IF role_is_valid AND p_changed_by IS NOT NULL AND p_changed_by != p_user_id THEN
                                                      IF public.has_role(p_changed_by, 'super_admin'::app_role) THEN
                                                            is_authorized := true;
                                                                
                                                                          END IF;
                                                                            END IF;
                                                                              PERFORM public.log_security_event(
                                                                                  p_user_id,
                                                                                      'role_change_attempt',
                                                                                          jsonb_build_object(
                                                                                                'old_role', current_role,
                                                                                                      'new_role', p_new_role,
                                                                                                            'changed_by', p_changed_by,
                                                                                                                  'authorized', is_authorized,
                                                                                                                        'reason', p_reason,
                                                                                                                              'role_is_elevated', role_is_elevated,
                                                                                                                                    'self_change_blocked', CASE WHEN p_changed_by = p_user_id THEN true ELSE false END,
                                                                                                                                          'security_patch_version', '3.0-superadmin'
                                                                                                                                              ),
                                                                                                                                                  NULL,
                                                                                                                                                      NULL,
                                                                                                                                                          CASE WHEN is_authorized THEN 1 ELSE 9 END
                                                                                                                                                            );
                                                                                                                                                              INSERT INTO public.role_audit (
                                                                                                                                                                  user_id,
                                                                                                                                                                      old_role,
                                                                                                                                                                          new_role,
                                                                                                                                                                              changed_by,
                                                                                                                                                                                  reason,
                                                                                                                                                                                      approved
                                                                                                                                                                                        ) VALUES (
                                                                                                                                                                                            p_user_id,
                                                                                                                                                                                                current_role,
                                                                                                                                                                                                    p_new_role,
                                                                                                                                                                                                        p_changed_by,
                                                                                                                                                                                                            p_reason,
                                                                                                                                                                                                                is_authorized
                                                                                                                                                                                                                  );
                                                                                                                                                                                                                    IF is_authorized THEN
                                                                                                                                                                                                                        DELETE FROM public.user_roles WHERE user_id = p_user_id;
                                                                                                                                                                                                                            INSERT INTO public.user_roles (user_id, role)
                                                                                                                                                                                                                                VALUES (p_user_id, p_new_role::app_role);
                                                                                                                                                                                                                                  END IF;
                                                                                                                                                                                                                                    RETURN is_authorized;
                                                                                                                                                                                                                                    END;
                                                                                                                                                                                                                                    $function$;


CREATE OR REPLACE FUNCTION public.admin_set_user_frozen(p_user_id uuid, p_frozen boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        DECLARE
          v_actor uuid := auth.uid();
            v_was_frozen boolean;
            BEGIN
              IF v_actor IS NULL
                   OR NOT (
                          public.has_role(v_actor, 'admin'::public.app_role)
                                 OR public.has_role(v_actor, 'super_admin'::public.app_role)
                                      ) THEN
                                          RAISE EXCEPTION 'Only an admin can freeze or unfreeze an account';
                                            END IF;
                                              IF public.has_role(p_user_id, 'super_admin'::public.app_role) THEN
                                                  RAISE EXCEPTION 'A super admin account cannot be frozen';
                                                    END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role IN ('admin'::app_role, 'p2p_admin'::app_role, 'support_admin'::app_role, 'compliance_admin'::app_role, 'finance_admin'::app_role)
  ) AND NOT public.has_role(v_actor, 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only a super admin can freeze or unfreeze an account that holds an admin-level role';
  END IF;
                                                      SELECT is_frozen INTO v_was_frozen
                                                        FROM public.profiles
                                                          WHERE id = p_user_id;
                                                            IF NOT FOUND THEN
                                                                RAISE EXCEPTION 'User profile not found';
                                                                  END IF;
                                                                    UPDATE public.profiles
                                                                         SET is_frozen = p_frozen,
                                                                                  frozen_at = CASE WHEN p_frozen THEN now() ELSE NULL END,
                                                                                           frozen_reason = CASE WHEN p_frozen THEN p_reason ELSE NULL END,
                                                                                                    updated_at = now()
                                                                                                       WHERE id = p_user_id;
                                                                                                         INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
                                                                                                           VALUES (
                                                                                                               v_actor,
                                                                                                                   CASE WHEN p_frozen THEN 'account_frozen' ELSE 'account_unfrozen' END,
                                                                                                                       'profiles',
                                                                                                                           p_user_id::text,
                                                                                                                               jsonb_build_object('is_frozen', v_was_frozen),
                                                                                                                                   jsonb_build_object('is_frozen', p_frozen, 'reason', p_reason)
                                                                                                                                     );
                                                                                                                                       RETURN jsonb_build_object(
                                                                                                                                           'success', true,
                                                                                                                                               'user_id', p_user_id,
                                                                                                                                                   'is_frozen', p_frozen
                                                                                                                                                     );
                                                                                                                                                     END;
                                                                                                                                                     $function$;


CREATE OR REPLACE FUNCTION public.transition_bank_withdrawal(p_withdrawal_id uuid, p_admin_id uuid, p_action text, p_reason text DEFAULT NULL::text, p_external_reference text DEFAULT NULL::text)
 RETURNS TABLE(outcome text, withdrawal_status text, new_balance numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_wd public.bank_withdrawals;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_ref text := NULLIF(btrim(COALESCE(p_external_reference, '')), '');
BEGIN
  -- Authoritative role gate.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = p_admin_id
      AND ur.role = 'super_admin'::app_role
  ) THEN
    outcome := 'forbidden';
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_wd FROM public.bank_withdrawals bw
  WHERE bw.id = p_withdrawal_id
  FOR UPDATE;
  IF v_wd.id IS NULL THEN
    outcome := 'not_found';
    RETURN NEXT;
    RETURN;
  END IF;

  IF p_action = 'approve' AND v_wd.status = 'pending_review' THEN
    UPDATE public.bank_withdrawals
    SET status = 'approved',
        reviewed_by = p_admin_id, reviewed_at = now(),
        admin_note = COALESCE(v_reason, admin_note),
        updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'approved';
    withdrawal_status := 'approved';

  ELSIF p_action = 'reject' AND v_wd.status = 'pending_review' THEN
    IF v_reason IS NULL THEN
      outcome := 'reason_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    PERFORM public.refund_bank_withdrawal_internal(v_wd.id, v_reason);
    UPDATE public.bank_withdrawals
    SET status = 'rejected',
        failure_reason = v_reason,
        reviewed_by = p_admin_id, reviewed_at = now(),
        refunded_at = now(), updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'rejected';
    withdrawal_status := 'rejected';

  ELSIF p_action = 'mark_paid' AND v_wd.status = 'approved' THEN
    IF v_ref IS NULL THEN
      outcome := 'reference_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    UPDATE public.bank_withdrawals
    SET status = 'paid_out',
        external_reference = v_ref,
        paid_by = p_admin_id, paid_at = now(),
        updated_at = now()
    WHERE id = v_wd.id;
    -- The money has left: the pending debit becomes a completed one.
    UPDATE public.transactions
    SET status = 'completed', updated_at = now()
    WHERE idempotency_key = v_wd.idempotency_key
      AND direction = 'outgoing'
      AND status = 'pending';
    outcome := 'paid_out';
    withdrawal_status := 'paid_out';

  ELSIF p_action = 'fail' AND v_wd.status IN ('pending_review', 'approved') THEN
    IF v_reason IS NULL THEN
      outcome := 'reason_required';
      withdrawal_status := v_wd.status;
      RETURN NEXT;
      RETURN;
    END IF;
    PERFORM public.refund_bank_withdrawal_internal(v_wd.id, v_reason);
    UPDATE public.bank_withdrawals
    SET status = 'failed',
        failure_reason = v_reason,
        refunded_at = now(), updated_at = now()
    WHERE id = v_wd.id;
    outcome := 'failed';
    withdrawal_status := 'failed';

  ELSE
    outcome := 'invalid_transition';
    withdrawal_status := v_wd.status;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT w.balance INTO new_balance FROM public.wallets w
  WHERE w.id = v_wd.wallet_id;
  RETURN NEXT;
END;
$function$;


CREATE OR REPLACE FUNCTION public.protect_kyb_review_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'super_admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.reviewed_by := OLD.reviewed_by;
  NEW.reviewed_at := OLD.reviewed_at;
  NEW.review_notes := OLD.review_notes;
  IF NEW.status NOT IN ('draft','submitted') THEN
    NEW.status := OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;

