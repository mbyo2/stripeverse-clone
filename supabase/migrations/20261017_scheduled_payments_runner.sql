-- Scheduled payments runner support.
--
-- 1. Adds consecutive_failures to scheduled_payments so the runner can pause
--    schedules that fail repeatedly (e.g. persistent insufficient funds)
--    instead of retrying forever.
-- 2. Schedules the process-scheduled-payments edge function via pg_cron
--    every 5 minutes. The cron job posts to the function URL; the service-role
--    JWT is redacted here — set it when applying this migration out-of-band
--    (same pattern as daily-subscription-billing).

ALTER TABLE public.scheduled_payments
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;

-- Refresh the cron job (idempotent: unschedule first if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduled-payments-runner') THEN
    PERFORM cron.unschedule('scheduled-payments-runner');
  END IF;
END $$;

SELECT cron.schedule(
  'scheduled-payments-runner',
  '*/5 * * * *',
  $$
  SELECT
    net.http_post(
      url:='https://hhxwwozpvgktuqutfkhc.supabase.co/functions/v1/process-scheduled-payments',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer <redacted>"}'::jsonb,
      body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);
