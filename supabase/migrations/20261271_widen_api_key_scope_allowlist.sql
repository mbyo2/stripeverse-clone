-- 20261271: widen the api_keys scope allowlist to the documented 14 scopes.
--
-- DRIFT (found live 2026-11-15, ext-hunt workstream 5): the trigger
-- installed by 20261269_wsb_data_scope_fixes.sql allows only 8 scopes
-- (wallets:read, transactions:read, payment_links:read,
-- payment_links:write, transfers:write, bitcoin:read, webhooks:read,
-- webhooks:write) — but the developer API's own contract issues 14
-- (supabase/functions/_shared/connector-config.ts ALLOWED_KEY_SCOPES
-- and DEFAULT_KEY_SCOPES, plus public/openapi.json):
--   config:read, invoices:create, invoices:read, webhooks:manage,
--   mobile_money:create, mobile_money:read.
--
-- LIVE PROOF the 6 are unmintable today (2026-11-15, sandbox QA user):
--   * generate-api-key with any one of the 6 alone -> 500 internal_error
--     (the function sanitises them as allowed, the INSERT then trips
--     this trigger, and the generic catch maps it to 500 — never the
--     clean 400 scope_not_available the function promises).
--   * generate-api-key with NO scopes (DEFAULT_KEY_SCOPES, 11 scopes
--     incl. 5 of the 6) -> 500 internal_error. The default mint path is
--     broken too.
--   * Direct INSERT of an api_keys row with scopes ['config:read'] ->
--     42501 scope_not_available from enforce_api_key_scope_allowlist();
--     the same INSERT with ['wallets:read'] succeeds. The trigger, not
--     the function, is the gate — it fires on every insert path.
--   * Consequence, also proven live: GET /connector/config with any
--     key minted after the trigger landed -> 403 insufficient_scope
--     (no mintable key can carry config:read), yet every shop connector
--     and SDK reads GET /connector/config with the key alone at connect
--     time; POST /invoices and POST /mobile-money/collections -> 403
--     for the same reason. New-merchant onboarding for the documented
--     flows is broken until this lands.
--
-- FIX: widen the trigger's allowlist to exactly the 14 scopes the
-- function already issues. The security property is unchanged: none of
-- the 14 can withdraw, pay out, change a settlement destination,
-- change the business country, or manage keys — the trigger still
-- refuses everything else (including any future scope) with 42501.
-- Keys minted before this migration keep their scopes; the trigger
-- only fires when scopes are inserted or changed.
--
-- APPLY ORDER: run this migration BEFORE deploying the site change
-- that offers all 14 scopes in the API page's key-creation picker
-- (src/pages/API.tsx AVAILABLE_SCOPES), or that picker will offer
-- scopes the live trigger still refuses.

CREATE OR REPLACE FUNCTION public.enforce_api_key_scope_allowlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scopes IS NOT NULL AND NOT (NEW.scopes <@ ARRAY[
      'config:read',
      'wallets:read', 'transactions:read',
      'payment_links:read', 'payment_links:write',
      'transfers:write', 'bitcoin:read',
      'invoices:create', 'invoices:read',
      'webhooks:manage', 'webhooks:read', 'webhooks:write',
      'mobile_money:create', 'mobile_money:read'
    ]) THEN
      RAISE EXCEPTION 'scope_not_available: API keys can never withdraw, pay out, change settlement details or manage other keys.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.scopes IS DISTINCT FROM OLD.scopes THEN
    IF NEW.scopes IS NOT NULL AND NOT (NEW.scopes <@ ARRAY[
      'config:read',
      'wallets:read', 'transactions:read',
      'payment_links:read', 'payment_links:write',
      'transfers:write', 'bitcoin:read',
      'invoices:create', 'invoices:read',
      'webhooks:manage', 'webhooks:read', 'webhooks:write',
      'mobile_money:create', 'mobile_money:read'
    ]) THEN
      RAISE EXCEPTION 'scope_not_available: API keys can never withdraw, pay out, change settlement details or manage other keys.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
