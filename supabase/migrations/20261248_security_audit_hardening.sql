-- 20261248_security_audit_hardening.sql
-- Security audit 2026-10-30 (BMaGlass Pay / paymentgetway).
--
-- FINDING 1 (Critical, proven live): the pgsql-http extension functions in
-- schema `public` carried the default PUBLIC EXECUTE grant, so ANY holder of
-- the public anon key could call e.g. POST /rest/v1/rpc/http_get and make the
-- DATABASE SERVER fetch arbitrary URLs, receiving the full response body —
-- unauthenticated SSRF / anonymous HTTP proxying from the database host
-- (http_post allows POST with attacker-chosen bodies).
-- Nothing in the app, the edge functions, the cron jobs (they use
-- net.http_post, pg_net — a different extension) or any public function body
-- calls these functions; codebase + pg_proc.prosrc + cron.job scans all came
-- back empty.
-- Fix attempted first: REVOKE EXECUTE ... FROM PUBLIC/anon/authenticated —
-- a silent NO-OP, because every grant's grantor is supabase_admin and the
-- Management-API `postgres` role cannot revoke another grantor's grants
-- (warning only, has_function_privilege stayed true, live probe still
-- fetched). The extension itself is unused, so the binding fix is to drop
-- it. Verified after applying: extension gone, 0 http_* functions in public,
-- pg_net/pg_cron untouched (15 cron jobs intact), the live anon RPC probe
-- now returns PGRST202 "function not found", and normal anon REST reads
-- still work.
DROP EXTENSION IF EXISTS http;

-- FINDING 2 (Medium, defense-in-depth): 19 public tables have RLS enabled
-- with ZERO policies (deny-all for anon/authenticated — verified live: anon
-- reads return []), yet still carried the legacy default table grants for
-- anon and authenticated (SELECT/INSERT/UPDATE/DELETE/TRUNCATE...). They are
-- service-role-only tables (cron/edge-function state); no client code reads
-- them (verified by codebase scan) and no policy grants any path. Align the
-- grants with the Oct-30 GRANT rule: service_role only.
REVOKE ALL ON TABLE public.btc_consolidation_runs FROM anon, authenticated;
REVOKE ALL ON TABLE public.btc_link_attempt_addresses FROM anon, authenticated;
REVOKE ALL ON TABLE public.btc_treasury FROM anon, authenticated;
REVOKE ALL ON TABLE public.btc_withdrawal_batches FROM anon, authenticated;
REVOKE ALL ON TABLE public.card_access_audit FROM anon, authenticated;
REVOKE ALL ON TABLE public.developer_event_dispatches FROM anon, authenticated;
REVOKE ALL ON TABLE public.face_enrollments FROM anon, authenticated;
REVOKE ALL ON TABLE public.identity_audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.identity_liveness_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.identity_verification_embeddings FROM anon, authenticated;
REVOKE ALL ON TABLE public.p2p_escrow_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.p2p_identity_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.p2p_reserved_nicknames FROM anon, authenticated;
REVOKE ALL ON TABLE public.p2p_withdrawal_holds FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_link_btc_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.payment_link_paid_dispatches FROM anon, authenticated;
REVOKE ALL ON TABLE public.paypal_billing_plans FROM anon, authenticated;
REVOKE ALL ON TABLE public.pos_api_keys FROM anon, authenticated;
REVOKE ALL ON TABLE public.pos_match_failures FROM anon, authenticated;
