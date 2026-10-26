-- MoonPay webhook dedupe / order guard (audit M-1, 2026-10-26).
--
-- MoonPay delivers webhooks at-least-once and UNORDERED. The
-- tracking layer already kept terminal statuses from regressing,
-- but an out-of-order event could still overwrite a row's tracking
-- fields (amounts, txids, failure reason) with older values. The
-- webhook now orders events by the transaction's own `updatedAt`
-- (sent on every event as data.updatedAt): each row records the
-- newest event timestamp it has applied in
-- `last_event_updated_at`, and an event stamped at or before it is
-- acknowledged but not applied (dedupe key: event type +
-- MoonPay transaction id + updatedAt). Events carrying no
-- updatedAt still apply, bounded by the terminal-sticky status
-- machine, exactly as before.
--
-- Nullable with no default: rows written before this migration (and
-- session rows no webhook has touched) read NULL = "nothing
-- applied yet", so their first event always applies.

ALTER TABLE public.moonpay_transactions
  ADD COLUMN IF NOT EXISTS last_event_updated_at TIMESTAMPTZ;
