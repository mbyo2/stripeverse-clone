-- WSB security audit 2026-11-15 (Workstream B: Data, RLS & grants).
-- Live-proven before the fix (probe ids in workspace/audit-wsb/probes/):
--  B11/E13 calculate_merchant_fee returned a merchant's fee for an
--        arbitrary user_id to anon / any authenticated caller.
--  E19 sub_account_cap returned another user's tier cap (3 = free tier).
--  E17 direct PostgREST INSERT into api_keys minted a live key with
--      arbitrary scopes (incl. "bogus:scope") and the key authenticated
--      at developer-api (E17b). The live generate-api-key edge function
--      DOES validate scopes, so the table INSERT bypassed its allowlist.
--      Fixed by a BEFORE INSERT OR UPDATE trigger enforcing the same
--      allowlist in the database (see section 3).
--
-- CREATE OR REPLACE preserves existing function grants.

-- 1) calculate_merchant_fee: self, platform admin, or service role only.
CREATE OR REPLACE FUNCTION public.calculate_merchant_fee(p_user_id uuid, p_method text, p_amount numeric, p_currency text DEFAULT 'ZMW'::text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rate RECORD;
  v_fee NUMERIC;
BEGIN
  
  -- WSB 2026-11-15: fee schedules are per-merchant config. The function
  -- took any p_user_id with no caller check, so any signed-in (even anon)
  -- caller could read any merchant's rates. Now: self, platform admin,
  -- or the service role.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL
          OR (p_user_id IS DISTINCT FROM auth.uid()
              AND NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
                       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)))) THEN
    RAISE EXCEPTION 'Not authorized to read another merchant''s fees';
  END IF;
SELECT * INTO v_rate
  FROM public.merchant_fee_schedules
  WHERE merchant_user_id = p_user_id
    AND method = p_method
    AND currency = p_currency
    AND is_active = true
    AND effective_from <= now()
  ORDER BY effective_from DESC
  LIMIT 1;

  IF v_rate IS NULL THEN
    RETURN ROUND(p_amount * 0.029, 2);
  END IF;

  v_fee := (p_amount * v_rate.percentage_fee / 100.0) + v_rate.fixed_fee;
  IF v_fee < v_rate.min_fee THEN v_fee := v_rate.min_fee; END IF;
  IF v_rate.max_fee IS NOT NULL AND v_fee > v_rate.max_fee THEN v_fee := v_rate.max_fee; END IF;
  RETURN ROUND(v_fee, 2);
END;
$function$;

-- 2) sub_account_cap: self, platform admin, or service role only.
CREATE OR REPLACE FUNCTION public.sub_account_cap(p_user_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tier text;
BEGIN
  
  -- WSB 2026-11-15: the cap reveals the target's subscription tier
  -- (free vs paid). Same self-or-admin scoping as calculate_merchant_fee.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL
          OR (p_user_id IS DISTINCT FROM auth.uid()
              AND NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
                       OR public.has_role(auth.uid(), 'super_admin'::public.app_role)))) THEN
    RAISE EXCEPTION 'Not authorized to read another user''s sub-account cap';
  END IF;
SELECT subscription_tier INTO v_tier
  FROM public.subscribers
  WHERE user_id = p_user_id;
  IF v_tier IS NULL OR lower(v_tier) = 'free' THEN
    RETURN 3;
  END IF;
  RETURN NULL;
END;
$function$;

-- 3) api_keys: the mint allowlist is enforced in the database, not just in
--    the edge function.
--    First attempt (same day, reverted after probe F8): REVOKE INSERT FROM
--    authenticated. That broke the official mint: generate-api-key inserts
--    through getSupabaseClient, which forwards the caller's JWT, so the
--    INSERT runs as `authenticated`, not service_role. The revoke is
--    therefore restored below, and the allowlist is enforced by a trigger
--    instead -- which the edge function and direct PostgREST inserts both
--    have to pass.
--    The allowlist was probed live from generate-api-key 2026-11-15
--    (scope_not_available names every rejected scope): the 8 issuable
--    scopes are wallets:read, transactions:read, payment_links:read,
--    payment_links:write, transfers:write, bitcoin:read, webhooks:read,
--    webhooks:write. Legacy keys already in the table carry older scopes
--    (config:read, invoices:create, webhooks:manage, mobile_money:create,
--    mobile_money:read); the trigger only fires when scopes CHANGE, so
--    those keys keep working and can still be revoked (revoke-api-key
--    only flips is_active).
--    SELECT/UPDATE/DELETE for owners stay untouched (list + revoke UX).
GRANT INSERT ON public.api_keys TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_api_key_scope_allowlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scopes IS NOT NULL AND NOT (NEW.scopes <@ ARRAY[
      'wallets:read', 'transactions:read',
      'payment_links:read', 'payment_links:write',
      'transfers:write', 'bitcoin:read',
      'webhooks:read', 'webhooks:write'
    ]) THEN
      RAISE EXCEPTION 'scope_not_available: API keys can never withdraw, pay out, change settlement details or manage other keys.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.scopes IS DISTINCT FROM OLD.scopes THEN
    IF NEW.scopes IS NOT NULL AND NOT (NEW.scopes <@ ARRAY[
      'wallets:read', 'transactions:read',
      'payment_links:read', 'payment_links:write',
      'transfers:write', 'bitcoin:read',
      'webhooks:read', 'webhooks:write'
    ]) THEN
      RAISE EXCEPTION 'scope_not_available: API keys can never withdraw, pay out, change settlement details or manage other keys.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_api_key_scope_allowlist ON public.api_keys;
CREATE TRIGGER trg_api_key_scope_allowlist
  BEFORE INSERT OR UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.enforce_api_key_scope_allowlist();
