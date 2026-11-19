-- Tighten the fiat exchange-rate refresh cadence (FX upgrade
-- 2026-11-19): fetch-exchange-rates-refresh moves from every
-- 30 minutes to every 10 minutes. The job is ours (pg_cron, created
-- out-of-band with the service-role bridge in the same pattern as
-- 20261023_p2p_price_index_cron.sql); only its schedule changes.
-- The function's 1-hour valid_from/valid_until windows and both
-- providers (exchangerate-api primary, open.er-api fallback) are
-- unchanged — rows simply land three times as often, so the rate a
-- conversion re-reads server-side is never more than ~10 minutes
-- old in practice.
-- Idempotent: safe to re-run (alter_job on the named job).

SELECT cron.alter_job(jobid, schedule := '*/10 * * * *')
FROM cron.job
WHERE jobname = 'fetch-exchange-rates-refresh';
