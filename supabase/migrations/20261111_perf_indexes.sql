-- =====================================================================
-- 20261111_perf_indexes.sql — scalability fix #3 (live-verified)
--
-- The scalability audit (2026-10-23) worked from the repo migration
-- set and flagged missing indexes on transactions / wallets /
-- exchange_rates — with its own caveat that the core tables predate
-- the repo migrations, so every claim had to be verified live.
-- Live pg_indexes (2026-10-23) showed most of the "missing" indexes
-- DO exist (idx_wallets_user_id, idx_transactions_user_id,
-- exchange_rates pair-valid_from unique). What is genuinely missing
-- or wasteful:
--
-- 1. transactions has separate (user_id) and (created_at) indexes
--    but no composite for the platform's hottest read — "a user's
--    transactions, newest first, paginated" (statements, history,
--    admin user 360°). The composite serves it in one index scan
--    with no sort.
-- 2. transactions carries TWO indexes on uuid_id alone:
--    idx_transactions_uuid_id (non-unique) is fully redundant next
--    to transactions_uuid_id_idx (unique). Dropping it removes
--    write overhead on every transaction insert.
--
-- Both changes are index-only: no data, no policy, no behaviour
-- change. Verified live before (diagnostic S1) and after (S1 re-run).
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON public.transactions (user_id, created_at DESC);

DROP INDEX IF EXISTS public.idx_transactions_uuid_id;
