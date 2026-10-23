-- =====================================================================
-- 20261023_p2p_phase1a_core.sql — P2P Phase 1a: marketplace database
-- core (scope: p2p-marketplace-scope.md §5.2, §4.1–§4.2, §2–§3).
--
-- Phase 0 (20261023_p2p_phase0_identity.sql) shipped identity: KYC
-- tiers, the payment registry, sanctions, trader profiles,
-- p2p_effective_limits. This migration ships the MARKETPLACE CORE:
-- ads, orders, escrow holds, payment claims, trade chat, disputes,
-- blocks/reports, risk events, the immutable audit log, price
-- snapshots, the BTC escrow lock trio, the T+1 withdrawal hold, the
-- order-lifecycle RPCs, and the pg_cron timer/reconciliation jobs.
-- BTC ONLY: USDT ads/orders are refused with a designed
-- not-available error (CEO decision 2026-10-23; USDT mechanics in
-- the scope are retained as a design record, not scheduled work).
-- The `p2p` edge function (Phase 1b) and the UI (Phase 1c) are NOT
-- here; every RPC below is service_role-only, exactly like Phase 0.
-- p2p_enabled still ships false: the marketplace stays dark until
-- the Phase 1b/1c surface exists and the CEO turns it on.
--
-- REPO FINDINGS / ADAPTATIONS (verified against the repo 2026-10-23):
-- (1) PAYMENT METHOD TYPES — the scope §2.4 names a per-carrier
--     enum ('mtn_momo' | 'airtel_money' | 'bank'), but Phase 0
--     SHIPPED the registry with type IN ('mobile_money','bank').
--     Ads' payment_method_types therefore use the registry
--     vocabulary ('mobile_money' | 'bank'); the order snapshot
--     carries the actual account (number + name) from the registry,
--     which is what the buyer pays — the carrier split is display
--     metadata, not a safety property.
-- (2) SETTINGS — Phase 0 already added p2p_enabled,
--     p2p_fee_percent (0.5, CEO decision D1), p2p_seller_
--     response_hours (12), p2p_dispute_sla_hours (72),
--     p2p_new_account_cooldown_hours (24) and
--     p2p_withdrawal_hold_hours (24). The one §2.2 value with no
--     column is the price-staleness threshold; section 2 adds
--     p2p_price_stale_minutes (default 5 — snapshots are written
--     every minute by the index service, so 5 missed writes means
--     the index is not trustworthy).
-- (3) PLATFORM BTC IDENTITY — §2.5: the fee leg credits the
--     platform's crypto_wallets row. Platform identity is the
--     established rule from execute_payment_link_settlement:
--     earliest-created 'admin' in public.user_roles. If no admin
--     exists, or the admin IS a party to the trade, the fee is
--     skipped (mirrors the split-fee pattern — never invent a
--     recipient).
-- (4) BTC LOCK MECHANICS — crypto_wallets (user_id, asset) UNIQUE,
--     balance_sats / available_sats BIGINT. The lock trio wraps
--     public.btc_adjust_crypto_wallet, inheriting its row-lock +
--     non-negative discipline verbatim: lock moves available only,
--     unlock restores available, release debits the seller's
--     balance (available was already decremented at lock) and
--     credits buyer + platform. Withdrawals and trades read
--     available, so locked sats cannot be double-spent (§2.3
--     invariant 2).
-- (5) T+1 WITHDRAWAL HOLD (§3.8 research amendment) — a release
--     credits the buyer's balance AND available immediately
--     (internal transfers, trades and further P2P orders are
--     unaffected — the Binance carve-out), and writes a
--     p2p_withdrawal_holds row. On-chain withdrawal must subtract
--     unmatured holds: p2p_unmatured_withdrawal_hold_sats() is the
--     single function the withdrawal path consults, and
--     p2p_mature_withdrawal_holds() (pg_cron, 15 min) flips rows
--     to 'matured'. WIRING NOTE: btc_reserve_withdrawal itself is
--     intentionally NOT modified in this migration (it is
--     proven-live money code with its own M1 cap work); the
--     subtraction belongs in the btc-onchain edge path / a
--     dedicated follow-up migration, and is flagged in the build
--     report. Until that wiring lands, the hold is recorded and
--     queryable but not yet enforced at withdrawal time.
-- (6) BUY-ADS GATE — §3.3's advertiser graduation (T2 + 14 days +
--     >= 5 completed trades AS BUYER) is the SELL-side gate: it
--     governs receiving fiat. Phase 0's can_post_ads encodes it.
--     A buy_crypto ad's advertiser receives crypto and pays fiat;
--     posting one is gated on can_trade (plus holding a registered
--     payment method), not on the sell-side graduation — otherwise
--     no new trader could ever complete the 5 buys the sell gate
--     demands, and the book could never bootstrap.
-- (7) ADVERTISER BAND CALIBRATION (§3.3) — the scope says ad
--     limits "grow by completed-trade bands (5/15/30/75 trades) up
--     to the tier ceiling" with unique-counterparty minimums
--     (5/4, 15/10, 30/20, 75/40) but gives no per-band numbers.
--     Implementation calibration, enforced in p2p_create_ad: the
--     ad's max_order_zmw may not exceed 25% / 50% / 75% / 100% of
--     the advertiser's tier max_order (from p2p_effective_limits)
--     at bands 5/4, 15/10, 30/20, 75/40 respectively (floor band
--     25% for anyone who passes can_post_ads).
-- (8) REFUSALS THAT MUST LEAVE EVIDENCE RETURN, NEVER RAISE —
--     a RAISE rolls back the whole transaction, including the
--     risk-event row the refusal exists to create. So the two
--     refusals that are themselves fraud signals — rail-reference
--     reuse at mark-paid (§3.5) and typed-match failure at
--     confirm-release (§3.5) — write their risk event + audit row
--     and RETURN {success:false, code, message} jsonb, committing
--     with zero money movement. Every other validation failure
--     raises (nothing to record, nothing moved). All success
--     returns are {success:true, ...} jsonb. The Phase 1b edge
--     function maps both shapes to the same user-facing contract.
-- (9) IDEMPOTENCY — the order row carries the create key (UNIQUE).
--     Transition RPCs take a key and store their outcome jsonb in
--     the p2p_audit_log row they write (detail.idempotency_key +
--     detail.result); a replay finds that row and returns the
--     ORIGINAL outcome (§2.3 invariant 4 — the
--     btc_execute_trade / execute_atomic_transfer pattern, with
--     the audit log as the idempotency record). Order rows are
--     locked FOR UPDATE before any transition, so concurrent
--     replays serialise on the row, not on luck.
-- (10) NEGOTIATED DISPUTE CLOSURE (§3.6 research amendment) —
--     p2p_propose_dispute_closure (filer proposes an outcome) +
--     p2p_confirm_dispute_closure (the NON-filing party confirms;
--     only then does money move). The filer can never withdraw a
--     dispute unilaterally.
-- (11) payment_reversed AFTER COMPLETION (§5.4 case 14) — a
--     completed order is terminal; the crypto cannot move. A
--     payment_reversed dispute on a completed order is recorded
--     with affects_escrow = false and routes to the
--     sanctions/investigation flow: an admin ruling records the
--     outcome and may sanction, but moves no crypto.
--
-- GRANT DISCIPLINE — identical to Phase 0: every function is
-- pinned SET search_path = public, SECURITY DEFINER where it must
-- cross RLS, and gets the explicit triple revoke (PUBLIC + anon +
-- authenticated) because this project's default privileges grant
-- EXECUTE to anon/authenticated on fresh functions (proven live
-- 2026-10-23). Callable RPCs are granted to service_role only.
-- Internal helpers (lock trio, audit/risk/message writers) get the
-- triple revoke and NO grant: they run only inside SECURITY
-- DEFINER callers (owner context) — there is no client path to
-- them at all. pgcrypto is used ONLY as
-- extensions.digest(x::bytea, 'sha256') (Phase 0 lesson); text[]
-- appends use array_append, never || 'literal'.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2. platform_settings: the one missing P2P column (§2.2 staleness)
-- ---------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_price_stale_minutes integer NOT NULL DEFAULT 5;

-- ---------------------------------------------------------------------
-- 3. Tables (§4.1). All RLS-on. Writes are RPC-only unless the §4.1
-- posture says otherwise; policies below are reads + the one chat
-- insert path §2.6 defines.
-- ---------------------------------------------------------------------

-- 3.1 p2p_ads — the order book. A listing, not a lock (§2.1).
CREATE TABLE IF NOT EXISTS public.p2p_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('sell_crypto', 'buy_crypto')),
  asset text NOT NULL CHECK (asset IN ('BTC', 'USDT')),
  fiat_currency text NOT NULL DEFAULT 'ZMW' CHECK (fiat_currency = 'ZMW'),
  price_type text NOT NULL CHECK (price_type IN ('fixed', 'margin')),
  fixed_price_zmw numeric,
  margin_percent numeric,
  total_amount_minor bigint NOT NULL CHECK (total_amount_minor > 0),
  min_order_zmw numeric NOT NULL CHECK (min_order_zmw > 0),
  max_order_zmw numeric NOT NULL CHECK (max_order_zmw >= min_order_zmw),
  payment_method_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  payment_window_minutes integer NOT NULL DEFAULT 30
    CHECK (payment_window_minutes IN (15, 30, 45, 60, 120)),
  settle_delay_minutes integer NOT NULL DEFAULT 0
    CHECK (settle_delay_minutes >= 0),
  terms text,
  min_counterparty_tier text NOT NULL DEFAULT 'T1'
    CHECK (min_counterparty_tier IN ('T1', 'T2', 'T3')),
  min_counterparty_trades integer NOT NULL DEFAULT 0
    CHECK (min_counterparty_trades >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'exhausted', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_ads_owner_idx
  ON public.p2p_ads (owner_id, status);
CREATE INDEX IF NOT EXISTS p2p_ads_book_idx
  ON public.p2p_ads (asset, side, status);

ALTER TABLE public.p2p_ads ENABLE ROW LEVEL SECURITY;

-- Public read of ACTIVE ads (§4.1 safe projection: an ad carries no
-- payment numbers and no legal names — those live on orders, behind
-- participant RLS). Owners see their own in any status; admins all.
DROP POLICY IF EXISTS "Anyone can view active P2P ads" ON public.p2p_ads;
CREATE POLICY "Anyone can view active P2P ads"
  ON public.p2p_ads FOR SELECT
  USING (status = 'active'
         OR owner_id = auth.uid()
         OR public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_ads FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_ads TO anon, authenticated;
-- No INSERT/UPDATE/DELETE grants: posting and status changes are
-- gated inside p2p_create_ad / p2p_set_ad_status (§3.1 rule 5) — a
-- direct client write path would bypass the tier/age/band gates.

-- 3.2 p2p_orders — one row per trade. Transitions ONLY via RPCs.
CREATE TABLE IF NOT EXISTS public.p2p_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES public.p2p_ads (id),
  advertiser_id uuid NOT NULL,
  taker_id uuid NOT NULL,
  crypto_seller_id uuid NOT NULL,
  fiat_buyer_id uuid NOT NULL,
  asset text NOT NULL CHECK (asset IN ('BTC', 'USDT')),
  fiat_currency text NOT NULL DEFAULT 'ZMW' CHECK (fiat_currency = 'ZMW'),
  crypto_amount_minor bigint NOT NULL CHECK (crypto_amount_minor > 0),
  fiat_amount_zmw numeric NOT NULL CHECK (fiat_amount_zmw > 0),
  price_zmw numeric NOT NULL CHECK (price_zmw > 0),
  index_snapshot jsonb,
  fee_minor bigint NOT NULL DEFAULT 0,
  payment_method_snapshot jsonb,
  buyer_payment_method_id uuid REFERENCES public.p2p_payment_methods (id),
  rail_reference text,
  settle_delay_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'escrow_locked'
    CHECK (status IN ('escrow_locked', 'paid_marked', 'disputed',
                      'completed', 'refunded',
                      'cancelled_unpaid', 'expired_unpaid')),
  expires_at timestamptz NOT NULL,
  paid_marked_at timestamptz,
  seller_deadline_at timestamptz,
  appeal_flagged_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_orders_advertiser_idx
  ON public.p2p_orders (advertiser_id, created_at);
CREATE INDEX IF NOT EXISTS p2p_orders_taker_idx
  ON public.p2p_orders (taker_id, created_at);
CREATE INDEX IF NOT EXISTS p2p_orders_status_expiry_idx
  ON public.p2p_orders (status, expires_at);
CREATE INDEX IF NOT EXISTS p2p_orders_ad_idx
  ON public.p2p_orders (ad_id, status);

ALTER TABLE public.p2p_orders ENABLE ROW LEVEL SECURITY;

-- Participant reads own; admins read all (§4.1). NO client writes.
DROP POLICY IF EXISTS "Order participants can view their P2P orders" ON public.p2p_orders;
CREATE POLICY "Order participants can view their P2P orders"
  ON public.p2p_orders FOR SELECT TO authenticated
  USING (advertiser_id = auth.uid() OR taker_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all P2P orders" ON public.p2p_orders;
CREATE POLICY "Admins can view all P2P orders"
  ON public.p2p_orders FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_orders FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_orders TO authenticated;

-- 3.3 p2p_escrow_holds — the escrow ledger (§4.1). NO client
-- policies at all: service_role bypasses RLS, nobody else reads or
-- writes a hold. The 'frozen' state of §4.1 is represented as
-- status='locked' + the order in DISPUTED (the scope's own note);
-- the settlement column records how a settled hold ended.
CREATE TABLE IF NOT EXISTS public.p2p_escrow_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.p2p_orders (id),
  seller_id uuid NOT NULL,
  buyer_id uuid NOT NULL,
  asset text NOT NULL CHECK (asset IN ('BTC', 'USDT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  fee_minor bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked', 'released', 'unlocked')),
  settlement text
    CHECK (settlement IN ('confirm', 'dispute_release', 'expire',
                          'cancel', 'dispute_refund')),
  locked_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS p2p_escrow_holds_status_idx
  ON public.p2p_escrow_holds (status, asset);

ALTER TABLE public.p2p_escrow_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.p2p_escrow_holds FROM PUBLIC, anon, authenticated;

-- 3.4 p2p_withdrawal_holds — the T+1 rule (§3.8 amendment; header
-- finding 5). Service-role only, like the escrow ledger.
CREATE TABLE IF NOT EXISTS public.p2p_withdrawal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  order_id uuid REFERENCES public.p2p_orders (id),
  asset text NOT NULL CHECK (asset IN ('BTC', 'USDT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL DEFAULT 'held'
    CHECK (status IN ('held', 'matured', 'cancelled')),
  matures_at timestamptz NOT NULL,
  matured_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_withdrawal_holds_user_idx
  ON public.p2p_withdrawal_holds (user_id, status);
CREATE INDEX IF NOT EXISTS p2p_withdrawal_holds_matures_idx
  ON public.p2p_withdrawal_holds (status, matures_at);

ALTER TABLE public.p2p_withdrawal_holds ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.p2p_withdrawal_holds FROM PUBLIC, anon, authenticated;

-- 3.5 p2p_payment_claims — what the buyer asserts at mark-paid
-- (§3.5). A claim is a CLAIM, never proof. The rail reference is
-- single-use platform-wide (§3.5 research amendment): the UNIQUE
-- index on the normalised reference is the hard backstop; the RPC
-- pre-checks so a reuse attempt leaves a risk event (finding 8).
CREATE TABLE IF NOT EXISTS public.p2p_payment_claims (
  order_id uuid PRIMARY KEY REFERENCES public.p2p_orders (id),
  payment_method_id uuid NOT NULL REFERENCES public.p2p_payment_methods (id),
  rail_reference text NOT NULL,
  rail_reference_norm text NOT NULL,
  amount_sent_zmw numeric NOT NULL,
  payer_name_attested text,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  proof_file_hash text,
  proof_storage_path text
);

CREATE UNIQUE INDEX IF NOT EXISTS p2p_payment_claims_reference_unique
  ON public.p2p_payment_claims (rail_reference_norm);

ALTER TABLE public.p2p_payment_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order participants can view their payment claim" ON public.p2p_payment_claims;
CREATE POLICY "Order participants can view their payment claim"
  ON public.p2p_payment_claims FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id = order_id
       AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())));

DROP POLICY IF EXISTS "Admins can view all payment claims" ON public.p2p_payment_claims;
CREATE POLICY "Admins can view all payment claims"
  ON public.p2p_payment_claims FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_payment_claims FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_payment_claims TO authenticated;

-- 3.6 p2p_order_messages — trade chat (§2.6). Evidence-grade:
-- participants read; participants INSERT user messages only
-- (sender_type forced 'user' by the WITH CHECK); system/support
-- rows are written by RPCs / the admin path; NO update/delete for
-- anyone, and a trigger (§5) blocks mutation even by accident.
CREATE TABLE IF NOT EXISTS public.p2p_order_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.p2p_orders (id),
  sender_id uuid,
  sender_type text NOT NULL CHECK (sender_type IN ('user', 'system', 'support')),
  body text NOT NULL,
  attachment_path text,
  scan_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_order_messages_order_idx
  ON public.p2p_order_messages (order_id, created_at);

ALTER TABLE public.p2p_order_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order participants can view trade messages" ON public.p2p_order_messages;
CREATE POLICY "Order participants can view trade messages"
  ON public.p2p_order_messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id = order_id
       AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())));

