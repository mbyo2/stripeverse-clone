-- payment_link.paid developer webhook (CEO order 2026-10-26).
--
-- Paying a payment link previously dispatched NO developer webhook, so
-- shop connectors confirmed settlement by polling GET /payment-links.
-- The settlement path (payment-link-checkout → the
-- execute_payment_link_settlement RPC) now emits payment_link.paid via
-- the shared dispatcher in supabase/functions/_shared/developer-webhooks.ts.
--
-- Exactly-once anchor: a settlement always creates exactly one
-- owner-side ledger row (transactions.uuid_id), and an idempotent
-- replay of the same settlement returns that SAME id without moving
-- money again. This table claims the anchor before dispatching:
-- PRIMARY KEY(owner_transaction_id) means only the first claim across
-- retries / replays / duplicate checkout invocations inserts a row and
-- dispatches; every later claim conflicts and is a no-op.
--
-- Written and read ONLY by the service role (edge functions). RLS is
-- enabled with no client policies, matching developer_webhook_deliveries:
-- account owners see the outcome in the delivery log, never here.

CREATE TABLE IF NOT EXISTS public.payment_link_paid_dispatches (
  owner_transaction_id UUID PRIMARY KEY,
  link_id UUID NOT NULL REFERENCES public.payment_links(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pl_paid_dispatches_link
  ON public.payment_link_paid_dispatches(link_id);
ALTER TABLE public.payment_link_paid_dispatches ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (which bypasses RLS)
-- claims dispatches. Deliberately no client access to this table.
