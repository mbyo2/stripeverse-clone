
-- Revoke EXECUTE from PUBLIC (which implicitly grants to anon) on all public functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END$$;

-- Grant EXECUTE back to authenticated for user-facing helpers only
GRANT EXECUTE ON FUNCTION public.get_user_wallet_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_transaction_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_monthly_transaction_data(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_spending_by_category(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recent_transactions(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_rewards(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tier_features(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_feature_access(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_advanced_rate_limit(text, text, integer, integer, inet) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_usage_limit(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(uuid, text, jsonb, inet, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_card_access_attempt(uuid, uuid, text, inet, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_wallet_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_wallet(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fix_wallet_balance(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_role_change(uuid, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_merchant_api_key(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_wallet_balance(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_security_maintenance() TO authenticated;
