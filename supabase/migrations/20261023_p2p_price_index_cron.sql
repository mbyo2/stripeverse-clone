-- Schedule the P2P BTC price-index writer: every minute, pg_cron
-- invokes the p2p edge function's refresh_price_index action via
-- pg_net, which inserts the next p2p_price_snapshots row (scope
-- §2.2 — a live index is what makes floating-price ads and order
-- creation possible; the Phase 1a RPCs refuse order creation while
-- the newest snapshot is stale or older than
-- platform_settings.p2p_price_stale_minutes).
--
-- This is the repo's established pg_cron -> edge-function bridge
-- (see 20261017_scheduled_payments_runner.sql): cron.schedule with
-- an idempotent unschedule-first step.
--
-- NOTE: the Authorization header below is intentionally a REDACTED
-- placeholder in the repo. The real service-role JWT is set when
-- this migration is applied (out-of-band, as with the
-- scheduled-payments runner). The p2p function authenticates this
-- caller by comparing the bearer token against
-- SUPABASE_SERVICE_ROLE_KEY (or an optional CRON_SECRET via the
-- x-cron-secret header, the process-scheduled-payments pattern).
--
-- No CREATE FUNCTION in this migration, so no REVOKE is needed;
-- pg_cron and pg_net are already enabled platform-wide.
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-price-index-writer') THEN
    PERFORM cron.unschedule('p2p-price-index-writer');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-price-index-writer',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/p2p',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer <service-role-jwt-redacted-set-at-apply-time>"}'::jsonb,
    body := '{"action": "refresh_price_index"}'::jsonb
  ) AS request_id;
  $$
);
