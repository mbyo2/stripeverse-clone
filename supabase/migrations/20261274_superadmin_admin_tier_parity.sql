-- Superadmin admin-tier parity (CEO order 2026-11-19: "Make
-- superadmin in bmaglasspay.online see all users" + "add every
-- feature for superadmin to run bmaglasspay.online smoothly").
--
-- ROOT CAUSE (diagnosed live 2026-11-19): the platform's own
-- convention is that super_admin is ADDITIVE over admin — a
-- super_admin must be able to do everything an admin can (see
-- src/lib/roleVisibility.ts, _shared/auth.ts requireAdmin, and
-- public.p2p_is_admin, which all encode admin OR super_admin).
-- But 49 RLS policies and 2 SQL functions were written against the
-- 'admin' role alone. The owner's account is masked because it
-- holds BOTH roles; any super_admin-only operator is locked out of
-- KYC review, identity review, audit logs, AML, compliance, fraud
-- rules, merchant management, KYB review, webhook logs and more.
-- The user directory itself (admin_list_users) already checks
-- admin OR super_admin and returns every user — proven live.
--
-- This migration rewrites each admin-only policy predicate from
--   has_role(auth.uid(), 'admin')
-- to
--   (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'super_admin'))
-- preserving each policy's name, table, command, roles and shape
-- (generated from the live pg_policies dump of 2026-11-19 and
-- verified statement-by-statement after applying). Plain users and
-- the specialist roles gain nothing: the added branch names
-- super_admin only. Super_admin-ONLY surfaces (treasury,
-- crypto_treasury_config) are deliberately untouched.
--
-- It also fixes the two SQL functions with the same admin-only
-- gate (requeue_webhook_delivery, protect_kyb_review_columns) and
-- adds admin_update_platform_settings(): until now NO client —
-- not even a superadmin — could change a fee or flip a platform
-- kill switch without direct database access, because
-- platform_settings has no UPDATE policy at all. The RPC is
-- super_admin-gated, whitelists the editable operational columns,
-- validates types/ranges, and writes an audit_logs row per change.

-- =====================================================================
-- Part 1: the 49 admin-only RLS policies, recreated with parity.
-- =====================================================================

