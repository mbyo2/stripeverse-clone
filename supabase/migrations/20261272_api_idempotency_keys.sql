-- 20261272: idempotency keys on developer-API payment-link + invoice creation.
--
-- DECISION (CEO, 2026-11-15 16:35): SDKs must retry transient 502/503/504.
-- A retried payment-link/invoice creation must NEVER create a second
-- object: the developer-api creation paths had no idempotency at all
-- (transfers and mobile-money collections already dedupe; payment
-- links and invoices did not). The SDKs now send one Idempotency-Key
-- per logical create (auto-generated UUID when the caller supplies
-- none) and the server honours it.
--
-- MECHANISM: a nullable idempotency_key column on each table, guarded
-- by a partial unique index scoped to (user_id, environment, key) —
-- the same scoping as every other developer-API object (keys are
-- per-merchant, per-environment; a sandbox key can never replay a
-- production link). The handler looks the key up before inserting
-- (replay returns the original row, no second webhook event) and the
-- unique index is the backstop for a concurrent double-submit: the
-- losing insert trips 23505 and the handler re-reads and returns the
-- winning row instead of a second object.
--
-- No new table, no new grants: the columns ride the tables' existing
-- privileges (service-role edge function only; no client reads them).
-- APPLY ORDER: run this migration BEFORE deploying the developer-api
-- change that reads/writes the column, or creates will 42703.

alter table public.payment_links
  add column if not exists idempotency_key text;

create unique index if not exists payment_links_idempotency_uidx
  on public.payment_links (user_id, environment, idempotency_key)
  where idempotency_key is not null;

alter table public.developer_invoices
  add column if not exists idempotency_key text;

create unique index if not exists developer_invoices_idempotency_uidx
  on public.developer_invoices (user_id, environment, idempotency_key)
  where idempotency_key is not null;