DROP POLICY IF EXISTS "Admins can view all trade messages" ON public.p2p_order_messages;
CREATE POLICY "Admins can view all trade messages"
  ON public.p2p_order_messages FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Order participants can send trade messages" ON public.p2p_order_messages;
CREATE POLICY "Order participants can send trade messages"
  ON public.p2p_order_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid()
              AND sender_type = 'user'
              AND EXISTS (
                SELECT 1 FROM public.p2p_orders o
                 WHERE o.id = order_id
                   AND (o.advertiser_id = auth.uid()
                        OR o.taker_id = auth.uid())));

REVOKE ALL ON TABLE public.p2p_order_messages FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.p2p_order_messages TO authenticated;

-- 3.7 p2p_disputes — two-party, order-anchored (§3.6). status
-- encodes the outcome for ruled/negotiated closures; closed_via
-- records which path closed it. affects_escrow = false marks the
-- post-completion payment_reversed track (finding 11).
CREATE TABLE IF NOT EXISTS public.p2p_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.p2p_orders (id),
  opened_by uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN (
    'paid_not_received', 'amount_mismatch', 'third_party_payment',
    'seller_unresponsive', 'buyer_unresponsive_after_paid',
    'seller_unresponsive_pre_payment', 'payment_reversed', 'other')),
  detail text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'ruled_release', 'ruled_refund',
                      'negotiated_release', 'negotiated_refund')),
  affects_escrow boolean NOT NULL DEFAULT true,
  negotiation_ends_at timestamptz,
  proposed_outcome text
    CHECK (proposed_outcome IN ('release_to_buyer', 'refund_to_seller')),
  proposed_by uuid,
  proposed_at timestamptz,
  closed_via text CHECK (closed_via IN ('admin', 'negotiated')),
  ruled_by uuid,
  ruled_at timestamptz,
  ruling_notes text,
  sla_due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_disputes_open_idx
  ON public.p2p_disputes (status, sla_due_at);

ALTER TABLE public.p2p_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Order participants can view their disputes" ON public.p2p_disputes;
CREATE POLICY "Order participants can view their disputes"
  ON public.p2p_disputes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.p2p_orders o
     WHERE o.id = order_id
       AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())));

DROP POLICY IF EXISTS "Admins can view all P2P disputes" ON public.p2p_disputes;
CREATE POLICY "Admins can view all P2P disputes"
  ON public.p2p_disputes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_disputes FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_disputes TO authenticated;

-- 3.8 p2p_dispute_evidence — insert-only via RPC (§3.6): a party
-- can add, never edit or delete. Reads: the dispute's parties.
CREATE TABLE IF NOT EXISTS public.p2p_dispute_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid NOT NULL REFERENCES public.p2p_disputes (id),
  submitter_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('statement', 'file')),
  body text,
  storage_path text,
  file_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_dispute_evidence_dispute_idx
  ON public.p2p_dispute_evidence (dispute_id, created_at);

ALTER TABLE public.p2p_dispute_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Dispute parties can view evidence" ON public.p2p_dispute_evidence;
CREATE POLICY "Dispute parties can view evidence"
  ON public.p2p_dispute_evidence FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
      FROM public.p2p_disputes d
      JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.id = dispute_id
       AND (o.advertiser_id = auth.uid() OR o.taker_id = auth.uid())));

DROP POLICY IF EXISTS "Admins can view all dispute evidence" ON public.p2p_dispute_evidence;
CREATE POLICY "Admins can view all dispute evidence"
  ON public.p2p_dispute_evidence FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_dispute_evidence FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_dispute_evidence TO authenticated;

-- 3.9 p2p_blocks — blocking hides ads and prevents orders both
-- directions (checked inside p2p_create_order, §3.4).
CREATE TABLE IF NOT EXISTS public.p2p_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL,
  blocked_id uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

ALTER TABLE public.p2p_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own P2P blocks" ON public.p2p_blocks;
CREATE POLICY "Users can view their own P2P blocks"
  ON public.p2p_blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all P2P blocks" ON public.p2p_blocks;
CREATE POLICY "Admins can view all P2P blocks"
  ON public.p2p_blocks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_blocks FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_blocks TO authenticated;

-- 3.10 p2p_reports — an allegation, not a sanction (§3.4).
-- Insert-only for users (via RPC so order linkage is validated);
-- admins read the queue.
CREATE TABLE IF NOT EXISTS public.p2p_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL,
  subject_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN (
    'scam_attempt', 'off_platform_solicitation', 'fake_proof',
    'abusive_behaviour', 'other')),
  order_id uuid REFERENCES public.p2p_orders (id),
  detail text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_reports_subject_idx
  ON public.p2p_reports (subject_id, status);

ALTER TABLE public.p2p_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own P2P reports" ON public.p2p_reports;
CREATE POLICY "Users can view their own P2P reports"
  ON public.p2p_reports FOR SELECT TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all P2P reports" ON public.p2p_reports;
CREATE POLICY "Admins can view all P2P reports"
  ON public.p2p_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_reports TO authenticated;

-- 3.11 p2p_risk_events — the detection ledger (§3.8). Service-role
-- insert (inside RPCs); admin read. Users never see raw signals
-- (consequences are visible via sanctions; signals stay internal).
CREATE TABLE IF NOT EXISTS public.p2p_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  counterparty_id uuid,
  order_id uuid REFERENCES public.p2p_orders (id),
  signal text NOT NULL,
  weight integer NOT NULL DEFAULT 1,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_risk_events_user_idx
  ON public.p2p_risk_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS p2p_risk_events_signal_idx
  ON public.p2p_risk_events (signal, created_at);

ALTER TABLE public.p2p_risk_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view P2P risk events" ON public.p2p_risk_events;
CREATE POLICY "Admins can view P2P risk events"
  ON public.p2p_risk_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_risk_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_risk_events TO authenticated;

-- 3.12 p2p_audit_log — append-only (§3.10). Written INSIDE the
-- money RPCs, in the same transaction as the movement. No
-- UPDATE/DELETE policies for any role; a trigger (§5) blocks
-- mutation outright. order_id is nullable: ad/sanction/cron
-- events have no order. Rail references appear here MASKED only
-- (detail discipline in the RPCs); full values live on the order.
CREATE TABLE IF NOT EXISTS public.p2p_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES public.p2p_orders (id),
  actor_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'cron')),
  event text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_audit_log_order_idx
  ON public.p2p_audit_log (order_id, created_at);
CREATE INDEX IF NOT EXISTS p2p_audit_log_event_idx
  ON public.p2p_audit_log (event, created_at);

ALTER TABLE public.p2p_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view the P2P audit log" ON public.p2p_audit_log;
CREATE POLICY "Admins can view the P2P audit log"
  ON public.p2p_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_audit_log FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_audit_log TO authenticated;

-- 3.13 p2p_price_snapshots — the index cache (§2.2). Written by
-- the index service (Phase 1b cron/edge) from Coinbase/Kraken
-- cross-checked BTC/USD × exchange_rates USD/ZMW; a snapshot whose
-- sources diverge > 3% is written with is_stale = true. Order
-- creation refuses on a stale or aged-out snapshot (§2.2, §5.4
-- case 12) — never trade on a price we cannot verify.
CREATE TABLE IF NOT EXISTS public.p2p_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset text NOT NULL CHECK (asset IN ('BTC', 'USDT')),
  index_zmw numeric NOT NULL CHECK (index_zmw > 0),
  sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_stale boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS p2p_price_snapshots_latest_idx
  ON public.p2p_price_snapshots (asset, created_at DESC);

ALTER TABLE public.p2p_price_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view price snapshots" ON public.p2p_price_snapshots;
CREATE POLICY "Authenticated users can view price snapshots"
  ON public.p2p_price_snapshots FOR SELECT TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.p2p_price_snapshots FROM anon, authenticated;
GRANT SELECT ON TABLE public.p2p_price_snapshots TO authenticated;

-- 3.14 fraud_rules wiring (§3.8, §1.4): seed the two default P2P
-- rules so the existing admin Fraud Rules page is truthful for P2P
-- on day one. p2p_eval_fraud_rules (§5) reads rule_type LIKE
-- 'p2p_%', fires on the condition keys it understands, increments
-- hits_count / last_triggered_at, and writes a p2p_risk_events
-- row. Seeded idempotently by name.
INSERT INTO public.fraud_rules (name, description, rule_type, conditions, action, severity)
SELECT 'P2P high-value order review',
       'Flags P2P orders at or above the configured ZMW value for risk review.',
       'p2p_order_amount', '{"order_amount_zmw_gte": 20000}'::jsonb, 'flag', 'high'
 WHERE NOT EXISTS (SELECT 1 FROM public.fraud_rules
                    WHERE name = 'P2P high-value order review');

INSERT INTO public.fraud_rules (name, description, rule_type, conditions, action, severity)
SELECT 'P2P rapid order creation',
       'Flags accounts creating orders rapidly (possible griefing / farming).',
       'p2p_velocity', '{"rapid_orders_10min_gte": 6}'::jsonb, 'flag', 'medium'
 WHERE NOT EXISTS (SELECT 1 FROM public.fraud_rules
                    WHERE name = 'P2P rapid order creation');

