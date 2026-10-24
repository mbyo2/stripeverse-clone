-- Payoneer payouts (Mass Payout API): the platform's Payoneer exit rail.
--
-- One row per payout intent on the Payoneer rail. The row is written
-- by the `payoneer-payouts` edge function (service role) BEFORE the
-- provider call, carrying the unique client_reference_id that is our
-- idempotency / reconciliation anchor: client_reference_id is always
-- the row's own uuid_id (the public identity, like transactions), it
-- is sent to Payoneer on every create, and a retry or webhook can
-- always find its way back to exactly one row.
--
-- DEBIT ORDERING (brief §2.1, stated honestly): funds leave the
-- platform's Payoneer float at payment creation, so the internal
-- wallet debit happens on API SUCCESS — the provider create runs
-- first and the wallet is debited only when Payoneer accepts. The
-- unavoidable seam: if Payoneer accepted but the wallet debit then
-- fails (e.g. insufficient balance discovered at debit time), the
-- row is marked 'failed' with the plain-language reason and the
-- provider payment id stays on the row so operations can cancel /
-- reconcile it at Payoneer — the create is never silently orphaned
-- and the wallet is never debited for a payout Payoneer refused.
--
-- REVERSAL: when Payoneer later reports a confirmed failure or
-- reversal for a payout whose wallet was debited, the wallet is
-- credited back exactly once. Exactly-once lives in debit_state:
-- the credit-back runs only on the guarded flip
-- debit_state 'debited' -> 'reversed' performed in the same update
-- as the status change (see _shared/payoneer-server.ts,
-- applyProviderStatus), so webhook + polling replays cannot
-- double-credit.
--
-- KILL SWITCH: platform_settings.payoneer_enabled, in the style of
-- stripe_gateway_enabled (20261106). Default FALSE — unlike the
-- Stripe rail this one stays dark until partner onboarding issues
-- real credentials (brief §2.0: Payoneer credentials are issued,
-- never self-created), and the edge function refuses with a crafted
-- `disabled` response while it is false. The `status` action is the
-- one exception: it answers before the switch so the admin console
-- can show the rail's truthful state.
--
-- RLS: administrators (admin / super_admin) may READ all rows for
-- the admin console. There are deliberately NO insert/update/delete
-- policies for client roles — writes happen only through the
-- service-role edge function after its in-function admin check.
-- The role test compares role::text so this migration does not
-- depend on the order in which the super_admin enum value lands.

-- ── Kill switch ──────────────────────────────────────────────────────
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS payoneer_enabled boolean NOT NULL DEFAULT false;

-- ── Ledger ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payoneer_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Public identity (like transactions.uuid_id): generated with the
  -- row and reused as client_reference_id below.
  uuid_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  -- The payee's Payoneer Payee ID (connected to our program through
  -- the partner registration link — brief §2.1).
  payee_id TEXT NOT NULL,
  -- Money (major units, in the payout currency)
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  description TEXT,
  -- Lifecycle: pending (row recorded, provider not yet answered) →
  -- submitted → completed / failed / reversed. 'failed' and
  -- 'reversed' are terminal; a wallet debit attached to either has
  -- been credited back (debit_state 'reversed').
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'completed', 'failed', 'reversed')),
  -- Idempotency / reconciliation anchor sent to Payoneer on create.
  -- Always equals this row's uuid_id (enforced by the edge function).
  client_reference_id TEXT UNIQUE NOT NULL,
  -- Provider linkage, recorded once Payoneer answers.
  provider_payout_id TEXT,
  provider_status TEXT,
  -- The wallet owner whose funds move; NULL for pure platform
  -- payouts (no internal wallet involved).
  user_id UUID,
  wallet_id UUID,
  -- Internal debit lifecycle: none (never debited) → debited →
  -- reversed (credited back exactly once).
  debit_state TEXT NOT NULL DEFAULT 'none'
    CHECK (debit_state IN ('none', 'debited', 'reversed')),
  -- Plain-language failure reason (never a raw provider body).
  error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payoneer_payouts_status
  ON public.payoneer_payouts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payoneer_payouts_created_by
  ON public.payoneer_payouts (created_by, created_at DESC);

ALTER TABLE public.payoneer_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view Payoneer payouts" ON public.payoneer_payouts;
CREATE POLICY "Admins can view Payoneer payouts"
  ON public.payoneer_payouts FOR SELECT
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
