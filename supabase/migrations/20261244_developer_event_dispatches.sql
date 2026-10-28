-- Exactly-once claims for developer-API event dispatches that are
-- emitted from request handlers (mirrors 20261215's
-- payment_link_paid_dispatches pattern, generalised by event key).
--
-- First user: POST /transfers in developer-api. The transfer RPC
-- (execute_transfer_with_fee) is idempotent — a replayed request
-- returns the original transaction and moves no money — but the
-- handler re-announced transaction.completed on every replay, so a
-- merchant received the event twice for one movement. The handler
-- now claims `transaction.completed:<transaction_id>` here before
-- dispatching; a 23505 conflict means the event already fired.
CREATE TABLE IF NOT EXISTS public.developer_event_dispatches (
  event_key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.developer_event_dispatches ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (which bypasses RLS)
-- claims dispatches. Deliberately no client access to this table.
REVOKE ALL ON public.developer_event_dispatches FROM anon, authenticated;