DROP POLICY IF EXISTS "Admins can manage AML screenings" ON public.aml_screenings;
CREATE POLICY "Admins can manage AML screenings" ON public.aml_screenings FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage screenings" ON public.aml_screenings;
CREATE POLICY "Admins can manage screenings" ON public.aml_screenings FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all AML screenings" ON public.aml_screenings;
CREATE POLICY "Admins can view all AML screenings" ON public.aml_screenings FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all beta feedback" ON public.beta_feedback;
CREATE POLICY "Admins can view all beta feedback" ON public.beta_feedback FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Users view own btc addresses" ON public.btc_deposit_addresses;
CREATE POLICY "Users view own btc addresses" ON public.btc_deposit_addresses FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "btc_deposits_admin_select" ON public.btc_onchain_deposits;
CREATE POLICY "btc_deposits_admin_select" ON public.btc_onchain_deposits FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins manage btc settings" ON public.btc_settings;
CREATE POLICY "Admins manage btc settings" ON public.btc_settings FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins update btc withdrawals" ON public.btc_withdrawals;
CREATE POLICY "Admins update btc withdrawals" ON public.btc_withdrawals FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage compliance checks" ON public.compliance_checks;
CREATE POLICY "Admins can manage compliance checks" ON public.compliance_checks FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all compliance checks" ON public.compliance_checks;
CREATE POLICY "Admins can view all compliance checks" ON public.compliance_checks FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can update contact messages" ON public.contact_messages;
CREATE POLICY "Admins can update contact messages" ON public.contact_messages FOR UPDATE TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all contact messages" ON public.contact_messages;
CREATE POLICY "Admins can view all contact messages" ON public.contact_messages FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins update payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Admins update payout requests" ON public.crypto_payout_requests FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Vendors view own payout requests" ON public.crypto_payout_requests;
CREATE POLICY "Vendors view own payout requests" ON public.crypto_payout_requests FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "Admins can manage all dispute messages" ON public.dispute_messages;
CREATE POLICY "Admins can manage all dispute messages" ON public.dispute_messages FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage exchange rates" ON public.exchange_rates;
CREATE POLICY "Admins can manage exchange rates" ON public.exchange_rates FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage all fraud rules" ON public.fraud_rules;
CREATE POLICY "Admins can manage all fraud rules" ON public.fraud_rules FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view fraud rules" ON public.fraud_rules;
CREATE POLICY "Admins can view fraud rules" ON public.fraud_rules FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins view all identity verifications" ON public.identity_verifications;
CREATE POLICY "Admins view all identity verifications" ON public.identity_verifications FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can update KYC verifications" ON public.kyc_verifications;
CREATE POLICY "Admins can update KYC verifications" ON public.kyc_verifications FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all KYC verifications" ON public.kyc_verifications;
CREATE POLICY "Admins can view all KYC verifications" ON public.kyc_verifications FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "System can manage marketplace transactions" ON public.marketplace_transactions;
CREATE POLICY "System can manage marketplace transactions" ON public.marketplace_transactions FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage merchant accounts" ON public.merchant_accounts;
CREATE POLICY "Admins can manage merchant accounts" ON public.merchant_accounts FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "fees_admin_all" ON public.merchant_fee_schedules;
CREATE POLICY "fees_admin_all" ON public.merchant_fee_schedules FOR ALL TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "kyb_admin_select_all" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_admin_select_all" ON public.merchant_kyb_applications FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "kyb_admin_update_all" ON public.merchant_kyb_applications;
CREATE POLICY "kyb_admin_update_all" ON public.merchant_kyb_applications FOR UPDATE TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can update newsletter subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can update newsletter subscriptions" ON public.newsletter_subscriptions FOR UPDATE TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all newsletter subscriptions" ON public.newsletter_subscriptions;
CREATE POLICY "Admins can view all newsletter subscriptions" ON public.newsletter_subscriptions FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Owners view their payout batches" ON public.payout_batches;
CREATE POLICY "Owners view their payout batches" ON public.payout_batches FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "Owners view their payouts" ON public.payouts;
CREATE POLICY "Owners view their payouts" ON public.payouts FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "Admins can manage pricing tiers" ON public.pricing_tiers;
CREATE POLICY "Admins can manage pricing tiers" ON public.pricing_tiers FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Owners view their provider intents" ON public.provider_intents;
CREATE POLICY "Owners view their provider intents" ON public.provider_intents FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "Only admins can view rate limits" ON public.rate_limits;
CREATE POLICY "Only admins can view rate limits" ON public.rate_limits FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view reward transactions" ON public.reward_transactions;
CREATE POLICY "Admins can view reward transactions" ON public.reward_transactions FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view role audit" ON public.role_audit;
CREATE POLICY "Admins can view role audit" ON public.role_audit FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all security events" ON public.security_events;
CREATE POLICY "Admins can view all security events" ON public.security_events FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view security events" ON public.security_events;
CREATE POLICY "Admins can view security events" ON public.security_events FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage all subscriptions" ON public.subscribers;
CREATE POLICY "Admins can manage all subscriptions" ON public.subscribers FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "System can manage subscriptions" ON public.subscriptions;
CREATE POLICY "System can manage subscriptions" ON public.subscriptions FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage categories" ON public.transaction_categories;
CREATE POLICY "Admins can manage categories" ON public.transaction_categories FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can manage all disputes" ON public.transaction_disputes;
CREATE POLICY "Admins can manage all disputes" ON public.transaction_disputes FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "System can manage user rewards" ON public.user_rewards;
CREATE POLICY "System can manage user rewards" ON public.user_rewards FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all sanctions" ON public.user_sanctions;
CREATE POLICY "Admins can view all sanctions" ON public.user_sanctions FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Vendors view own crypto wallets" ON public.vendor_crypto_wallets;
CREATE POLICY "Vendors view own crypto wallets" ON public.vendor_crypto_wallets FOR SELECT TO authenticated
  USING (((( SELECT auth.uid() AS uid) = user_id) OR (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))));

DROP POLICY IF EXISTS "System can manage cards" ON public.virtual_cards;
CREATE POLICY "System can manage cards" ON public.virtual_cards FOR ALL TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can insert reconciliations" ON public.wallet_reconciliations;
CREATE POLICY "Admins can insert reconciliations" ON public.wallet_reconciliations FOR INSERT TO public
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins can view all reconciliations" ON public.wallet_reconciliations;
CREATE POLICY "Admins can view all reconciliations" ON public.wallet_reconciliations FOR SELECT TO public
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

DROP POLICY IF EXISTS "Admins view all webhook logs" ON public.webhook_delivery_logs;
CREATE POLICY "Admins view all webhook logs" ON public.webhook_delivery_logs FOR SELECT TO authenticated
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)));

-- =====================================================================
-- Part 2: the two SQL functions with an admin-only gate.
-- =====================================================================

