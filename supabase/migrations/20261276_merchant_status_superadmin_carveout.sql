-- 20261276: merchant status changes become possible for super_admin.
--
-- Found during the role-split QA proof (2026-11-19): migration
-- 20261275 split merchant_accounts writes to super_admin at the RLS
-- layer, but the BEFORE UPDATE trigger protect_merchant_privileged_
-- columns() silently reverted NEW.status for EVERY authenticated
-- caller, so a super_admin's status change through the API was a
-- no-op (state-verified: status stayed 'pending'). The trigger
-- exists to stop merchant OWNERS self-approving via the own-row
-- update policy; it was written before any admin status path.
--
-- Fix: the status revert now applies only when the caller is NOT a
-- super_admin (has_role SECURITY DEFINER check, the same helper the
-- policies use). The credential columns (api_key, webhook_secret)
-- stay reverted for every authenticated caller, exactly as before.
-- Service-role callers (auth.uid() NULL) are untouched, as before.
-- CREATE OR REPLACE preserves the function's ACL; no new objects,
-- so no GRANT section is needed.

CREATE OR REPLACE FUNCTION public.protect_merchant_privileged_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
      NEW.status := OLD.status;
    END IF;
    NEW.api_key := OLD.api_key;
    NEW.webhook_secret := OLD.webhook_secret;
  END IF;
  RETURN NEW;
END;
$function$;
