-- 20261261_api_key_audit_triggers.sql
-- Audit-trail verification, 2026-11-11: API-key creation, revocation and rotation
-- state changes were not captured in audit_logs (the generic audit_trigger() covered
-- wallets, transactions and virtual_cards, but not the key tables). Purely additive:
-- attach the existing, proven audit_trigger() to both key tables so every
-- INSERT/UPDATE/DELETE lands in audit_logs with old/new values.
-- (Only key hashes/prefixes exist in these tables — raw keys are never stored.)
--
-- Proven live 2026-11-11: a QA key lifecycle (create -> deactivate -> delete on
-- api_keys; create -> delete on pos_api_keys) produced 5 audit_logs rows with
-- old/new values; the proof rows were removed with the QA teardown afterwards.

DROP TRIGGER IF EXISTS audit_api_keys_trigger ON public.api_keys;
CREATE TRIGGER audit_api_keys_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

DROP TRIGGER IF EXISTS audit_pos_api_keys_trigger ON public.pos_api_keys;
CREATE TRIGGER audit_pos_api_keys_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.pos_api_keys
FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();
