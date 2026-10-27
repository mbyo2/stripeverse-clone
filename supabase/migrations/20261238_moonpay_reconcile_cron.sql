-- MoonPay reconciliation poller schedule (gap closure 2026-10-27, P1).
--
-- MoonPay webhooks are at-least-once with a bounded retry budget; a
-- terminal event that exhausts its retries would leave its
-- moonpay_transactions row non-terminal forever. The moonpay-reconcile
-- edge function is the backstop: it re-reads stale non-terminal rows
-- (untouched for 15 minutes) from MoonPay's API and applies the state
-- through the SAME application plan the webhook uses
-- (planMoonpayEventApplication in _shared/moonpay.ts) — never a
-- parallel settlement path, and tracking-only like the webhook: no
-- balance is ever touched; BTC crediting belongs to the
-- deposit-detection pipeline.
--
-- Shape mirrors the platform's existing schedulers (btc-check-deposits,
-- btc-consolidate-utxos in 20261223): pg_cron + net.http_post carrying
-- the Vault-held service-role key as the bearer. Every 15 minutes —
-- the same cadence as the staleness threshold, so a row whose terminal
-- webhook was lost is corrected within roughly one cycle of going
-- stale. The function quiet-skips (200) while the rail is
-- unconfigured, so this job is safe to run with the rail dark.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'moonpay-reconcile') THEN
    PERFORM cron.unschedule('moonpay-reconcile');
  END IF;
END $$;

SELECT cron.schedule(
  'moonpay-reconcile',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/moonpay-reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')),
    body := '{}'::jsonb);
  $$);
