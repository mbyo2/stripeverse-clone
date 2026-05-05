
-- 1. Fix payment_requests UPDATE policy
DROP POLICY IF EXISTS "Authenticated users can pay requests" ON public.payment_requests;
CREATE POLICY "Payer can mark request as paid"
  ON public.payment_requests
  FOR UPDATE
  TO authenticated
  USING (status = 'pending')
  WITH CHECK (auth.uid() = paid_by AND status IN ('paid','pending'));

-- Restrict updatable columns so amount/recipient/requester cannot be altered
REVOKE UPDATE ON public.payment_requests FROM authenticated;
GRANT UPDATE (status, paid_by, paid_at, transaction_id, updated_at)
  ON public.payment_requests TO authenticated;

-- 2. Restrict agent_locations to authenticated users (hides phone from anon)
DROP POLICY IF EXISTS "Anyone can view active agents" ON public.agent_locations;
CREATE POLICY "Authenticated users can view active agents"
  ON public.agent_locations
  FOR SELECT
  TO authenticated
  USING (is_active = true);

-- 3. Revoke EXECUTE from anon on all SECURITY DEFINER functions, and from
--    authenticated on internal trigger/helper/maintenance functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- Internal trigger functions (never called by clients)
REVOKE EXECUTE ON FUNCTION public.assign_default_role() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.award_transaction_points() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_user_wallet() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_virtual_card_data() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user_subscription() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.track_card_usage() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.track_transaction_usage() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM authenticated, PUBLIC;

-- Sensitive crypto/admin helpers (called from edge functions with service role)
REVOKE EXECUTE ON FUNCTION public.encrypt_card_data(text, text) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_card_data(jsonb) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.secure_encrypt_card_data(text, text) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_merchant_secret(text) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_subscriber_billing(uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.process_dunning(uuid) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.change_subscription_tier(uuid, text, boolean) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_all_wallets() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_enhanced_security_event(uuid, text, jsonb, inet, text, integer) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_crypto_balance(uuid, text, bigint) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_usage(uuid, text, text, numeric) FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_sessions() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_totp_tokens() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_session_security() FROM authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number() FROM authenticated, PUBLIC;
