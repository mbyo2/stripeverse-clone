-- Fix: signup failure "Database error saving new user" (SQLSTATE 42P10).
--
-- public.handle_new_user_subscription() inserts into public.subscribers with
-- ON CONFLICT (user_id) DO NOTHING, which requires a unique/exclusion
-- constraint on user_id. The table was created with UNIQUE(user_id) in
-- migration 20250701103927, but the live table lost that constraint
-- (schema drift), so every auth.users insert aborted.
--
-- Diagnosed 2026-10-20 from Auth/Postgres logs and an exact BEGIN..ROLLBACK
-- reproduction; applied live to project paymentgetway (hhxwwozpvgktuqutfkhc)
-- the same night and re-proven with the reproduction insert.
-- The subscribers table was empty at apply time, so this cannot fail on
-- duplicate rows.
ALTER TABLE public.subscribers
  ADD CONSTRAINT subscribers_user_id_key UNIQUE (user_id);