-- ---------------------------------------------------------------------
-- 4. p2p_effective_limits — Phase 1 replacement. IDENTICAL
-- signature and IDENTICAL jsonb shape to Phase 0 (the Phase 0
-- proofs pin both); the ONLY change is the one Phase 0's own
-- comment pre-announced: the to_regclass('public.p2p_orders')
-- guard is gone and today's usage is computed from the real
-- table, with the same filters, the same day boundary and the
-- same (taker OR advertiser) attribution the guarded branch used.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p2p_effective_limits(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier text;
  v_enabled boolean := false;
  v_cooldown_hours integer := 24;
  v_account_created_at timestamptz;
  v_verified_at timestamptz;
  v_trades_completed integer := 0;
  v_trades_as_buyer integer := 0;
  v_daily_cap numeric := 0;
  v_max_order numeric := 0;
  v_orders_day_cap integer := 20;  -- §3.3 velocity hard cap: 20 orders/day
  v_max_open_orders integer := 5;  -- §3.3 velocity hard cap: 5 open orders
  v_daily_used numeric := 0;
  v_open_orders integer := 0;
  v_orders_today integer := 0;
  v_can_trade boolean := true;
  v_can_post_ads boolean := false;
  v_trade_hold boolean := false;
  v_hold_reason text;
  v_reasons text[] := ARRAY[]::text[];
  v_sanction_level integer;
BEGIN
  v_tier := public.p2p_kyc_tier(p_user_id);

  -- Settings (wide single-row table; established read pattern — a
  -- missing row falls back to paused + 24h cooldown).
  SELECT COALESCE(s.p2p_enabled, false),
         COALESCE(s.p2p_new_account_cooldown_hours, 24)
    INTO v_enabled, v_cooldown_hours
    FROM public.platform_settings s
   WHERE s.id;
  IF NOT FOUND THEN
    v_enabled := false;
    v_cooldown_hours := 24;
  END IF;

  SELECT u.created_at
    INTO v_account_created_at
    FROM auth.users u
   WHERE u.id = p_user_id;

  SELECT k.verified_at
    INTO v_verified_at
    FROM public.kyc_verifications k
   WHERE k.user_id = p_user_id;

  SELECT t.trades_completed, t.trades_as_buyer
    INTO v_trades_completed, v_trades_as_buyer
    FROM public.p2p_trader_profiles t
   WHERE t.user_id = p_user_id;
  IF NOT FOUND THEN
    v_trades_completed := 0;
    v_trades_as_buyer := 0;
  END IF;

  -- Tier rights (§3.2 launch defaults; constants by design — the
  -- settings-tunable values are the ones with settings columns).
  IF v_tier = 'T1' THEN
    v_daily_cap := 2000;
    v_max_order := 1000;
  ELSIF v_tier = 'T2' THEN
    v_daily_cap := 50000;
    v_max_order := 10000;
  ELSIF v_tier = 'T3' THEN
    v_daily_cap := 250000;
    v_max_order := 100000;
  ELSE
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'kyc_required');
  END IF;

  -- Master switch (§4.1): ops can pause the whole marketplace
  -- without a deploy; while paused, nobody trades.
  IF NOT v_enabled THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'marketplace_paused');
  END IF;

  -- Account-age cooldown (§3.3): no P2P at all before it (default
  -- 24h, from platform_settings.p2p_new_account_cooldown_hours).
  IF v_account_created_at IS NULL
     OR now() - v_account_created_at < make_interval(hours => v_cooldown_hours) THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'account_too_new');
  END IF;

  -- First 7 days after T1 (§3.3): daily cap K500, max 3
  -- orders/day. (The matching "no sell-side ads" rule is enforced
  -- in the advertiser gate below.)
  IF v_verified_at IS NOT NULL
     AND now() < v_verified_at + interval '7 days' THEN
    v_daily_cap := LEAST(v_daily_cap, 500);
    v_orders_day_cap := LEAST(v_orders_day_cap, 3);
    v_reasons := array_append(v_reasons, 'new_trader_limits');
  END IF;

  -- First 5 completed trades (§3.3): max order K500.
  IF v_trades_completed < 5 THEN
    v_max_order := LEAST(v_max_order, 500);
  END IF;

  -- Today's usage / open orders / orders today, from the real
  -- p2p_orders (Phase 1: the guard Phase 0 shipped is removed;
  -- filters and attribution unchanged from the guarded branch).
  SELECT COALESCE(SUM(o.fiat_amount_zmw)
             FILTER (WHERE o.status IN ('escrow_locked', 'paid_marked', 'completed')), 0),
         COALESCE(COUNT(*) FILTER (WHERE o.status IN ('escrow_locked', 'paid_marked')), 0),
         COALESCE(COUNT(*), 0)
    INTO v_daily_used, v_open_orders, v_orders_today
    FROM public.p2p_orders o
   WHERE (o.taker_id = p_user_id OR o.advertiser_id = p_user_id)
     AND o.created_at >= date_trunc('day', now());

  IF v_orders_today >= v_orders_day_cap THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'daily_order_cap_reached');
  END IF;

  -- Sanctions (§3.9): the highest ACTIVE, in-window rung in p2p or
  -- platform scope governs. Expired / revoked / not-yet-started
  -- rows are ignored. Rung 1+ pauses trading; rung 2+ also kills
  -- ads (advertiser gate below).
  SELECT MAX(s.level)
    INTO v_sanction_level
    FROM public.user_sanctions s
   WHERE s.user_id = p_user_id
     AND s.status = 'active'
     AND s.scope IN ('p2p', 'platform')
     AND s.starts_at <= now()
     AND (s.expires_at IS NULL OR s.expires_at > now());

  IF COALESCE(v_sanction_level, 0) >= 1 THEN
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'sanctioned_rung_' || v_sanction_level::text);
  END IF;

  -- Identity-review hold (§3.2 / §4.1): a pending review whose 72h
  -- hold is still running freezes trading until a human clears it.
  IF EXISTS (
    SELECT 1
      FROM public.p2p_reviews r
     WHERE r.user_id = p_user_id
       AND r.status = 'pending'
       AND r.hold_until IS NOT NULL
       AND r.hold_until > now()
  ) THEN
    v_trade_hold := true;
    v_hold_reason := 'identity_review_hold';
    v_can_trade := false;
    v_reasons := array_append(v_reasons, 'identity_review_hold');
  END IF;

  -- Advertiser gate (§3.3): T2+ AND account age >= 14 days AND
  -- >= 5 completed trades AS BUYER, outside the first-7-days
  -- window, with trading itself allowed and no rung >= 2 sanction.
  -- (The completed-trade / unique-counterparty bands that grow AD
  -- limits above this floor are enforced in p2p_create_ad, where
  -- the ad's own caps are set — header finding 7.)
  v_can_post_ads :=
       v_enabled
       AND v_tier IN ('T2', 'T3')
       AND v_can_trade
       AND v_account_created_at IS NOT NULL
       AND now() - v_account_created_at >= interval '14 days'
       AND v_trades_as_buyer >= 5
       AND NOT (v_verified_at IS NOT NULL
                AND now() < v_verified_at + interval '7 days')
       AND COALESCE(v_sanction_level, 0) < 2;

  RETURN jsonb_build_object(
    'tier', v_tier,
    'can_trade', v_can_trade,
    'can_post_ads', v_can_post_ads,
    'max_order_zmw', v_max_order,
    'daily_cap_zmw', v_daily_cap,
    'daily_used_zmw', v_daily_used,
    'daily_remaining_zmw', GREATEST(v_daily_cap - v_daily_used, 0),
    'max_open_orders', v_max_open_orders,
    'open_orders', v_open_orders,
    'orders_today', v_orders_today,
    'orders_day_cap', v_orders_day_cap,
    'trade_hold', v_trade_hold,
    'hold_reason', v_hold_reason,
    'reasons', to_jsonb(v_reasons)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_effective_limits(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_effective_limits(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_effective_limits(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_effective_limits(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 5. Internal helpers. Triple revoke, NO grants (header note):
-- these run only inside SECURITY DEFINER callers in owner
-- context. There is deliberately no path to them from PostgREST.
-- ---------------------------------------------------------------------

-- Tier ordering for ad counterparty requirements.
CREATE OR REPLACE FUNCTION public.p2p_tier_rank(p_tier text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_tier
           WHEN 'T1' THEN 1
           WHEN 'T2' THEN 2
           WHEN 'T3' THEN 3
           ELSE 0
         END;
$$;

REVOKE ALL ON FUNCTION public.p2p_tier_rank(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_tier_rank(text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_tier_rank(text) FROM authenticated;

-- Rail references are logged MASKED (§3.10): last 4 only.
CREATE OR REPLACE FUNCTION public.p2p_mask_ref(p_ref text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
           WHEN p_ref IS NULL THEN NULL
           WHEN length(p_ref) <= 4 THEN '••••'
           ELSE '•••' || right(p_ref, 4)
         END;
$$;

REVOKE ALL ON FUNCTION public.p2p_mask_ref(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_mask_ref(text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_mask_ref(text) FROM authenticated;

-- The audit writer (§3.10): every money RPC calls this in the
-- same transaction as the movement it records.
CREATE OR REPLACE FUNCTION public.p2p_write_audit(
  p_order_id uuid,
  p_actor_id uuid,
  p_actor_type text,
  p_event text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.p2p_audit_log (order_id, actor_id, actor_type, event, detail)
  VALUES (p_order_id, p_actor_id, p_actor_type, p_event, COALESCE(p_detail, '{}'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.p2p_write_audit(uuid, uuid, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_write_audit(uuid, uuid, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_write_audit(uuid, uuid, text, text, jsonb) FROM authenticated;

-- The risk writer (§3.8).
CREATE OR REPLACE FUNCTION public.p2p_write_risk(
  p_user_id uuid,
  p_counterparty_id uuid,
  p_order_id uuid,
  p_signal text,
  p_weight integer DEFAULT 1,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.p2p_risk_events (user_id, counterparty_id, order_id, signal, weight, detail)
  VALUES (p_user_id, p_counterparty_id, p_order_id, p_signal,
          COALESCE(p_weight, 1), COALESCE(p_detail, '{}'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.p2p_write_risk(uuid, uuid, uuid, text, integer, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_write_risk(uuid, uuid, uuid, text, integer, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_write_risk(uuid, uuid, uuid, text, integer, jsonb) FROM authenticated;

-- System chat rows (§2.6): written by the order RPCs so the real
-- notices are unforgeable — users can only insert sender_type
-- 'user' (RLS), and nobody can insert 'system' from a client.
CREATE OR REPLACE FUNCTION public.p2p_system_message(
  p_order_id uuid,
  p_body text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.p2p_order_messages (order_id, sender_id, sender_type, body)
  VALUES (p_order_id, NULL, 'system', p_body);
$$;

REVOKE ALL ON FUNCTION public.p2p_system_message(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_system_message(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_system_message(uuid, text) FROM authenticated;

-- Trader-profile upsert: profiles are created lazily by the
-- settlement RPCs; users can never write them (§3.4). The
-- reserved-nickname trigger (Phase 0) passes: nickname is NULL.
CREATE OR REPLACE FUNCTION public.p2p_ensure_profile(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.p2p_trader_profiles (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;
$$;

REVOKE ALL ON FUNCTION public.p2p_ensure_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_ensure_profile(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_ensure_profile(uuid) FROM authenticated;

-- Idempotency replay (header finding 9): the stored outcome of a
-- transition that already ran under this key, or NULL.
CREATE OR REPLACE FUNCTION public.p2p_idem_replay(
  p_order_id uuid,
  p_event text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.detail -> 'result'
    FROM public.p2p_audit_log a
   WHERE a.order_id = p_order_id
     AND a.event = p_event
     AND p_idempotency_key IS NOT NULL
     AND a.detail ->> 'idempotency_key' = p_idempotency_key
   ORDER BY a.created_at DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.p2p_idem_replay(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_idem_replay(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_idem_replay(uuid, text, text) FROM authenticated;

-- Distinct completed counterparties (graduation bands, §3.3 /
-- §3.4 diversity rule).
CREATE OR REPLACE FUNCTION public.p2p_distinct_counterparties(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(DISTINCT
           CASE WHEN o.taker_id = p_user_id THEN o.advertiser_id
                ELSE o.taker_id END), 0)::integer
    FROM public.p2p_orders o
   WHERE (o.taker_id = p_user_id OR o.advertiser_id = p_user_id)
     AND o.status = 'completed';
$$;

REVOKE ALL ON FUNCTION public.p2p_distinct_counterparties(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_distinct_counterparties(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_distinct_counterparties(uuid) FROM authenticated;

-- Rolling 30-day risk score (§3.8): create_order refuses at/above
-- the threshold and queues the account for human review — never a
-- silent shadow-ban.
CREATE OR REPLACE FUNCTION public.p2p_risk_score(p_user_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(r.weight), 0)::integer
    FROM public.p2p_risk_events r
   WHERE r.user_id = p_user_id
     AND r.created_at >= now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.p2p_risk_score(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_risk_score(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_risk_score(uuid) FROM authenticated;

-- fraud_rules wiring (§3.8): evaluate active 'p2p_%' rules for a
-- fresh order. Supported condition keys (conditions JSONB):
--   order_amount_zmw_gte   — fires when the order's fiat >= value
--   rapid_orders_10min_gte — fires when the user's orders in the
--                            last 10 minutes reach the value
-- A fired rule increments hits_count / last_triggered_at and
-- writes a p2p_risk_events row. Severity maps to weight:
-- low 5, medium 10, high 25, critical 50.
CREATE OR REPLACE FUNCTION public.p2p_eval_fraud_rules(
  p_user_id uuid,
  p_counterparty_id uuid,
  p_order_id uuid,
  p_fiat_amount_zmw numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule record;
  v_fire boolean;
  v_weight integer;
  v_recent_orders integer;
BEGIN
  FOR v_rule IN
    SELECT r.id, r.name, r.rule_type, r.conditions, r.severity
      FROM public.fraud_rules r
     WHERE r.is_active
       AND r.rule_type LIKE 'p2p\_%'
  LOOP
    v_fire := false;

    IF v_rule.conditions ? 'order_amount_zmw_gte'
       AND p_fiat_amount_zmw IS NOT NULL
       AND p_fiat_amount_zmw >= (v_rule.conditions ->> 'order_amount_zmw_gte')::numeric THEN
      v_fire := true;
    END IF;

    IF NOT v_fire AND v_rule.conditions ? 'rapid_orders_10min_gte' THEN
      SELECT COUNT(*) INTO v_recent_orders
        FROM public.p2p_orders o
       WHERE (o.taker_id = p_user_id OR o.advertiser_id = p_user_id)
         AND o.created_at >= now() - interval '10 minutes';
      IF v_recent_orders >= (v_rule.conditions ->> 'rapid_orders_10min_gte')::integer THEN
        v_fire := true;
      END IF;
    END IF;

    IF v_fire THEN
      v_weight := CASE v_rule.severity
                    WHEN 'low' THEN 5
                    WHEN 'high' THEN 25
                    WHEN 'critical' THEN 50
                    ELSE 10
                  END;
      UPDATE public.fraud_rules
         SET hits_count = hits_count + 1,
             last_triggered_at = now()
       WHERE id = v_rule.id;
      PERFORM public.p2p_write_risk(
        p_user_id, p_counterparty_id, p_order_id, 'fraud_rule', v_weight,
        jsonb_build_object('rule', v_rule.name, 'rule_type', v_rule.rule_type));
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_eval_fraud_rules(uuid, uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_eval_fraud_rules(uuid, uuid, uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_eval_fraud_rules(uuid, uuid, uuid, numeric) FROM authenticated;

-- ---------------------------------------------------------------------
-- 5b. The BTC escrow lock trio (§4.2). Internal helpers built on
-- btc_adjust_crypto_wallet (header finding 4): lock/unlock move
-- AVAILABLE only; release moves BALANCE. Each asserts the hold's
-- current state — the closed release set (§2.3 invariant 3) is
-- enforced by the CALLERS' actor/status checks plus these state
-- assertions under the hold's row lock.
-- ---------------------------------------------------------------------

-- Lock: seller available -= amount; hold row created 'locked'.
-- Raises (via btc_adjust_crypto_wallet) when available < amount —
-- the caller (p2p_create_order) lets it abort the whole order:
-- a failed lock = a failed order = no payment details (§2.3
-- invariant 1).
CREATE OR REPLACE FUNCTION public.p2p_lock_crypto_btc(
  p_order_id uuid,
  p_seller_id uuid,
  p_buyer_id uuid,
  p_amount_minor bigint
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold_id uuid;
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'Lock amount must be positive';
  END IF;

  PERFORM public.btc_adjust_crypto_wallet(p_seller_id, 0, -p_amount_minor);

  INSERT INTO public.p2p_escrow_holds (order_id, seller_id, buyer_id, asset, amount_minor)
  VALUES (p_order_id, p_seller_id, p_buyer_id, 'BTC', p_amount_minor)
  RETURNING id INTO v_hold_id;

  RETURN v_hold_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_lock_crypto_btc(uuid, uuid, uuid, bigint) FROM authenticated;

-- Unlock: the trade did not happen (expire / cancel / dispute
-- refund). Seller available += amount, exact to the sat.
CREATE OR REPLACE FUNCTION public.p2p_unlock_crypto_btc(
  p_order_id uuid,
  p_settlement text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.p2p_escrow_holds%ROWTYPE;
BEGIN
  SELECT * INTO v_hold
    FROM public.p2p_escrow_holds
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow hold not found for this order';
  END IF;
  IF v_hold.status <> 'locked' THEN
    RAISE EXCEPTION 'Escrow hold is not locked (status %)', v_hold.status;
  END IF;

  PERFORM public.btc_adjust_crypto_wallet(v_hold.seller_id, 0, v_hold.amount_minor);

  UPDATE public.p2p_escrow_holds
     SET status = 'unlocked',
         settlement = p_settlement,
         settled_at = now()
   WHERE id = v_hold.id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_unlock_crypto_btc(uuid, text) FROM authenticated;

-- Release: the trade completed (seller confirm / dispute ruling /
-- negotiated closure). Seller balance -= amount; buyer credited
-- amount - fee to balance AND available; fee to the platform row
-- (finding 3); a T+1 withdrawal-hold row records the buyer's net
-- credit (finding 5). Returns the fee taken.
CREATE OR REPLACE FUNCTION public.p2p_release_crypto_btc(
  p_order_id uuid,
  p_settlement text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hold public.p2p_escrow_holds%ROWTYPE;
  v_fee_percent numeric := 0;
  v_fee_minor bigint := 0;
  v_platform_user uuid;
  v_hold_hours integer := 24;
BEGIN
  SELECT * INTO v_hold
    FROM public.p2p_escrow_holds
   WHERE order_id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Escrow hold not found for this order';
  END IF;
  IF v_hold.status <> 'locked' THEN
    RAISE EXCEPTION 'Escrow hold is not locked (status %)', v_hold.status;
  END IF;

  -- Fee (§2.5): completed trades only, read from settings with
  -- the defensive default the platform pattern uses (0 if the row
  -- is somehow missing — the commercial decision never blocks a
  -- settlement that has already been agreed).
  SELECT COALESCE(s.p2p_fee_percent, 0), COALESCE(s.p2p_withdrawal_hold_hours, 24)
    INTO v_fee_percent, v_hold_hours
    FROM public.platform_settings s
   WHERE s.id;
  IF NOT FOUND THEN
    v_fee_percent := 0;
    v_hold_hours := 24;
  END IF;

  IF v_fee_percent > 0 THEN
    v_fee_minor := floor(v_hold.amount_minor * v_fee_percent / 100)::bigint;
  END IF;

  IF v_fee_minor > 0 THEN
    -- The platform operator: earliest-created admin (finding 3).
    SELECT ur.user_id INTO v_platform_user
      FROM public.user_roles ur
     WHERE ur.role = 'admin'
     ORDER BY ur.created_at, ur.user_id
     LIMIT 1;

    IF v_platform_user IS NULL
       OR v_platform_user = v_hold.seller_id
       OR v_platform_user = v_hold.buyer_id THEN
      -- No platform operator yet, or the operator IS a party:
      -- no fee (mirrors execute_payment_link_settlement).
      v_fee_minor := 0;
    END IF;
  END IF;

  PERFORM public.btc_adjust_crypto_wallet(v_hold.seller_id, -v_hold.amount_minor, 0);
  PERFORM public.btc_adjust_crypto_wallet(
    v_hold.buyer_id, v_hold.amount_minor - v_fee_minor, v_hold.amount_minor - v_fee_minor);
  IF v_fee_minor > 0 THEN
    PERFORM public.btc_adjust_crypto_wallet(v_platform_user, v_fee_minor, v_fee_minor);
  END IF;

  UPDATE public.p2p_escrow_holds
     SET status = 'released',
         fee_minor = v_fee_minor,
         settlement = p_settlement,
         settled_at = now()
   WHERE id = v_hold.id;

  -- T+1 withdrawal hold on the buyer's net credit (§3.8
  -- amendment; finding 5).
  INSERT INTO public.p2p_withdrawal_holds (user_id, order_id, asset, amount_minor, matures_at)
  VALUES (v_hold.buyer_id, p_order_id, v_hold.asset,
          v_hold.amount_minor - v_fee_minor,
          now() + make_interval(hours => v_hold_hours));

  RETURN v_fee_minor;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_release_crypto_btc(uuid, text) FROM authenticated;

-- Completion bookkeeping (§3.4): reputation accrues ONLY from
-- completed escrowed orders, and is written only here (settlement
-- paths) — users can never write the profile. The seller's median
-- release time is recomputed from their completed orders (exact
-- median of paid_marked -> completed minutes).
CREATE OR REPLACE FUNCTION public.p2p_apply_completion(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.p2p_orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
  PERFORM public.p2p_ensure_profile(v_order.crypto_seller_id);

  UPDATE public.p2p_trader_profiles
     SET trades_completed = trades_completed + 1,
         trades_as_buyer = trades_as_buyer + 1,
         volume_zmw_completed = volume_zmw_completed + v_order.fiat_amount_zmw,
         first_trade_at = COALESCE(first_trade_at, now()),
         last_trade_at = now(),
         updated_at = now()
   WHERE user_id = v_order.fiat_buyer_id;

  UPDATE public.p2p_trader_profiles
     SET trades_completed = trades_completed + 1,
         trades_as_seller = trades_as_seller + 1,
         volume_zmw_completed = volume_zmw_completed + v_order.fiat_amount_zmw,
         first_trade_at = COALESCE(first_trade_at, now()),
         last_trade_at = now(),
         updated_at = now()
   WHERE user_id = v_order.crypto_seller_id;

  UPDATE public.p2p_trader_profiles
     SET median_release_minutes = (
           SELECT percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (o.completed_at - o.paid_marked_at)) / 60.0)
             FROM public.p2p_orders o
            WHERE o.crypto_seller_id = v_order.crypto_seller_id
              AND o.status = 'completed'
              AND o.paid_marked_at IS NOT NULL
              AND o.completed_at IS NOT NULL),
         updated_at = now()
   WHERE user_id = v_order.crypto_seller_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_apply_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_apply_completion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_apply_completion(uuid) FROM authenticated;

-- Immutability (§2.6, §3.10): chat rows and audit rows can never
-- be updated or deleted — corrections are new rows. The trigger
-- blocks even a service-role accident outside a retention job.
CREATE OR REPLACE FUNCTION public.p2p_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'P2P chat and audit records are immutable';
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_block_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_block_mutation() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_block_mutation() FROM authenticated;

DROP TRIGGER IF EXISTS trg_p2p_messages_immutable ON public.p2p_order_messages;
CREATE TRIGGER trg_p2p_messages_immutable
  BEFORE UPDATE OR DELETE ON public.p2p_order_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_block_mutation();

DROP TRIGGER IF EXISTS trg_p2p_audit_log_immutable ON public.p2p_audit_log;
CREATE TRIGGER trg_p2p_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.p2p_audit_log
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_block_mutation();

-- ---------------------------------------------------------------------
-- 6. Callable RPCs — SECURITY DEFINER, service_role-only EXECUTE.
-- The Phase 1b `p2p` edge function verifies the caller's JWT and
-- calls these with the service-role client (§3.1 iron rule 6);
-- actor ids arrive as parameters and are checked INSIDE.
-- ---------------------------------------------------------------------

-- 6.1 p2p_create_ad — posting is gated (§3.3): sell-side on
-- can_post_ads + the band calibration (finding 7); buy-side on
-- can_trade (finding 6). Terms go through the contact-detail scan
-- (§2.1 / §3.7): an ad that tries to move the trade off-platform
-- at posting time is refused, in plain language.
CREATE OR REPLACE FUNCTION public.p2p_create_ad(
  p_owner_id uuid,
  p_side text,
  p_asset text,
  p_price_type text,
  p_fixed_price_zmw numeric DEFAULT NULL,
  p_margin_percent numeric DEFAULT NULL,
  p_total_amount_minor bigint DEFAULT NULL,
  p_min_order_zmw numeric DEFAULT NULL,
  p_max_order_zmw numeric DEFAULT NULL,
  p_payment_method_types text[] DEFAULT ARRAY[]::text[],
  p_payment_window_minutes integer DEFAULT 30,
  p_settle_delay_minutes integer DEFAULT 0,
  p_terms text DEFAULT NULL,
  p_min_counterparty_tier text DEFAULT 'T1',
  p_min_counterparty_trades integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limits jsonb;
  v_ad public.p2p_ads%ROWTYPE;
  v_snapshot public.p2p_price_snapshots%ROWTYPE;
  v_stale_minutes integer := 5;
  v_price numeric;
  v_band_factor numeric := 0.25;
  v_trades integer := 0;
  v_counterparties integer := 0;
  v_available_sats bigint := 0;
  v_total_value numeric;
  v_ad_max_cap numeric;
  v_has_snapshot boolean := false;
  v_off_market boolean := false;
BEGIN
  -- BTC only (CEO decision 2026-10-23): USDT is a designed
  -- refusal, not an error of the caller's making.
  IF p_asset = 'USDT' THEN
    RAISE EXCEPTION 'USDT trading is not available yet — P2P is Bitcoin-only for now';
  END IF;
  IF p_asset <> 'BTC' THEN
    RAISE EXCEPTION 'Unsupported asset: %', p_asset;
  END IF;
  IF p_side NOT IN ('sell_crypto', 'buy_crypto') THEN
    RAISE EXCEPTION 'Invalid ad side: %', p_side;
  END IF;
  IF p_price_type NOT IN ('fixed', 'margin') THEN
    RAISE EXCEPTION 'Invalid price type: %', p_price_type;
  END IF;
  IF p_price_type = 'fixed'
     AND (p_fixed_price_zmw IS NULL OR p_fixed_price_zmw <= 0) THEN
    RAISE EXCEPTION 'A fixed price is required for a fixed-price ad';
  END IF;
  IF p_price_type = 'margin'
     AND (p_margin_percent IS NULL OR p_margin_percent < -30 OR p_margin_percent > 30) THEN
    RAISE EXCEPTION 'Margin must be between -30% and +30%';
  END IF;
  IF p_total_amount_minor IS NULL OR p_total_amount_minor <= 0 THEN
    RAISE EXCEPTION 'The ad amount must be positive';
  END IF;
  IF p_min_order_zmw IS NULL OR p_min_order_zmw < 10 THEN
    RAISE EXCEPTION 'The minimum order is K10';
  END IF;
  IF p_max_order_zmw IS NULL OR p_max_order_zmw < p_min_order_zmw THEN
    RAISE EXCEPTION 'The maximum order must be at least the minimum order';
  END IF;
  IF p_payment_window_minutes NOT IN (15, 30, 45, 60, 120) THEN
    RAISE EXCEPTION 'Payment window must be 15, 30, 45, 60 or 120 minutes';
  END IF;
  IF p_settle_delay_minutes IS NULL OR p_settle_delay_minutes < 0 OR p_settle_delay_minutes > 1440 THEN
    RAISE EXCEPTION 'Settle delay must be between 0 and 1440 minutes';
  END IF;
  IF p_payment_method_types IS NULL OR array_length(p_payment_method_types, 1) IS NULL THEN
    RAISE EXCEPTION 'Choose at least one payment method type';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_payment_method_types) AS t
     WHERE t NOT IN ('mobile_money', 'bank')
  ) THEN
    RAISE EXCEPTION 'Unsupported payment method type in ad';
  END IF;
  IF p_min_counterparty_tier NOT IN ('T1', 'T2', 'T3') THEN
    RAISE EXCEPTION 'Invalid minimum counterparty tier';
  END IF;

  -- Terms scan (§3.7): phone-like digit runs, URLs, and the
  -- off-platform solicitation keywords are refused at posting.
  IF p_terms IS NOT NULL AND (
       length(regexp_replace(p_terms, '\D', '', 'g')) >= 9
       OR p_terms ~* 'https?://|www\.|wa\.me|whatsapp|telegram'
  ) THEN
    RAISE EXCEPTION 'Ad terms cannot contain contact details or links — trades stay inside BMaGlass Pay';
  END IF;

  v_limits := public.p2p_effective_limits(p_owner_id);

  IF p_side = 'sell_crypto' THEN
    IF NOT COALESCE((v_limits ->> 'can_post_ads')::boolean, false) THEN
      RAISE EXCEPTION 'You cannot post a sell ad yet: %',
        COALESCE(v_limits ->> 'reasons', 'requirements not met');
    END IF;
  ELSE
    IF NOT COALESCE((v_limits ->> 'can_trade')::boolean, false) THEN
      RAISE EXCEPTION 'You cannot post ads yet: %',
        COALESCE(v_limits ->> 'reasons', 'requirements not met');
    END IF;
  END IF;

  -- The advertiser must actually hold a registered, active
  -- payment method of a type the ad names (§2.4): sellers receive
  -- only on registered methods; buyers pay only from them.
  IF NOT EXISTS (
    SELECT 1
      FROM public.p2p_payment_methods m
     WHERE m.user_id = p_owner_id
       AND m.status = 'active'
       AND m.type = ANY (p_payment_method_types)
  ) THEN
    RAISE EXCEPTION 'Register an active payment method of the chosen type before posting this ad';
  END IF;

  -- Current index (margin pricing + sell inventory valuation +
  -- the off-market badge). A margin ad cannot be priced without
  -- a trustworthy index (§2.2).
  SELECT s.p2p_price_stale_minutes INTO v_stale_minutes
    FROM public.platform_settings s WHERE s.id;
  v_stale_minutes := COALESCE(v_stale_minutes, 5);

  SELECT * INTO v_snapshot
    FROM public.p2p_price_snapshots ps
   WHERE ps.asset = 'BTC'
   ORDER BY ps.created_at DESC
   LIMIT 1;
  v_has_snapshot := FOUND;

  IF p_price_type = 'margin' THEN
    IF NOT v_has_snapshot OR v_snapshot.is_stale
       OR v_snapshot.created_at < now() - make_interval(mins => v_stale_minutes) THEN
      RAISE EXCEPTION 'The BTC price index is unavailable right now — margin ads cannot be posted until it recovers';
    END IF;
    v_price := round(v_snapshot.index_zmw * (1 + p_margin_percent / 100), 2);
  ELSE
    v_price := p_fixed_price_zmw;
  END IF;

  IF p_side = 'sell_crypto' THEN
    -- Advertiser band (finding 7): completed trades AND unique
    -- counterparties grow the ad's max-order cap toward the tier
    -- ceiling.
    SELECT t.trades_completed INTO v_trades
      FROM public.p2p_trader_profiles t
     WHERE t.user_id = p_owner_id;
    v_trades := COALESCE(v_trades, 0);
    v_counterparties := public.p2p_distinct_counterparties(p_owner_id);

    IF v_trades >= 75 AND v_counterparties >= 40 THEN
      v_band_factor := 1.0;
    ELSIF v_trades >= 30 AND v_counterparties >= 20 THEN
      v_band_factor := 0.75;
    ELSIF v_trades >= 15 AND v_counterparties >= 10 THEN
      v_band_factor := 0.50;
    ELSE
      v_band_factor := 0.25;
    END IF;

    v_ad_max_cap := floor((v_limits ->> 'max_order_zmw')::numeric * v_band_factor);
    IF p_max_order_zmw > v_ad_max_cap THEN
      RAISE EXCEPTION 'Your current trader band caps an ad''s maximum order at K% — complete more trades with more counterparties to raise it', v_ad_max_cap;
    END IF;

    -- Inventory (§2.1): a sell ad is backed by the seller's
    -- AVAILABLE balance at posting (re-checked at every order).
    SELECT COALESCE(c.available_sats, 0) INTO v_available_sats
      FROM public.crypto_wallets c
     WHERE c.user_id = p_owner_id AND c.asset = 'BTC';
    v_available_sats := COALESCE(v_available_sats, 0);
    v_total_value := p_total_amount_minor::numeric * v_price / 100000000;
    IF v_total_value > v_available_sats::numeric * v_price / 100000000 THEN
      RAISE EXCEPTION 'This ad is larger than the Bitcoin you currently have available';
    END IF;
  END IF;

  INSERT INTO public.p2p_ads (
    owner_id, side, asset, price_type, fixed_price_zmw, margin_percent,
    total_amount_minor, min_order_zmw, max_order_zmw, payment_method_types,
    payment_window_minutes, settle_delay_minutes, terms,
    min_counterparty_tier, min_counterparty_trades
  ) VALUES (
    p_owner_id, p_side, 'BTC', p_price_type, p_fixed_price_zmw, p_margin_percent,
    p_total_amount_minor, p_min_order_zmw, p_max_order_zmw, p_payment_method_types,
    p_payment_window_minutes, p_settle_delay_minutes, p_terms,
    p_min_counterparty_tier, COALESCE(p_min_counterparty_trades, 0)
  )
  RETURNING * INTO v_ad;

  PERFORM public.p2p_write_audit(NULL, p_owner_id, 'user', 'ad_created',
    jsonb_build_object('ad_id', v_ad.id, 'side', v_ad.side, 'asset', 'BTC',
                       'price_zmw', v_price));

  -- Bait pricing (§3.8): > 10% off index posts, but is flagged —
  -- the badge warns takers and the pattern feeds sanctions.
  v_off_market := v_has_snapshot AND NOT v_snapshot.is_stale
                  AND v_snapshot.index_zmw > 0
                  AND abs(v_price - v_snapshot.index_zmw) / v_snapshot.index_zmw > 0.10;
  IF v_off_market THEN
    PERFORM public.p2p_write_risk(p_owner_id, NULL, NULL, 'off_market_ad', 10,
      jsonb_build_object('ad_id', v_ad.id, 'price_zmw', v_price,
                         'index_zmw', v_snapshot.index_zmw));
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ad', to_jsonb(v_ad),
    'price_zmw', v_price,
    'off_market', v_off_market);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_create_ad(uuid, text, text, text, numeric, numeric, bigint, numeric, numeric, text[], integer, integer, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_create_ad(uuid, text, text, text, numeric, numeric, bigint, numeric, numeric, text[], integer, integer, text, text, integer) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_create_ad(uuid, text, text, text, numeric, numeric, bigint, numeric, numeric, text[], integer, integer, text, text, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_create_ad(uuid, text, text, text, numeric, numeric, bigint, numeric, numeric, text[], integer, integer, text, text, integer) TO service_role;

-- 6.2 p2p_set_ad_status — owner-only pause / resume / close.
-- Resuming re-runs the posting gates (a sanctioned or drained
-- advertiser cannot revive an ad by toggling it).
CREATE OR REPLACE FUNCTION public.p2p_set_ad_status(
  p_owner_id uuid,
  p_ad_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ad public.p2p_ads%ROWTYPE;
  v_limits jsonb;
  v_remaining bigint;
BEGIN
  IF p_status NOT IN ('active', 'paused', 'closed') THEN
    RAISE EXCEPTION 'Invalid ad status: %', p_status;
  END IF;

  SELECT * INTO v_ad
    FROM public.p2p_ads
   WHERE id = p_ad_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ad not found';
  END IF;
  IF v_ad.owner_id <> p_owner_id THEN
    RAISE EXCEPTION 'This is not your ad';
  END IF;
  IF v_ad.status = 'closed' AND p_status <> 'closed' THEN
    RAISE EXCEPTION 'A closed ad cannot be reopened';
  END IF;

  IF p_status = 'active' AND v_ad.status <> 'active' THEN
    v_limits := public.p2p_effective_limits(p_owner_id);
    IF v_ad.side = 'sell_crypto' THEN
      IF NOT COALESCE((v_limits ->> 'can_post_ads')::boolean, false) THEN
        RAISE EXCEPTION 'You cannot reactivate a sell ad right now: %',
          COALESCE(v_limits ->> 'reasons', 'requirements not met');
      END IF;
    ELSE
      IF NOT COALESCE((v_limits ->> 'can_trade')::boolean, false) THEN
        RAISE EXCEPTION 'You cannot reactivate this ad right now: %',
          COALESCE(v_limits ->> 'reasons', 'requirements not met');
      END IF;
    END IF;

    SELECT v_ad.total_amount_minor - COALESCE(SUM(o.crypto_amount_minor), 0)
      INTO v_remaining
      FROM public.p2p_orders o
     WHERE o.ad_id = v_ad.id
       AND o.status IN ('escrow_locked', 'paid_marked', 'disputed', 'completed');
    IF COALESCE(v_remaining, v_ad.total_amount_minor) <= 0 THEN
      RAISE EXCEPTION 'This ad has no remaining amount to trade';
    END IF;
  END IF;

  UPDATE public.p2p_ads
     SET status = p_status, updated_at = now()
   WHERE id = p_ad_id
   RETURNING * INTO v_ad;

  PERFORM public.p2p_write_audit(NULL, p_owner_id, 'user', 'ad_status_changed',
    jsonb_build_object('ad_id', v_ad.id, 'status', p_status));

  RETURN jsonb_build_object('success', true, 'ad', to_jsonb(v_ad));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_set_ad_status(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_set_ad_status(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_set_ad_status(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_set_ad_status(uuid, uuid, text) TO service_role;

-- 6.3 p2p_create_order — ONE RPC, ONE transaction (§2.3): gates
-- BOTH parties, snapshots the price, locks the crypto, and only
-- then does the response contain the seller's payment details.
-- A failed lock aborts everything — no order, no details
-- (invariant 1). The gate order is deliberate and stable so
-- refusals are explainable and proof expectations deterministic:
-- existence/identity -> limits -> price/amounts -> amount gates
-- -> velocity -> counterparty requirements -> lock.
CREATE OR REPLACE FUNCTION public.p2p_create_order(
  p_taker_id uuid,
  p_ad_id uuid,
  p_fiat_amount_zmw numeric DEFAULT NULL,
  p_crypto_amount_minor bigint DEFAULT NULL,
  p_seller_payment_method_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_taker_ack_offmarket boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.p2p_orders%ROWTYPE;
  v_replay jsonb;
  v_ad public.p2p_ads%ROWTYPE;
  v_snapshot public.p2p_price_snapshots%ROWTYPE;
  v_stale_minutes integer := 5;
  v_taker_limits jsonb;
  v_advertiser_limits jsonb;
  v_seller_id uuid;
  v_buyer_id uuid;
  v_price numeric;
  v_fiat numeric;
  v_crypto bigint;
  v_remaining_minor bigint;
  v_method public.p2p_payment_methods%ROWTYPE;
  v_method_snapshot jsonb;
  v_order public.p2p_orders%ROWTYPE;
  v_result jsonb;
  v_pair_today integer := 0;
  v_buyer_paid_marked integer := 0;
  v_buyer_cancels_today integer := 0;
  v_disputes_lost_30d integer := 0;
  v_median_completed numeric;
BEGIN
  -- Idempotent replay (§2.3 invariant 4): the create key is
  -- unique on the order row; a retry returns the ORIGINAL
  -- outcome and creates nothing.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.p2p_orders
     WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing.taker_id <> p_taker_id THEN
        RAISE EXCEPTION 'Idempotency key already used';
      END IF;
      v_replay := public.p2p_idem_replay(v_existing.id, 'order_created', p_idempotency_key);
      IF v_replay IS NOT NULL THEN
        RETURN v_replay;
      END IF;
      RETURN jsonb_build_object('success', true, 'replayed', true,
                                'order', to_jsonb(v_existing));
    END IF;
  END IF;

  SELECT * INTO v_ad
    FROM public.p2p_ads
   WHERE id = p_ad_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ad not found';
  END IF;
  IF v_ad.status <> 'active' THEN
    RAISE EXCEPTION 'This ad is not open for orders right now';
  END IF;
  IF v_ad.asset <> 'BTC' THEN
    RAISE EXCEPTION 'USDT trading is not available yet — P2P is Bitcoin-only for now';
  END IF;
  IF v_ad.owner_id = p_taker_id THEN
    RAISE EXCEPTION 'You cannot open an order on your own ad';
  END IF;

  -- Blocks (§3.4): no orders between a blocked pair, either way.
  IF EXISTS (
    SELECT 1 FROM public.p2p_blocks b
     WHERE (b.blocker_id = p_taker_id AND b.blocked_id = v_ad.owner_id)
        OR (b.blocker_id = v_ad.owner_id AND b.blocked_id = p_taker_id)
  ) THEN
    RAISE EXCEPTION 'Orders are not possible between you and this trader';
  END IF;

  -- Shared identity signals (§3.4(b), §3.8): counterparties who
  -- share an ID fingerprint / phone / payment account never
  -- trade — reputation farming and self-dealing die here.
  IF EXISTS (
    SELECT 1
      FROM public.p2p_identity_signals sa
      JOIN public.p2p_identity_signals sb
        ON sb.signal_type = sa.signal_type
       AND sb.signal_hash = sa.signal_hash
     WHERE sa.user_id = p_taker_id
       AND sb.user_id = v_ad.owner_id
  ) THEN
    PERFORM public.p2p_write_risk(p_taker_id, v_ad.owner_id, NULL,
      'shared_identity_signal', 25, jsonb_build_object('ad_id', v_ad.id));
    PERFORM public.p2p_write_risk(v_ad.owner_id, p_taker_id, NULL,
      'shared_identity_signal', 25, jsonb_build_object('ad_id', v_ad.id));
    RAISE EXCEPTION 'This trade is not allowed — the accounts share identity records and have been flagged for review';
  END IF;

  -- Gate BOTH parties through the one limits function (§3.3).
  v_taker_limits := public.p2p_effective_limits(p_taker_id);
  IF NOT COALESCE((v_taker_limits ->> 'can_trade')::boolean, false) THEN
    RAISE EXCEPTION 'You cannot trade right now: %',
      COALESCE(v_taker_limits ->> 'reasons', 'requirements not met');
  END IF;
  v_advertiser_limits := public.p2p_effective_limits(v_ad.owner_id);
  IF NOT COALESCE((v_advertiser_limits ->> 'can_trade')::boolean, false) THEN
    RAISE EXCEPTION 'This advertiser cannot trade right now — try another ad';
  END IF;

  -- Risk score (§3.8): at/above threshold, trading pauses for
  -- human review — stated to the user, never a shadow-ban.
  IF public.p2p_risk_score(p_taker_id) >= 100 THEN
    RAISE EXCEPTION 'Your P2P trading is paused for a safety review — contact support if you believe this is a mistake';
  END IF;
  IF public.p2p_risk_score(v_ad.owner_id) >= 100 THEN
    RAISE EXCEPTION 'This advertiser is under a safety review — try another ad';
  END IF;

  -- Price (§2.2): the index must be fresh and verified, for BOTH
  -- price types — never trade on a price we cannot verify.
  SELECT s.p2p_price_stale_minutes INTO v_stale_minutes
    FROM public.platform_settings s WHERE s.id;
  v_stale_minutes := COALESCE(v_stale_minutes, 5);

  SELECT * INTO v_snapshot
    FROM public.p2p_price_snapshots ps
   WHERE ps.asset = 'BTC'
   ORDER BY ps.created_at DESC
   LIMIT 1;

  IF NOT FOUND OR v_snapshot.is_stale
     OR v_snapshot.created_at < now() - make_interval(mins => v_stale_minutes) THEN
    RAISE EXCEPTION 'The BTC price index is stale right now — orders are paused until it recovers';
  END IF;

  IF v_ad.price_type = 'fixed' THEN
    v_price := v_ad.fixed_price_zmw;
  ELSE
    v_price := round(v_snapshot.index_zmw * (1 + v_ad.margin_percent / 100), 2);
  END IF;

  -- Bait warning (§3.8, §5.4 case 12): > 10% off index, the
  -- taker must explicitly acknowledge before the order opens.
  IF abs(v_price - v_snapshot.index_zmw) / v_snapshot.index_zmw > 0.10
     AND NOT COALESCE(p_taker_ack_offmarket, false) THEN
    RAISE EXCEPTION 'This ad is priced more than 10% away from the market price — if you understand and want to continue, confirm the warning and try again';
  END IF;

  -- Amounts: exactly one of fiat / crypto is specified (§2.3).
  IF (p_fiat_amount_zmw IS NULL) = (p_crypto_amount_minor IS NULL) THEN
    RAISE EXCEPTION 'Specify either a ZMW amount or a BTC amount, not both';
  END IF;
  IF p_fiat_amount_zmw IS NOT NULL THEN
    v_fiat := round(p_fiat_amount_zmw, 2);
    v_crypto := floor(v_fiat / v_price * 100000000)::bigint;
  ELSE
    v_crypto := p_crypto_amount_minor;
    v_fiat := round(v_crypto::numeric / 100000000 * v_price, 2);
  END IF;
  IF v_crypto <= 0 OR v_fiat <= 0 THEN
    RAISE EXCEPTION 'The order amount is too small';
  END IF;
  IF v_fiat < v_ad.min_order_zmw OR v_fiat > v_ad.max_order_zmw THEN
    RAISE EXCEPTION 'Orders on this ad are between K% and K%', v_ad.min_order_zmw, v_ad.max_order_zmw;
  END IF;

  -- Remaining ad inventory (listings do not lock; orders do).
  SELECT v_ad.total_amount_minor - COALESCE(SUM(o.crypto_amount_minor), 0)
    INTO v_remaining_minor
    FROM public.p2p_orders o
   WHERE o.ad_id = v_ad.id
     AND o.status IN ('escrow_locked', 'paid_marked', 'disputed', 'completed');
  IF v_crypto > COALESCE(v_remaining_minor, v_ad.total_amount_minor) THEN
    RAISE EXCEPTION 'This ad does not have enough remaining amount for that order';
  END IF;

  -- Amount gates against BOTH parties' limits (§3.3).
  IF v_fiat > (v_taker_limits ->> 'max_order_zmw')::numeric THEN
    RAISE EXCEPTION 'That amount is above your per-order limit of K%', v_taker_limits ->> 'max_order_zmw';
  END IF;
  IF v_fiat > (v_advertiser_limits ->> 'max_order_zmw')::numeric THEN
    RAISE EXCEPTION 'That amount is above the advertiser''s per-order limit';
  END IF;
  IF v_fiat > (v_taker_limits ->> 'daily_remaining_zmw')::numeric THEN
    RAISE EXCEPTION 'That order would exceed your remaining daily limit of K%', v_taker_limits ->> 'daily_remaining_zmw';
  END IF;
  IF v_fiat > (v_advertiser_limits ->> 'daily_remaining_zmw')::numeric THEN
    RAISE EXCEPTION 'That order would exceed the advertiser''s remaining daily limit';
  END IF;

  -- Velocity hard caps (§3.3): open orders and orders/day come
  -- from the limits payload; the pair cap, the fake-paid brake,
  -- the cancels tariff and the dispute brakes are computed here.
  IF (v_taker_limits ->> 'open_orders')::integer >= (v_taker_limits ->> 'max_open_orders')::integer THEN
    RAISE EXCEPTION 'You already have the maximum of % open orders — finish or cancel one first', v_taker_limits ->> 'max_open_orders';
  END IF;
  IF (v_advertiser_limits ->> 'open_orders')::integer >= (v_advertiser_limits ->> 'max_open_orders')::integer THEN
    RAISE EXCEPTION 'This advertiser already has the maximum number of open orders';
  END IF;

  IF v_ad.side = 'sell_crypto' THEN
    v_seller_id := v_ad.owner_id;
    v_buyer_id := p_taker_id;
  ELSE
    v_seller_id := p_taker_id;
    v_buyer_id := v_ad.owner_id;
  END IF;

  SELECT COUNT(*) INTO v_pair_today
    FROM public.p2p_orders o
   WHERE ((o.taker_id = p_taker_id AND o.advertiser_id = v_ad.owner_id)
       OR (o.taker_id = v_ad.owner_id AND o.advertiser_id = p_taker_id))
     AND o.status IN ('escrow_locked', 'paid_marked', 'disputed', 'completed')
     AND o.created_at >= date_trunc('day', now());
  IF v_pair_today >= 3 THEN
    RAISE EXCEPTION 'You have reached today''s limit of 3 orders with the same trader';
  END IF;

  SELECT COUNT(*) INTO v_buyer_paid_marked
    FROM public.p2p_orders o
   WHERE o.fiat_buyer_id = v_buyer_id
     AND o.status = 'paid_marked';
  IF v_buyer_paid_marked > 5 THEN
    RAISE EXCEPTION 'Too many paid-but-unreleased orders — new orders are paused until some complete';
  END IF;

  -- OKX tariff (§3.9 amendment): 3 buyer cancels in a day stops
  -- buying for the rest of that day.
  SELECT COUNT(*) INTO v_buyer_cancels_today
    FROM public.p2p_orders o
   WHERE o.fiat_buyer_id = v_buyer_id
     AND o.status = 'cancelled_unpaid'
     AND o.cancelled_at >= date_trunc('day', now());
  IF v_buyer_cancels_today >= 3 THEN
    RAISE EXCEPTION 'You cancelled 3 orders today — buying is paused until tomorrow';
  END IF;

  -- Dispute brakes (§3.6, §3.8): an open dispute suspends new
  -- orders above K500 for BOTH parties; > 3 disputes lost in 30
  -- days pauses a trader pending review.
  IF v_fiat > 500 AND EXISTS (
    SELECT 1
      FROM public.p2p_disputes d
      JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.status = 'open'
       AND (o.advertiser_id IN (p_taker_id, v_ad.owner_id)
            OR o.taker_id IN (p_taker_id, v_ad.owner_id))
  ) THEN
    RAISE EXCEPTION 'A dispute is open on an existing trade — orders above K500 are paused until it is resolved';
  END IF;

  SELECT COUNT(*) INTO v_disputes_lost_30d
    FROM public.p2p_disputes d
    JOIN public.p2p_orders o ON o.id = d.order_id
   WHERE d.ruled_at >= now() - interval '30 days'
     AND d.status IN ('ruled_release', 'ruled_refund', 'negotiated_release', 'negotiated_refund')
     AND ((d.status IN ('ruled_release', 'negotiated_release') AND o.crypto_seller_id = p_taker_id)
       OR (d.status IN ('ruled_refund', 'negotiated_refund') AND o.fiat_buyer_id = p_taker_id));
  IF v_disputes_lost_30d > 3 THEN
    RAISE EXCEPTION 'Your P2P trading is paused pending review after several lost disputes';
  END IF;

  -- The ad's counterparty requirements (§2.1) bind the taker.
  IF public.p2p_tier_rank(v_taker_limits ->> 'tier')
       < public.p2p_tier_rank(v_ad.min_counterparty_tier) THEN
    RAISE EXCEPTION 'This advertiser requires a % verified account or higher', v_ad.min_counterparty_tier;
  END IF;
  IF COALESCE((SELECT t.trades_completed
                 FROM public.p2p_trader_profiles t
                WHERE t.user_id = p_taker_id), 0) < v_ad.min_counterparty_trades THEN
    RAISE EXCEPTION 'This advertiser requires at least % completed trades', v_ad.min_counterparty_trades;
  END IF;

  -- First 5 completed trades (§3.3): new traders pair only with
  -- established (T2+) advertisers while they learn the flow.
  IF COALESCE((SELECT t.trades_completed
                 FROM public.p2p_trader_profiles t
                WHERE t.user_id = p_taker_id), 0) < 5
     AND public.p2p_tier_rank(v_advertiser_limits ->> 'tier') < 2 THEN
    RAISE EXCEPTION 'While you are new, you can only trade with fully verified (T2+) advertisers';
  END IF;

  -- The seller's receiving method comes FROM THE REGISTRY (§2.4),
  -- never typed per-order: for a sell ad it is the advertiser's
  -- primary active method of an accepted type; for a buy ad the
  -- taker-seller names their own registered method explicitly.
  IF v_ad.side = 'sell_crypto' THEN
    SELECT * INTO v_method
      FROM public.p2p_payment_methods m
     WHERE m.user_id = v_seller_id
       AND m.status = 'active'
       AND m.type = ANY (v_ad.payment_method_types)
     ORDER BY m.is_primary DESC, m.created_at ASC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The advertiser has no active payment method for this ad';
    END IF;
  ELSE
    IF p_seller_payment_method_id IS NULL THEN
      RAISE EXCEPTION 'Choose the registered payment method you want to receive payment on';
    END IF;
    SELECT * INTO v_method
      FROM public.p2p_payment_methods m
     WHERE m.id = p_seller_payment_method_id;
    IF NOT FOUND OR v_method.user_id <> v_seller_id OR v_method.status <> 'active' THEN
      RAISE EXCEPTION 'That payment method is not one of your active registered methods';
    END IF;
    IF NOT (v_method.type = ANY (v_ad.payment_method_types)) THEN
      RAISE EXCEPTION 'That payment method type is not accepted by this ad';
    END IF;
  END IF;

  v_method_snapshot := jsonb_build_object(
    'method_id', v_method.id,
    'type', v_method.type,
    'account_number', v_method.account_number,
    'account_name', v_method.account_name,
    'bank_name', v_method.bank_name);

  -- Create the order, then LOCK — one transaction (§2.3). If the
  -- lock raises (insufficient available), everything above rolls
  -- back with it: no order exists and no payment details were
  -- ever returned.
  BEGIN
    INSERT INTO public.p2p_orders (
      ad_id, advertiser_id, taker_id, crypto_seller_id, fiat_buyer_id,
      asset, crypto_amount_minor, fiat_amount_zmw, price_zmw, index_snapshot,
      payment_method_snapshot, settle_delay_minutes, status, expires_at,
      idempotency_key
    ) VALUES (
      v_ad.id, v_ad.owner_id, p_taker_id, v_seller_id, v_buyer_id,
      'BTC', v_crypto, v_fiat, v_price,
      jsonb_build_object('index_zmw', v_snapshot.index_zmw,
                         'snapshot_id', v_snapshot.id,
                         'captured_at', v_snapshot.created_at,
                         'sources', v_snapshot.sources),
      v_method_snapshot, v_ad.settle_delay_minutes, 'escrow_locked',
      now() + make_interval(mins => v_ad.payment_window_minutes),
      p_idempotency_key
    )
    RETURNING * INTO v_order;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent create with the same key won the race: return
    -- its outcome instead of duplicating the order.
    SELECT * INTO v_existing
      FROM public.p2p_orders
     WHERE idempotency_key = p_idempotency_key;
    IF v_existing.taker_id <> p_taker_id THEN
      RAISE EXCEPTION 'Idempotency key already used';
    END IF;
    v_replay := public.p2p_idem_replay(v_existing.id, 'order_created', p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
    RETURN jsonb_build_object('success', true, 'replayed', true,
                              'order', to_jsonb(v_existing));
  END;

  PERFORM public.p2p_lock_crypto_btc(v_order.id, v_seller_id, v_buyer_id, v_crypto);

  v_result := jsonb_build_object(
    'success', true,
    'order', to_jsonb(v_order),
    'payment_method_snapshot', v_method_snapshot);

  PERFORM public.p2p_write_audit(v_order.id, p_taker_id, 'user', 'order_created',
    jsonb_build_object('ad_id', v_ad.id, 'fiat_amount_zmw', v_fiat,
                       'crypto_amount_minor', v_crypto, 'price_zmw', v_price,
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_write_audit(v_order.id, NULL, 'system', 'escrow_locked',
    jsonb_build_object('amount_minor', v_crypto, 'asset', 'BTC'));

  PERFORM public.p2p_system_message(v_order.id,
    'Escrow locked: ' || trim(to_char(v_crypto::numeric / 100000000, 'FM0.00000000'))
    || ' BTC is held by BMaGlass Pay until the seller confirms payment.');
  PERFORM public.p2p_system_message(v_order.id,
    'Stay safe: only pay the account shown on this order. Never trust a screenshot — the seller must check inside their own account. BMaGlass staff will never message you inside a trade, never ask you to cancel or release, and never ask you to move to WhatsApp. Anyone claiming to be support here is a scammer — report them.');

  -- Unusual amount (§3.8 soft signal): > 3x the taker's median
  -- completed order.
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY o.fiat_amount_zmw)
    INTO v_median_completed
    FROM public.p2p_orders o
   WHERE (o.taker_id = p_taker_id OR o.advertiser_id = p_taker_id)
     AND o.status = 'completed';
  IF v_median_completed IS NOT NULL AND v_median_completed > 0
     AND v_fiat > 3 * v_median_completed THEN
    PERFORM public.p2p_write_risk(p_taker_id, v_ad.owner_id, v_order.id,
      'unusual_amount', 10,
      jsonb_build_object('fiat_amount_zmw', v_fiat, 'median_completed_zmw', v_median_completed));
  END IF;

  PERFORM public.p2p_eval_fraud_rules(p_taker_id, v_ad.owner_id, v_order.id, v_fiat);

  -- An ad whose remaining amount is fully committed is exhausted.
  IF v_crypto >= COALESCE(v_remaining_minor, v_ad.total_amount_minor) THEN
    UPDATE public.p2p_ads
       SET status = 'exhausted', updated_at = now()
     WHERE id = v_ad.id;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_create_order(uuid, uuid, numeric, bigint, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_create_order(uuid, uuid, numeric, bigint, uuid, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_create_order(uuid, uuid, numeric, bigint, uuid, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_create_order(uuid, uuid, numeric, bigint, uuid, text, boolean) TO service_role;

-- 6.4 p2p_cancel_order — ONLY from escrow_locked (§2.3 amendment:
-- a buyer who has paid must never cancel; a PAID_MARKED order has
-- no cancel path at all). The fiat buyer may cancel pre-payment
-- freely; the crypto seller only once the payment window has
-- expired (the Binance rule) — before that, the seller's remedy
-- is to wait for expiry. Unlocking is exact; the taker's unpaid
-- counters reflect the death (§3.4).
CREATE OR REPLACE FUNCTION public.p2p_cancel_order(
  p_caller_id uuid,
  p_order_id uuid,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_replay jsonb;
  v_result jsonb;
  v_final_status text;
BEGIN
  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Replay / terminal handling (invariant 4).
  IF v_order.status IN ('cancelled_unpaid', 'expired_unpaid') THEN
    v_replay := public.p2p_idem_replay(p_order_id, 'cancelled', p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
    RAISE EXCEPTION 'This order has already ended';
  END IF;
  IF v_order.status <> 'escrow_locked' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled — if you have paid, open a dispute instead';
  END IF;
  IF p_caller_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
    RAISE EXCEPTION 'Only a party to this order can cancel it';
  END IF;

  -- Seller-side restriction (§2.3 amendment c): the crypto
  -- seller cannot cancel before the payment window expires.
  IF p_caller_id = v_order.crypto_seller_id AND now() < v_order.expires_at THEN
    RAISE EXCEPTION 'The seller cannot cancel while the payment window is still open — the escrow unlocks automatically when the window expires unpaid';
  END IF;

  PERFORM public.p2p_unlock_crypto_btc(p_order_id,
    CASE WHEN p_caller_id = v_order.crypto_seller_id THEN 'expire' ELSE 'cancel' END);

  -- A seller cancelling after expiry is the expiry outcome by
  -- another door (the taker let the window die); a pre-expiry
  -- cancel is the buyer's free exit. Either way the taker's
  -- unpaid counters move (§3.4).
  IF p_caller_id = v_order.crypto_seller_id THEN
    v_final_status := 'expired_unpaid';
    PERFORM public.p2p_ensure_profile(v_order.taker_id);
    UPDATE public.p2p_trader_profiles
       SET orders_expired_unpaid = orders_expired_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.taker_id;
  ELSE
    v_final_status := 'cancelled_unpaid';
    PERFORM public.p2p_ensure_profile(v_order.taker_id);
    UPDATE public.p2p_trader_profiles
       SET orders_cancelled_unpaid = orders_cancelled_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.taker_id;
  END IF;

  UPDATE public.p2p_orders
     SET status = v_final_status,
         cancel_reason = p_reason,
         cancelled_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  v_result := jsonb_build_object('success', true, 'order', to_jsonb(v_order));

  PERFORM public.p2p_write_audit(p_order_id, p_caller_id, 'user', 'cancelled',
    jsonb_build_object('reason', p_reason, 'final_status', v_final_status,
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_system_message(p_order_id,
    'Order cancelled before payment — the escrowed Bitcoin has been returned to the seller. A payment made now is NOT protected.');

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_cancel_order(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_cancel_order(uuid, uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_cancel_order(uuid, uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_cancel_order(uuid, uuid, text, text) TO service_role;

-- 6.5 p2p_mark_paid — the buyer's claim (§3.5). Structural, not
-- advisory: the method must be the buyer's OWN registered active
-- method with a verified name match; the attested payer name must
-- equal the KYC canonical name; the amount must be exact; the
-- reference is single-use platform-wide. A reuse attempt is a
-- RETURNED refusal with a high-weight risk event (header
-- finding 8) — attempted fraud, not a data-entry error.
CREATE OR REPLACE FUNCTION public.p2p_mark_paid(
  p_buyer_id uuid,
  p_order_id uuid,
  p_payment_method_id uuid,
  p_rail_reference text,
  p_amount_sent_zmw numeric,
  p_payer_name_attested text DEFAULT NULL,
  p_proof_file_hash text DEFAULT NULL,
  p_proof_storage_path text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_method public.p2p_payment_methods%ROWTYPE;
  v_replay jsonb;
  v_result jsonb;
  v_ref_norm text;
  v_kyc_name_norm text;
  v_seller_response_hours integer := 12;
BEGIN
  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_order.status = 'paid_marked' THEN
    v_replay := public.p2p_idem_replay(p_order_id, 'paid_marked', p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
    RAISE EXCEPTION 'This order is already marked as paid';
  END IF;
  IF v_order.status <> 'escrow_locked' THEN
    RAISE EXCEPTION 'This order cannot be marked as paid in its current state';
  END IF;
  IF p_buyer_id <> v_order.fiat_buyer_id THEN
    RAISE EXCEPTION 'Only the buyer can mark this order as paid';
  END IF;
  IF now() >= v_order.expires_at THEN
    RAISE EXCEPTION 'This order has expired — do not pay it. A payment made now is NOT protected';
  END IF;

  -- The paying method: the buyer's own, registered, active,
  -- name-verified (§2.4, §3.5). Third-party payment is refused
  -- HERE, structurally — not discouraged in copy.
  SELECT * INTO v_method
    FROM public.p2p_payment_methods
   WHERE id = p_payment_method_id;
  IF NOT FOUND OR v_method.user_id <> p_buyer_id THEN
    RAISE EXCEPTION 'You can only pay from one of your own registered payment methods';
  END IF;
  IF v_method.status <> 'active' THEN
    RAISE EXCEPTION 'That payment method is not active';
  END IF;
  IF NOT v_method.verified_name_match THEN
    RAISE EXCEPTION 'That payment method''s account name does not match your verified name — pay from an account in your own name';
  END IF;

  -- Payer-name attestation (§3.5): pre-filled from the KYC
  -- canonical name and verified against it here.
  SELECT k.name_norm INTO v_kyc_name_norm
    FROM public.kyc_verifications k
   WHERE k.user_id = p_buyer_id;
  IF p_payer_name_attested IS NULL
     OR public.p2p_normalise_name(p_payer_name_attested) IS DISTINCT FROM v_kyc_name_norm THEN
    RAISE EXCEPTION 'Payments must come from your own account in your verified name';
  END IF;

  IF p_rail_reference IS NULL OR length(btrim(p_rail_reference)) < 4 THEN
    RAISE EXCEPTION 'Enter the payment reference from your MoMo or bank transaction';
  END IF;
  v_ref_norm := upper(regexp_replace(p_rail_reference, '[^A-Za-z0-9]', '', 'g'));

  -- One payment, full amount (§2.3 amendment a): partial payment
  -- is a dispute trigger, never a release path.
  IF p_amount_sent_zmw IS NULL OR round(p_amount_sent_zmw, 2) <> v_order.fiat_amount_zmw THEN
    RAISE EXCEPTION 'The amount sent must be exactly K% — one payment, in full', v_order.fiat_amount_zmw;
  END IF;

  -- Single-use reference (§3.5 amendment): a reuse attempt is
  -- refused AND recorded before returning (finding 8).
  IF EXISTS (
    SELECT 1 FROM public.p2p_payment_claims c
     WHERE c.rail_reference_norm = v_ref_norm
  ) THEN
    PERFORM public.p2p_write_risk(p_buyer_id, v_order.crypto_seller_id, p_order_id,
      'rail_reference_reuse', 50,
      jsonb_build_object('reference_masked', public.p2p_mask_ref(p_rail_reference)));
    PERFORM public.p2p_write_audit(p_order_id, p_buyer_id, 'user', 'limit_checked_failed',
      jsonb_build_object('check', 'rail_reference_reuse',
                         'reference_masked', public.p2p_mask_ref(p_rail_reference)));
    RETURN jsonb_build_object(
      'success', false,
      'code', 'rail_reference_reused',
      'message', 'This payment reference has already been used on another order. Each payment can only be claimed once — check your transaction and try again with the correct reference.');
  END IF;

  INSERT INTO public.p2p_payment_claims (
    order_id, payment_method_id, rail_reference, rail_reference_norm,
    amount_sent_zmw, payer_name_attested, proof_file_hash, proof_storage_path
  ) VALUES (
    p_order_id, p_payment_method_id, btrim(p_rail_reference), v_ref_norm,
    round(p_amount_sent_zmw, 2), p_payer_name_attested,
    p_proof_file_hash, p_proof_storage_path
  );

  SELECT COALESCE(s.p2p_seller_response_hours, 12) INTO v_seller_response_hours
    FROM public.platform_settings s WHERE s.id;
  v_seller_response_hours := COALESCE(v_seller_response_hours, 12);

  UPDATE public.p2p_orders
     SET status = 'paid_marked',
         paid_marked_at = now(),
         seller_deadline_at = now() + make_interval(hours => v_seller_response_hours),
         buyer_payment_method_id = p_payment_method_id,
         rail_reference = btrim(p_rail_reference),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  v_result := jsonb_build_object('success', true, 'order', to_jsonb(v_order));

  PERFORM public.p2p_write_audit(p_order_id, p_buyer_id, 'user', 'paid_marked',
    jsonb_build_object('amount_sent_zmw', p_amount_sent_zmw,
                       'reference_masked', public.p2p_mask_ref(p_rail_reference),
                       'payment_method_id', p_payment_method_id,
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_system_message(p_order_id,
    'Buyer marked paid — reference ' || public.p2p_mask_ref(p_rail_reference)
    || '. Seller: check INSIDE your own MoMo/bank account — never a screenshot or SMS — and confirm only when the full amount is there, from the buyer named on this order.');

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_mark_paid(uuid, uuid, uuid, text, numeric, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_mark_paid(uuid, uuid, uuid, text, numeric, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_mark_paid(uuid, uuid, uuid, text, numeric, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_mark_paid(uuid, uuid, uuid, text, numeric, text, text, text, text) TO service_role;

-- 6.6 p2p_confirm_release — the release (§3.5). Seller ONLY, from
-- PAID_MARKED ONLY, and only with the amount + reference the
-- seller types from THEIR OWN account matching the order's claim
-- exactly, plus the three checklist assertions. A typed mismatch
-- is a RETURNED refusal with a risk event (finding 8): a seller
-- who cannot produce the reference cannot release — they can
-- re-check, or dispute. The fiat payer can NEVER call this
-- successfully (§2.3 invariant 3): they are not the seller.
CREATE OR REPLACE FUNCTION public.p2p_confirm_release(
  p_seller_id uuid,
  p_order_id uuid,
  p_received_amount_zmw numeric,
  p_received_reference text,
  p_checked_own_account boolean DEFAULT false,
  p_checked_full_amount boolean DEFAULT false,
  p_checked_sender_name boolean DEFAULT false,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_claim public.p2p_payment_claims%ROWTYPE;
  v_replay jsonb;
  v_result jsonb;
  v_fee_minor bigint;
  v_ref_norm text;
BEGIN
  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  -- Double release (invariant 4): replay returns the original
  -- outcome; a fresh key against a completed order is refused.
  -- Balances never move twice.
  IF v_order.status = 'completed' THEN
    v_replay := public.p2p_idem_replay(p_order_id, 'released', p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN v_replay;
    END IF;
    RAISE EXCEPTION 'This order is already completed';
  END IF;

  IF p_seller_id <> v_order.crypto_seller_id THEN
    RAISE EXCEPTION 'Only the seller can confirm release for this order';
  END IF;
  IF v_order.status = 'disputed' THEN
    RAISE EXCEPTION 'This order is in dispute — the escrow is frozen until an admin ruling';
  END IF;
  IF v_order.status <> 'paid_marked' THEN
    RAISE EXCEPTION 'The buyer has not marked this order as paid yet';
  END IF;

  -- Advertiser settle delay (§3.6): release is unavailable until
  -- the delay after paid-marked has run — returned, not raised,
  -- because the UI polls it (a normal state, not an error).
  IF v_order.settle_delay_minutes > 0
     AND now() < v_order.paid_marked_at + make_interval(mins => v_order.settle_delay_minutes) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'settle_delay_active',
      'message', 'This ad has a settle delay — release opens '
                 || v_order.settle_delay_minutes
                 || ' minutes after payment was marked. Waiting protects you against reversed payments.',
      'release_available_at', v_order.paid_marked_at + make_interval(mins => v_order.settle_delay_minutes));
  END IF;

  IF NOT (COALESCE(p_checked_own_account, false)
          AND COALESCE(p_checked_full_amount, false)
          AND COALESCE(p_checked_sender_name, false)) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'checklist_incomplete',
      'message', 'Confirm all three checks first: you checked inside your own account, the full amount is there, and the sender name matches this order.');
  END IF;

  SELECT * INTO v_claim
    FROM public.p2p_payment_claims
   WHERE order_id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No payment claim exists for this order';
  END IF;

  v_ref_norm := upper(regexp_replace(COALESCE(p_received_reference, ''), '[^A-Za-z0-9]', '', 'g'));

  IF p_received_amount_zmw IS NULL
     OR round(p_received_amount_zmw, 2) <> v_order.fiat_amount_zmw
     OR v_ref_norm <> v_claim.rail_reference_norm THEN
    PERFORM public.p2p_write_risk(p_seller_id, v_order.fiat_buyer_id, p_order_id,
      'release_match_failed', 10,
      jsonb_build_object('expected_reference_masked', public.p2p_mask_ref(v_claim.rail_reference)));
    PERFORM public.p2p_write_audit(p_order_id, p_seller_id, 'user', 'limit_checked_failed',
      jsonb_build_object('check', 'release_typed_match'));
    RETURN jsonb_build_object(
      'success', false,
      'code', 'details_do_not_match',
      'message', 'The amount or reference you entered does not match this order. Check inside your own account and try again — never release based on a screenshot. If the payment is not in your account, open a dispute instead.');
  END IF;

  v_fee_minor := public.p2p_release_crypto_btc(p_order_id, 'confirm');

  UPDATE public.p2p_orders
     SET status = 'completed',
         fee_minor = v_fee_minor,
         completed_at = now(),
         updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  -- After the status lands, so this trade counts in the
  -- seller's median release time (§3.4).
  PERFORM public.p2p_apply_completion(p_order_id);

  v_result := jsonb_build_object('success', true, 'order', to_jsonb(v_order),
                                 'fee_minor', v_fee_minor);

  PERFORM public.p2p_write_audit(p_order_id, p_seller_id, 'user', 'release_confirmed',
    jsonb_build_object('reference_masked', public.p2p_mask_ref(v_claim.rail_reference)));
  PERFORM public.p2p_write_audit(p_order_id, p_seller_id, 'user', 'released',
    jsonb_build_object('fee_minor', v_fee_minor, 'settlement', 'confirm',
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_system_message(p_order_id,
    'Payment confirmed — the Bitcoin has been released to the buyer. This trade is complete.');

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_confirm_release(uuid, uuid, numeric, text, boolean, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_confirm_release(uuid, uuid, numeric, text, boolean, boolean, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_confirm_release(uuid, uuid, numeric, text, boolean, boolean, boolean, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_confirm_release(uuid, uuid, numeric, text, boolean, boolean, boolean, text) TO service_role;

-- 6.7 Dispute settlement core (internal): executes an outcome
-- against a frozen (or post-completion) order. Shared by the
-- admin ruling and the negotiated closure; the CALLERS own the
-- actor checks, this owns the money + state + counters so the
-- two paths can never diverge.
CREATE OR REPLACE FUNCTION public.p2p_execute_dispute_outcome(
  p_order_id uuid,
  p_dispute_id uuid,
  p_outcome text,
  p_final_status text,
  p_closed_via text,
  p_actor_id uuid,
  p_actor_type text,
  p_apply_counters boolean,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_dispute public.p2p_disputes%ROWTYPE;
  v_fee_minor bigint := 0;
  v_event text;
  v_settled jsonb;
BEGIN
  SELECT * INTO v_order FROM public.p2p_orders WHERE id = p_order_id;
  SELECT * INTO v_dispute FROM public.p2p_disputes WHERE id = p_dispute_id;

  IF v_dispute.affects_escrow THEN
    IF p_outcome = 'release_to_buyer' THEN
      v_fee_minor := public.p2p_release_crypto_btc(p_order_id, 'dispute_release');
      UPDATE public.p2p_orders
         SET status = 'completed', fee_minor = v_fee_minor,
             completed_at = now(), updated_at = now()
       WHERE id = p_order_id
       RETURNING * INTO v_order;
      -- After the status lands, so this trade counts in the
      -- seller's median release time (§3.4).
      PERFORM public.p2p_apply_completion(p_order_id);
    ELSE
      PERFORM public.p2p_unlock_crypto_btc(p_order_id, 'dispute_refund');
      UPDATE public.p2p_orders
         SET status = 'refunded', updated_at = now()
       WHERE id = p_order_id
       RETURNING * INTO v_order;
    END IF;
  END IF;

  UPDATE public.p2p_disputes
     SET status = p_final_status,
         closed_via = p_closed_via,
         ruled_at = now(),
         updated_at = now()
   WHERE id = p_dispute_id
   RETURNING * INTO v_dispute;

  -- Reputation consequences (§3.4): a ruling names a winner and
  -- a loser; a negotiated closure names neither (both agreed).
  IF p_apply_counters THEN
    PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
    PERFORM public.p2p_ensure_profile(v_order.crypto_seller_id);
    IF p_outcome = 'release_to_buyer' THEN
      UPDATE public.p2p_trader_profiles
         SET disputes_won = disputes_won + 1, updated_at = now()
       WHERE user_id = v_order.fiat_buyer_id;
      UPDATE public.p2p_trader_profiles
         SET disputes_lost = disputes_lost + 1, updated_at = now()
       WHERE user_id = v_order.crypto_seller_id;
    ELSE
      UPDATE public.p2p_trader_profiles
         SET disputes_won = disputes_won + 1, updated_at = now()
       WHERE user_id = v_order.crypto_seller_id;
      UPDATE public.p2p_trader_profiles
         SET disputes_lost = disputes_lost + 1, updated_at = now()
       WHERE user_id = v_order.fiat_buyer_id;
    END IF;
  END IF;

  v_event := CASE
               WHEN p_closed_via = 'admin' AND p_outcome = 'release_to_buyer' THEN 'dispute_ruled_release'
               WHEN p_closed_via = 'admin' THEN 'dispute_ruled_refund'
               WHEN p_outcome = 'release_to_buyer' THEN 'dispute_closed_release'
               ELSE 'dispute_closed_refund'
             END;

  v_settled := jsonb_build_object('order', to_jsonb(v_order), 'dispute', to_jsonb(v_dispute),
                                  'fee_minor', v_fee_minor);

  PERFORM public.p2p_write_audit(p_order_id, p_actor_id, p_actor_type, v_event,
    jsonb_build_object('dispute_id', p_dispute_id, 'outcome', p_outcome,
                       'fee_minor', v_fee_minor, 'affects_escrow', v_dispute.affects_escrow,
                       'idempotency_key', p_idempotency_key, 'result', v_settled));
  PERFORM public.p2p_system_message(p_order_id,
    CASE WHEN p_outcome = 'release_to_buyer'
         THEN 'Dispute resolved: the Bitcoin has been released to the buyer.'
         ELSE 'Dispute resolved: the Bitcoin has been returned to the seller.'
    END);

  RETURN v_settled;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM authenticated;

-- 6.8 p2p_open_dispute — instant and total freeze (§3.6). Who /
-- when: the fiat buyer from ESCROW_LOCKED only for
-- seller_unresponsive_pre_payment (auto-resolution = cancel —
-- §3.6); either party from PAID_MARKED; payment_reversed from
-- COMPLETED (finding 11). Opening suspends > K500 orders for
-- both parties (enforced in p2p_create_order) and starts the
-- 10-minute negotiation window + the SLA clock.
CREATE OR REPLACE FUNCTION public.p2p_open_dispute(
  p_caller_id uuid,
  p_order_id uuid,
  p_reason text,
  p_detail text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_existing public.p2p_disputes%ROWTYPE;
  v_dispute public.p2p_disputes%ROWTYPE;
  v_result jsonb;
  v_sla_hours integer := 72;
  v_subject uuid;
  v_open_against_subject integer := 0;
BEGIN
  IF p_reason NOT IN ('paid_not_received', 'amount_mismatch', 'third_party_payment',
                      'seller_unresponsive', 'buyer_unresponsive_after_paid',
                      'seller_unresponsive_pre_payment', 'payment_reversed', 'other') THEN
    RAISE EXCEPTION 'Invalid dispute reason: %', p_reason;
  END IF;
  IF p_reason = 'other' AND NULLIF(btrim(COALESCE(p_detail, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Describe the problem so the support team can help';
  END IF;

  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  IF p_caller_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
    RAISE EXCEPTION 'Only a party to this order can open a dispute on it';
  END IF;

  SELECT * INTO v_existing
    FROM public.p2p_disputes
   WHERE order_id = p_order_id;
  IF FOUND THEN
    IF v_existing.status = 'open' THEN
      RETURN jsonb_build_object('success', true, 'replayed', true,
                                'dispute', to_jsonb(v_existing));
    END IF;
    RAISE EXCEPTION 'A dispute on this order has already been resolved';
  END IF;

  -- Buyer pre-payment non-response (§3.6): the one dispute that
  -- can open from ESCROW_LOCKED, and it auto-resolves as a
  -- cancel — there is nothing to rule on, the buyer simply
  -- should not have to wait out the window.
  IF v_order.status = 'escrow_locked' THEN
    IF p_caller_id = v_order.fiat_buyer_id
       AND p_reason = 'seller_unresponsive_pre_payment' THEN
      PERFORM public.p2p_unlock_crypto_btc(p_order_id, 'cancel');
      PERFORM public.p2p_ensure_profile(v_order.taker_id);
      UPDATE public.p2p_trader_profiles
         SET orders_cancelled_unpaid = orders_cancelled_unpaid + 1, updated_at = now()
       WHERE user_id = v_order.taker_id;
      UPDATE public.p2p_orders
         SET status = 'cancelled_unpaid',
             cancel_reason = 'seller_unresponsive_pre_payment',
             cancelled_at = now(), updated_at = now()
       WHERE id = p_order_id
       RETURNING * INTO v_order;
      v_result := jsonb_build_object('success', true, 'auto_resolved', 'cancelled_unpaid',
                                     'order', to_jsonb(v_order));
      PERFORM public.p2p_write_audit(p_order_id, p_caller_id, 'user', 'dispute_opened',
        jsonb_build_object('reason', p_reason, 'auto_resolved', 'cancelled_unpaid',
                           'idempotency_key', p_idempotency_key, 'result', v_result));
      PERFORM public.p2p_write_audit(p_order_id, p_caller_id, 'user', 'cancelled',
        jsonb_build_object('reason', p_reason, 'final_status', 'cancelled_unpaid'));
      PERFORM public.p2p_system_message(p_order_id,
        'Order cancelled before payment — the escrowed Bitcoin has been returned to the seller.');
      RETURN v_result;
    END IF;
    RAISE EXCEPTION 'A dispute cannot be opened before the buyer has marked payment — if you are the seller, disputes open once payment is marked; if you are the buyer and have not paid, simply cancel';
  END IF;

  -- Post-completion payment_reversed (finding 11): recorded for
  -- the sanctions/investigation flow; the order stays terminal
  -- and NO escrow is affected — the crypto cannot move.
  IF v_order.status = 'completed' THEN
    IF p_reason <> 'payment_reversed' THEN
      RAISE EXCEPTION 'This trade is complete — only a payment-reversal claim can be opened on it';
    END IF;
    SELECT COALESCE(s.p2p_dispute_sla_hours, 72) INTO v_sla_hours
      FROM public.platform_settings s WHERE s.id;
    INSERT INTO public.p2p_disputes (
      order_id, opened_by, reason, detail, affects_escrow,
      negotiation_ends_at, sla_due_at
    ) VALUES (
      p_order_id, p_caller_id, p_reason, p_detail, false,
      now() + interval '10 minutes',
      now() + make_interval(hours => COALESCE(v_sla_hours, 72))
    )
    RETURNING * INTO v_dispute;
    PERFORM public.p2p_ensure_profile(p_caller_id);
    UPDATE public.p2p_trader_profiles
       SET disputes_opened = disputes_opened + 1, updated_at = now()
     WHERE user_id = p_caller_id;
    v_result := jsonb_build_object('success', true, 'dispute', to_jsonb(v_dispute));
    PERFORM public.p2p_write_audit(p_order_id, p_caller_id, 'user', 'dispute_opened',
      jsonb_build_object('dispute_id', v_dispute.id, 'reason', p_reason,
                         'affects_escrow', false,
                         'idempotency_key', p_idempotency_key, 'result', v_result));
    PERFORM public.p2p_write_risk(
      CASE WHEN p_caller_id = v_order.crypto_seller_id
           THEN v_order.fiat_buyer_id ELSE v_order.crypto_seller_id END,
      p_caller_id, p_order_id, 'payment_reversed_claim', 25,
      jsonb_build_object('dispute_id', v_dispute.id));
    RETURN v_result;
  END IF;

  IF v_order.status <> 'paid_marked' THEN
    RAISE EXCEPTION 'A dispute cannot be opened on an order in its current state';
  END IF;

  -- The freeze: order -> DISPUTED. The hold stays 'locked'
  -- (§4.1) — release, cancel and expire all refuse a disputed
  -- order (§3.1 rule 3); only a ruling or a negotiated closure
  -- confirmed by the non-filer exits this state.
  UPDATE public.p2p_orders
     SET status = 'disputed', updated_at = now()
   WHERE id = p_order_id
   RETURNING * INTO v_order;

  SELECT COALESCE(s.p2p_dispute_sla_hours, 72) INTO v_sla_hours
    FROM public.platform_settings s WHERE s.id;

  INSERT INTO public.p2p_disputes (
    order_id, opened_by, reason, detail, affects_escrow,
    negotiation_ends_at, sla_due_at
  ) VALUES (
    p_order_id, p_caller_id, p_reason, p_detail, true,
    now() + interval '10 minutes',
    now() + make_interval(hours => COALESCE(v_sla_hours, 72))
  )
  RETURNING * INTO v_dispute;

  PERFORM public.p2p_ensure_profile(p_caller_id);
  UPDATE public.p2p_trader_profiles
     SET disputes_opened = disputes_opened + 1, updated_at = now()
   WHERE user_id = p_caller_id;

  v_result := jsonb_build_object('success', true, 'dispute', to_jsonb(v_dispute),
                                 'order', to_jsonb(v_order));

  PERFORM public.p2p_write_audit(p_order_id, p_caller_id, 'user', 'dispute_opened',
    jsonb_build_object('dispute_id', v_dispute.id, 'reason', p_reason,
                       'affects_escrow', true,
                       'idempotency_key', p_idempotency_key, 'result', v_result));
  PERFORM public.p2p_system_message(p_order_id,
    'A dispute has been opened. The escrowed Bitcoin is FROZEN — it cannot be released, cancelled or expired while the dispute is open. You have 10 minutes to settle between yourselves in this chat; after that, the support team reviews the evidence and rules. A chat screenshot is not proof of payment — evidence means the MoMo/bank transaction record.');

  -- Appeal-abuse tariff (§3.9 amendment (c)): > 5 simultaneous
  -- open appeals against one advertiser's ads shuts the ads and
  -- pauses the advertiser pending admin review.
  v_subject := CASE WHEN p_caller_id = v_order.advertiser_id
                    THEN v_order.taker_id ELSE v_order.advertiser_id END;
  IF v_subject = v_order.advertiser_id THEN
    SELECT COUNT(*) INTO v_open_against_subject
      FROM public.p2p_disputes d
      JOIN public.p2p_orders o ON o.id = d.order_id
     WHERE d.status = 'open'
       AND o.advertiser_id = v_subject;
    IF v_open_against_subject > 5 THEN
      UPDATE public.p2p_ads
         SET status = 'paused', updated_at = now()
       WHERE owner_id = v_subject AND status = 'active';
      PERFORM public.p2p_apply_sanction(v_subject, 'p2p', 1, 'appeal_abuse_threshold',
        'More than 5 open appeals against this advertiser''s ads — ads paused pending admin review',
        'system', interval '7 days');
      PERFORM public.p2p_write_risk(v_subject, NULL, NULL, 'appeal_abuse_threshold', 40,
        jsonb_build_object('open_disputes', v_open_against_subject));
      PERFORM public.p2p_write_audit(NULL, NULL, 'system', 'sanction_applied',
        jsonb_build_object('user_id', v_subject, 'level', 1,
                           'reason_code', 'appeal_abuse_threshold'));
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) TO service_role;

-- 6.9 p2p_add_dispute_evidence — add-only (§3.6): a party can
-- add, never edit or delete (the table has no client write path
-- and no update exists anywhere).
CREATE OR REPLACE FUNCTION public.p2p_add_dispute_evidence(
  p_caller_id uuid,
  p_dispute_id uuid,
  p_kind text,
  p_body text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_file_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.p2p_disputes%ROWTYPE;
  v_order public.p2p_orders%ROWTYPE;
  v_evidence public.p2p_dispute_evidence%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('statement', 'file') THEN
    RAISE EXCEPTION 'Invalid evidence kind: %', p_kind;
  END IF;
  IF p_kind = 'statement' AND NULLIF(btrim(COALESCE(p_body, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A statement cannot be empty';
  END IF;
  IF p_kind = 'file' AND NULLIF(btrim(COALESCE(p_storage_path, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A file evidence item needs its storage path';
  END IF;

  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already closed';
  END IF;

  SELECT * INTO v_order FROM public.p2p_orders WHERE id = v_dispute.order_id;
  IF p_caller_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
    RAISE EXCEPTION 'Only a party to this dispute can add evidence';
  END IF;

  INSERT INTO public.p2p_dispute_evidence (dispute_id, submitter_id, kind, body, storage_path, file_hash)
  VALUES (p_dispute_id, p_caller_id, p_kind, p_body, p_storage_path, p_file_hash)
  RETURNING * INTO v_evidence;

  PERFORM public.p2p_write_audit(v_dispute.order_id, p_caller_id, 'user', 'dispute_evidence_added',
    jsonb_build_object('dispute_id', p_dispute_id, 'evidence_id', v_evidence.id, 'kind', p_kind));

  RETURN jsonb_build_object('success', true, 'evidence', to_jsonb(v_evidence));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_add_dispute_evidence(uuid, uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_add_dispute_evidence(uuid, uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_add_dispute_evidence(uuid, uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_add_dispute_evidence(uuid, uuid, text, text, text, text) TO service_role;

-- 6.10 Negotiated closure (§3.6 amendment; header finding 10):
-- the FILER proposes an outcome; the NON-FILING party confirms;
-- only then does the escrow move. The filer can never withdraw
-- unilaterally — that is the counter to talking a victim into
-- closing an appeal on a promise.
CREATE OR REPLACE FUNCTION public.p2p_propose_dispute_closure(
  p_caller_id uuid,
  p_dispute_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.p2p_disputes%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('release_to_buyer', 'refund_to_seller') THEN
    RAISE EXCEPTION 'Invalid closure outcome: %', p_outcome;
  END IF;

  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already closed';
  END IF;
  IF p_caller_id <> v_dispute.opened_by THEN
    RAISE EXCEPTION 'Only the person who opened this dispute can propose a settlement';
  END IF;

  UPDATE public.p2p_disputes
     SET proposed_outcome = p_outcome,
         proposed_by = p_caller_id,
         proposed_at = now(),
         updated_at = now()
   WHERE id = p_dispute_id
   RETURNING * INTO v_dispute;

  PERFORM public.p2p_write_audit(v_dispute.order_id, p_caller_id, 'user',
    'dispute_closure_proposed',
    jsonb_build_object('dispute_id', p_dispute_id, 'outcome', p_outcome));
  PERFORM public.p2p_system_message(v_dispute.order_id,
    'A settlement has been proposed. It takes effect ONLY if the other party confirms it — nobody can close this dispute alone.');

  RETURN jsonb_build_object('success', true, 'dispute', to_jsonb(v_dispute));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_propose_dispute_closure(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_propose_dispute_closure(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_propose_dispute_closure(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_propose_dispute_closure(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_confirm_dispute_closure(
  p_caller_id uuid,
  p_dispute_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.p2p_disputes%ROWTYPE;
  v_order public.p2p_orders%ROWTYPE;
  v_settled jsonb;
BEGIN
  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already closed';
  END IF;
  IF v_dispute.proposed_outcome IS NULL THEN
    RAISE EXCEPTION 'No settlement has been proposed yet';
  END IF;

  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = v_dispute.order_id
   FOR UPDATE;

  IF p_caller_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
    RAISE EXCEPTION 'Only a party to this dispute can confirm a settlement';
  END IF;
  IF p_caller_id = v_dispute.proposed_by THEN
    RAISE EXCEPTION 'The person who proposed the settlement cannot confirm it — the other party must confirm';
  END IF;

  v_settled := public.p2p_execute_dispute_outcome(
    v_dispute.order_id, p_dispute_id, v_dispute.proposed_outcome,
    CASE WHEN v_dispute.proposed_outcome = 'release_to_buyer'
         THEN 'negotiated_release' ELSE 'negotiated_refund' END,
    'negotiated', p_caller_id, 'user', false);

  RETURN jsonb_build_object('success', true,
                            'order', v_settled -> 'order',
                            'dispute', v_settled -> 'dispute',
                            'fee_minor', v_settled -> 'fee_minor');
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_confirm_dispute_closure(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_confirm_dispute_closure(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_confirm_dispute_closure(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_confirm_dispute_closure(uuid, uuid) TO service_role;

-- 6.11 p2p_resolve_dispute — the admin ruling (§3.6, §4.2).
-- Admin is verified INSIDE via has_role: the caller is the
-- service role (which bypasses RLS), so the admin identity is a
-- parameter and the role check happens here, in the database,
-- not in a client. The ruling, the escrow move, the reputation
-- consequences and any sanction land in ONE transaction. Split
-- outcomes do not exist (§3.6).
CREATE OR REPLACE FUNCTION public.p2p_resolve_dispute(
  p_admin_id uuid,
  p_dispute_id uuid,
  p_outcome text,
  p_notes text,
  p_sanction_level integer DEFAULT NULL,
  p_sanction_reason_code text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispute public.p2p_disputes%ROWTYPE;
  v_order public.p2p_orders%ROWTYPE;
  v_settled jsonb;
  v_replay jsonb;
  v_loser uuid;
  v_sanction_id uuid;
BEGIN
  IF NOT public.has_role(p_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can rule on a dispute';
  END IF;
  IF p_outcome NOT IN ('release_to_buyer', 'refund_to_seller') THEN
    RAISE EXCEPTION 'Invalid ruling outcome: %', p_outcome;
  END IF;
  IF NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Ruling notes are required — state the documentary record the decision rests on';
  END IF;
  IF p_sanction_level IS NOT NULL AND (p_sanction_level < 0 OR p_sanction_level > 4) THEN
    RAISE EXCEPTION 'Invalid sanction level: %', p_sanction_level;
  END IF;

  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;

  IF v_dispute.status <> 'open' THEN
    v_replay := public.p2p_idem_replay(v_dispute.order_id,
      CASE WHEN v_dispute.status = 'ruled_release'
           THEN 'dispute_ruled_release' ELSE 'dispute_ruled_refund' END,
      p_idempotency_key);
    IF v_replay IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'replayed', true) || v_replay;
    END IF;
    RAISE EXCEPTION 'This dispute has already been ruled';
  END IF;

  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = v_dispute.order_id
   FOR UPDATE;

  v_settled := public.p2p_execute_dispute_outcome(
    v_dispute.order_id, p_dispute_id, p_outcome,
    CASE WHEN p_outcome = 'release_to_buyer' THEN 'ruled_release' ELSE 'ruled_refund' END,
    'admin', p_admin_id, 'admin', true, p_idempotency_key);

  UPDATE public.p2p_disputes
     SET ruled_by = p_admin_id,
         ruling_notes = p_notes,
         updated_at = now()
   WHERE id = p_dispute_id
   RETURNING * INTO v_dispute;

  -- Optional linked sanction (§3.9): applied to the LOSER of the
  -- ruling. Rungs 2+ are human decisions — this is one. The
  -- OKX tariff for a proven non-real-name payment (minimum
  -- 15-day suspension) is a level-1/2 ruling made here.
  IF p_sanction_level IS NOT NULL AND p_sanction_level > 0 THEN
    v_loser := CASE WHEN p_outcome = 'release_to_buyer'
                    THEN v_order.crypto_seller_id ELSE v_order.fiat_buyer_id END;
    v_sanction_id := public.p2p_apply_sanction(
      v_loser, 'p2p', p_sanction_level,
      COALESCE(NULLIF(btrim(COALESCE(p_sanction_reason_code, '')), ''), 'dispute_ruling'),
      p_notes, p_admin_id::text,
      CASE p_sanction_level
        WHEN 1 THEN interval '7 days'
        WHEN 2 THEN interval '90 days'
        ELSE NULL
      END);
    PERFORM public.p2p_write_audit(v_dispute.order_id, p_admin_id, 'admin', 'sanction_applied',
      jsonb_build_object('dispute_id', p_dispute_id, 'sanction_id', v_sanction_id,
                         'user_id', v_loser, 'level', p_sanction_level));
  END IF;

  RETURN jsonb_build_object('success', true,
                            'order', v_settled -> 'order',
                            'dispute', to_jsonb(v_dispute),
                            'fee_minor', v_settled -> 'fee_minor',
                            'sanction_id', v_sanction_id);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_resolve_dispute(uuid, uuid, text, text, integer, text, text) TO service_role;

-- 6.12 p2p_expire_orders — the timer (§2.7). Timers can cancel
-- UNPAID orders and flag appealable ones; a timer can NEVER move
-- crypto to a buyer (§3.1 rule 4) and NEVER touches a disputed or
-- paid-marked order's escrow. Called by pg_cron every 5 minutes;
-- safe to call any time (status compare-and-set under row lock).
CREATE OR REPLACE FUNCTION public.p2p_expire_orders()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.p2p_orders%ROWTYPE;
  v_expired integer := 0;
  v_flagged integer := 0;
  v_result jsonb;
BEGIN
  FOR v_order IN
    SELECT * FROM public.p2p_orders
     WHERE status = 'escrow_locked'
       AND expires_at < now()
     ORDER BY expires_at ASC
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM public.p2p_unlock_crypto_btc(v_order.id, 'expire');
    PERFORM public.p2p_ensure_profile(v_order.taker_id);
    UPDATE public.p2p_trader_profiles
       SET orders_expired_unpaid = orders_expired_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.taker_id;
    UPDATE public.p2p_orders
       SET status = 'expired_unpaid',
           cancel_reason = 'payment_window_expired',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_order.id;
    PERFORM public.p2p_write_audit(v_order.id, NULL, 'cron', 'unlocked_expired',
      jsonb_build_object('amount_minor', v_order.crypto_amount_minor));
    PERFORM public.p2p_system_message(v_order.id,
      'This order expired unpaid — the escrowed Bitcoin has been returned to the seller. A payment made now is NOT protected.');
    v_expired := v_expired + 1;
  END LOOP;

  -- Paid-marked orders past the seller window become appealable
  -- (flagged once, with a system message). Nothing moves.
  FOR v_order IN
    SELECT * FROM public.p2p_orders
     WHERE status = 'paid_marked'
       AND seller_deadline_at < now()
       AND appeal_flagged_at IS NULL
     ORDER BY seller_deadline_at ASC
     LIMIT 200
     FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.p2p_orders
       SET appeal_flagged_at = now(), updated_at = now()
     WHERE id = v_order.id;
    PERFORM public.p2p_write_audit(v_order.id, NULL, 'cron', 'seller_window_lapsed',
      jsonb_build_object('seller_deadline_at', v_order.seller_deadline_at));
    PERFORM public.p2p_system_message(v_order.id,
      'The seller''s response window has passed. Buyer: if you paid and the Bitcoin has not been released, open a dispute now — the escrow stays frozen until an admin rules.');
    v_flagged := v_flagged + 1;
  END LOOP;

  v_result := jsonb_build_object('success', true,
                                 'expired_count', v_expired,
                                 'appeal_flagged_count', v_flagged);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_expire_orders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_expire_orders() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_expire_orders() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_expire_orders() TO service_role;

-- 6.13 Blocks & reports (§3.4). Blocking prevents orders between
-- the pair (checked in p2p_create_order) and is counted (never
-- attributed) in the subject's risk picture.
CREATE OR REPLACE FUNCTION public.p2p_block_user(
  p_blocker_id uuid,
  p_blocked_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_block public.p2p_blocks%ROWTYPE;
BEGIN
  IF p_blocker_id = p_blocked_id THEN
    RAISE EXCEPTION 'You cannot block yourself';
  END IF;

  INSERT INTO public.p2p_blocks (blocker_id, blocked_id, reason)
  VALUES (p_blocker_id, p_blocked_id, p_reason)
  ON CONFLICT (blocker_id, blocked_id) DO NOTHING
  RETURNING * INTO v_block;

  IF NOT FOUND THEN
    SELECT * INTO v_block
      FROM public.p2p_blocks
     WHERE blocker_id = p_blocker_id AND blocked_id = p_blocked_id;
  END IF;

  PERFORM public.p2p_write_audit(NULL, p_blocker_id, 'user', 'user_blocked',
    jsonb_build_object('blocked_id', p_blocked_id));
  PERFORM public.p2p_write_risk(p_blocked_id, p_blocker_id, NULL, 'block_received', 2,
    jsonb_build_object('block_id', v_block.id));

  RETURN jsonb_build_object('success', true, 'block', to_jsonb(v_block));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_block_user(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_block_user(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_block_user(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_block_user(uuid, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_unblock_user(
  p_blocker_id uuid,
  p_blocked_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.p2p_blocks
   WHERE blocker_id = p_blocker_id AND blocked_id = p_blocked_id;

  PERFORM public.p2p_write_audit(NULL, p_blocker_id, 'user', 'user_unblocked',
    jsonb_build_object('blocked_id', p_blocked_id));

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_unblock_user(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_unblock_user(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_unblock_user(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_unblock_user(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_report_user(
  p_reporter_id uuid,
  p_subject_id uuid,
  p_category text,
  p_order_id uuid DEFAULT NULL,
  p_detail text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report public.p2p_reports%ROWTYPE;
  v_order public.p2p_orders%ROWTYPE;
BEGIN
  IF p_category NOT IN ('scam_attempt', 'off_platform_solicitation', 'fake_proof',
                        'abusive_behaviour', 'other') THEN
    RAISE EXCEPTION 'Invalid report category: %', p_category;
  END IF;
  IF p_reporter_id = p_subject_id THEN
    RAISE EXCEPTION 'You cannot report yourself';
  END IF;
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.p2p_orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Order not found';
    END IF;
    IF p_reporter_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
      RAISE EXCEPTION 'You can only attach orders you are part of to a report';
    END IF;
    IF p_subject_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
      RAISE EXCEPTION 'The reported user is not part of that order';
    END IF;
  END IF;

  INSERT INTO public.p2p_reports (reporter_id, subject_id, category, order_id, detail)
  VALUES (p_reporter_id, p_subject_id, p_category, p_order_id, p_detail)
  RETURNING * INTO v_report;

  PERFORM public.p2p_write_audit(p_order_id, p_reporter_id, 'user', 'user_reported',
    jsonb_build_object('report_id', v_report.id, 'subject_id', p_subject_id,
                       'category', p_category));
  PERFORM public.p2p_write_risk(p_subject_id, p_reporter_id, p_order_id, 'user_report', 5,
    jsonb_build_object('report_id', v_report.id, 'category', p_category));

  RETURN jsonb_build_object('success', true, 'report', to_jsonb(v_report));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_report_user(uuid, uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_report_user(uuid, uuid, text, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_report_user(uuid, uuid, text, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_report_user(uuid, uuid, text, uuid, text) TO service_role;

-- ---------------------------------------------------------------------
-- 7. Reconciliation, T+1 maturation, and the timers (§4.2, §2.7)
-- ---------------------------------------------------------------------

-- 7.1 p2p_reconcile_escrow — the invariant (§4.2): the sats in
-- locked holds must equal the sats users cannot spend because of
-- P2P. A BTC lock moves available only, and every other wallet
-- operation (deposits, trades, withdrawal reserve/fail) moves
-- balance and available together, so across all BTC wallets
-- SUM(balance_sats - available_sats) is exactly the P2P-locked
-- total; any drift means escrow accounting is broken and ops get
-- paged (the hourly cron below logs every run to the audit log).
-- Also flags orphan holds (locked against a terminal order) and
-- open orders with no locked hold — both must always be zero.
CREATE OR REPLACE FUNCTION public.p2p_reconcile_escrow()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked_sum bigint := 0;
  v_locked_count integer := 0;
  v_wallet_gap bigint := 0;
  v_orphans integer := 0;
  v_missing integer := 0;
  v_report jsonb;
BEGIN
  SELECT COALESCE(SUM(h.amount_minor), 0), COUNT(*)
    INTO v_locked_sum, v_locked_count
    FROM public.p2p_escrow_holds h
   WHERE h.status = 'locked' AND h.asset = 'BTC';

  SELECT COALESCE(SUM(c.balance_sats - c.available_sats), 0)
    INTO v_wallet_gap
    FROM public.crypto_wallets c
   WHERE c.asset = 'BTC';

  SELECT COUNT(*) INTO v_orphans
    FROM public.p2p_escrow_holds h
    JOIN public.p2p_orders o ON o.id = h.order_id
   WHERE h.status = 'locked'
     AND o.status IN ('completed', 'refunded', 'cancelled_unpaid', 'expired_unpaid');

  SELECT COUNT(*) INTO v_missing
    FROM public.p2p_orders o
    LEFT JOIN public.p2p_escrow_holds h
      ON h.order_id = o.id AND h.status = 'locked'
   WHERE o.status IN ('escrow_locked', 'paid_marked', 'disputed')
     AND h.id IS NULL;

  v_report := jsonb_build_object(
    'asset', 'BTC',
    'locked_holds_sats', v_locked_sum,
    'locked_hold_count', v_locked_count,
    'wallet_gap_sats', v_wallet_gap,
    'drift_sats', v_wallet_gap - v_locked_sum,
    'orphan_holds', v_orphans,
    'open_orders_without_locked_hold', v_missing,
    'reconciled_at', now());

  PERFORM public.p2p_write_audit(NULL, NULL, 'system', 'escrow_reconciled', v_report);

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_reconcile_escrow() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_reconcile_escrow() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_reconcile_escrow() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_reconcile_escrow() TO service_role;

-- 7.2 p2p_mature_withdrawal_holds — the T+1 sibling cron (§3.8
-- amendment): flips matured hold rows. Balances do not move (the
-- credit was available for internal use from the moment of
-- release; maturity only lifts the on-chain-withdrawal hold —
-- header finding 5).
CREATE OR REPLACE FUNCTION public.p2p_mature_withdrawal_holds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH matured AS (
    UPDATE public.p2p_withdrawal_holds
       SET status = 'matured', matured_at = now()
     WHERE status = 'held'
       AND matures_at <= now()
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM matured;

  IF v_count > 0 THEN
    PERFORM public.p2p_write_audit(NULL, NULL, 'cron', 'withdrawal_holds_matured',
      jsonb_build_object('matured_count', v_count));
  END IF;

  RETURN jsonb_build_object('success', true, 'matured_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_mature_withdrawal_holds() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_mature_withdrawal_holds() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_mature_withdrawal_holds() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_mature_withdrawal_holds() TO service_role;

-- 7.3 p2p_unmatured_withdrawal_hold_sats — the ONE function the
-- on-chain withdrawal path consults for the T+1 rule (finding
-- 5): withdrawable = available_sats - btc_withdrawals in flight
-- - this. Granted to service_role because the withdrawal path is
-- a service-role caller (btc-onchain edge function).
CREATE OR REPLACE FUNCTION public.p2p_unmatured_withdrawal_hold_sats(p_user_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(h.amount_minor), 0)::bigint
    FROM public.p2p_withdrawal_holds h
   WHERE h.user_id = p_user_id
     AND h.status = 'held'
     AND h.matures_at > now();
$$;

REVOKE ALL ON FUNCTION public.p2p_unmatured_withdrawal_hold_sats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_unmatured_withdrawal_hold_sats(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_unmatured_withdrawal_hold_sats(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_unmatured_withdrawal_hold_sats(uuid) TO service_role;

-- 7.4 pg_cron schedules (§2.7): expiry every 5 minutes (the
-- scope's timer), withdrawal-hold maturation every 15 minutes,
-- reconciliation hourly. Same idempotent pattern as the
-- platform's existing cron migrations: unschedule first if the
-- job exists, so re-running this migration is safe. These call
-- SQL functions directly — no HTTP, no secrets in the schedule.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-expire-orders') THEN
    PERFORM cron.unschedule('p2p-expire-orders');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-mature-withdrawal-holds') THEN
    PERFORM cron.unschedule('p2p-mature-withdrawal-holds');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'p2p-reconcile-escrow') THEN
    PERFORM cron.unschedule('p2p-reconcile-escrow');
  END IF;
END $$;

SELECT cron.schedule(
  'p2p-expire-orders',
  '*/5 * * * *',
  $$SELECT public.p2p_expire_orders();$$);

SELECT cron.schedule(
  'p2p-mature-withdrawal-holds',
  '*/15 * * * *',
  $$SELECT public.p2p_mature_withdrawal_holds();$$);

SELECT cron.schedule(
  'p2p-reconcile-escrow',
  '15 * * * *',
  $$SELECT public.p2p_reconcile_escrow();$$);