-- requeue_webhook_delivery: a super_admin must be able to requeue a
-- stuck merchant webhook delivery, exactly like an admin (the
-- merchant-owner branch is unchanged).
CREATE OR REPLACE FUNCTION public.requeue_webhook_delivery(p_log_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.merchant_accounts ma
      WHERE ma.id = w.business_id AND ma.user_id = auth.uid()
    )
  )
  INTO v_allowed
  FROM public.webhook_delivery_logs w
  WHERE w.id = p_log_id;

  IF v_allowed IS NOT TRUE THEN
    RAISE EXCEPTION 'Not authorised to requeue this webhook delivery';
  END IF;

  UPDATE public.webhook_delivery_logs
  SET status = 'pending',
      attempts = 0,
      next_retry_at = now(),
      error_message = NULL,
      response_status = NULL,
      updated_at = now()
  WHERE id = p_log_id;

  RETURN true;
END;
$function$;

-- protect_kyb_review_columns: a super_admin reviewing a merchant
-- KYB application must be able to write the review columns,
-- exactly like an admin (other callers still have them protected).
CREATE OR REPLACE FUNCTION public.protect_kyb_review_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR auth.uid() IS NULL THEN
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

-- =====================================================================
-- Part 3: admin_update_platform_settings — the superadmin settings
-- write path. Super_admin ONLY (fees and kill switches are
-- platform-critical; plain admins keep their existing read access
-- via the table's SELECT policy). Column whitelist enforced
-- server-side; every applied change is audit-logged.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_update_platform_settings(p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_key text;
  v_val jsonb;
  v_old jsonb;
  v_applied jsonb := '{}'::jsonb;
  v_bool_keys text[] := ARRAY[
    'p2p_enabled','pos_enabled','mtn_momo_enabled','airtel_money_enabled',
    'moonpay_enabled','moonpay_selfcustody_enabled','paypal_payouts_enabled',
    'bank_payouts_enabled','receiving_accounts_enabled',
    'face_verification_enabled','btc_rebalance_enabled','btc_batch_enabled',
    'btc_consolidation_enabled'
  ];
  v_fee_keys text[] := ARRAY[
    'send_money_fee_percent','transfer_fee_percent',
    'split_platform_fee_percent','p2p_fee_percent',
    'paypal_platform_fee_percent','paypal_payout_fee_percent',
    'bank_payout_fee_percent'
  ];
  v_amount_keys text[] := ARRAY['bank_payout_min_zmw','paypal_float_allowance_usd'];
BEGIN
  IF v_actor IS NULL OR NOT public.has_role(v_actor, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can change platform settings';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Settings patch must be an object';
  END IF;

  SELECT to_jsonb(s) INTO v_old FROM public.platform_settings s WHERE s.id;

  FOR v_key, v_val IN SELECT * FROM jsonb_each(p_patch) LOOP
    IF v_key = ANY (v_bool_keys) THEN
      IF jsonb_typeof(v_val) <> 'boolean' THEN
        RAISE EXCEPTION 'Setting % must be true or false', v_key;
      END IF;
      EXECUTE format('UPDATE public.platform_settings SET %I = $1 WHERE id', v_key)
        USING (v_val #>> '{}')::boolean;
    ELSIF v_key = ANY (v_fee_keys) THEN
      IF jsonb_typeof(v_val) <> 'number'
         OR (v_val #>> '{}')::numeric < 0
         OR (v_val #>> '{}')::numeric > 100 THEN
        RAISE EXCEPTION 'Fee % must be a number between 0 and 100', v_key;
      END IF;
      EXECUTE format('UPDATE public.platform_settings SET %I = $1 WHERE id', v_key)
        USING (v_val #>> '{}')::numeric;
    ELSIF v_key = ANY (v_amount_keys) THEN
      IF jsonb_typeof(v_val) <> 'number' OR (v_val #>> '{}')::numeric < 0 THEN
        RAISE EXCEPTION 'Amount % must be a number of 0 or more', v_key;
      END IF;
      EXECUTE format('UPDATE public.platform_settings SET %I = $1 WHERE id', v_key)
        USING (v_val #>> '{}')::numeric;
    ELSE
      RAISE EXCEPTION 'Unknown or read-only setting: %', v_key;
    END IF;
    v_applied := v_applied || jsonb_build_object(v_key, v_val);
  END LOOP;

  IF v_applied <> '{}'::jsonb THEN
    INSERT INTO public.audit_logs (user_id, action, table_name, record_id, old_values, new_values)
    VALUES (
      v_actor,
      'platform_settings_update',
      'platform_settings',
      'singleton',
      (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(v_applied) AS k),
      v_applied
    );
  END IF;

  RETURN (SELECT to_jsonb(s) FROM public.platform_settings s WHERE s.id);
END;
$function$;

-- Match the established function-privilege posture (admin_list_users):
-- authenticated callers only; the in-function super_admin check is
-- the real gate. anon/PUBLIC get nothing.
REVOKE EXECUTE ON FUNCTION public.admin_update_platform_settings(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_update_platform_settings(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_platform_settings(jsonb) TO service_role;
