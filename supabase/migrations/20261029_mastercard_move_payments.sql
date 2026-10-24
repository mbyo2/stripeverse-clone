-- Mastercard Move payments (Send + Cross-Border Services).
--
-- One row per payment intent on the Mastercard Move rails. The row is
-- written by the `mastercard-move` edge function (service role)
-- BEFORE the provider call, carrying the unique transaction_reference
-- that is our idempotency anchor: a retry reuses the persisted
-- reference, so a payment can never be submitted to Mastercard twice
-- under two different references.
--
-- RLS: administrators (admin / super_admin) may READ all rows for the
-- admin console. There are deliberately NO insert/update/delete
-- policies for client roles — writes happen only through the
-- service-role edge function after its in-function admin check.
-- The role test compares role::text so this migration does not depend
-- on the order in which the super_admin enum value lands.

CREATE TABLE IF NOT EXISTS public.mastercard_move_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Idempotency anchor: unique across the platform, generated (or
  -- derived from the caller's idempotency key) before the provider
  -- call and reused on every retry.
  transaction_reference TEXT NOT NULL UNIQUE,
  -- Which Move leg: 'send' (Mastercard Send disbursement) or
  -- 'xbs' (Cross-Border Services payment).
  rail TEXT NOT NULL CHECK (rail IN ('send', 'xbs')),
  -- 'payment' rows move money; 'quote' rows record a priced quote
  -- (proposal_id set) that a later payment may pay against.
  kind TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'quote')),
  direction TEXT NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  -- Corridor
  source_currency TEXT NOT NULL,
  destination_currency TEXT NOT NULL,
  destination_country TEXT NOT NULL,
  destination_type TEXT NOT NULL CHECK (destination_type IN ('bank', 'mobile_money', 'card', 'cash_pickup')),
  payment_type TEXT NOT NULL DEFAULT 'P2P',
  -- Money (major units, as quoted / submitted)
  amount NUMERIC(19, 2) NOT NULL CHECK (amount > 0),
  -- Recipient (account reference is stored redacted by the edge
  -- function: card PANs last-4 only)
  recipient_name TEXT,
  recipient_account TEXT,
  -- Provider linkage
  proposal_id TEXT,
  provider_payment_id TEXT,
  provider_reference TEXT,
  -- Lifecycle: created_locally → submitted → pending → completed /
  -- failed / provider_error / quoted
  status TEXT NOT NULL DEFAULT 'created_locally',
  -- Environment the row was created against. Sandbox stub responses
  -- are labelled here and must never be read as real settlements.
  env TEXT NOT NULL DEFAULT 'sandbox' CHECK (env IN ('sandbox', 'production')),
  -- Append-only raw provider status history (one object per provider
  -- response / status poll), for admin reconciliation.
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  provider_response JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mc_move_payments_created_by
  ON public.mastercard_move_payments (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_move_payments_status
  ON public.mastercard_move_payments (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mc_move_payments_provider_id
  ON public.mastercard_move_payments (provider_payment_id);

ALTER TABLE public.mastercard_move_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view Mastercard Move payments" ON public.mastercard_move_payments;
CREATE POLICY "Admins can view Mastercard Move payments"
  ON public.mastercard_move_payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role::text IN ('admin', 'super_admin')
    )
  );

-- No INSERT / UPDATE / DELETE policies: client roles cannot write
-- this table at all. The service role (edge function) bypasses RLS
-- and is the only writer.
