-- =====================================================================
-- 20261102_delta_audit_remediation.sql
--
-- Remediation for the shipped-delta security audit of 2026-10-23
-- (report: goals/bmaglass-pay-completion-sweep/hidden_files/
-- security-audit-delta-2026-10-23.md — 0 P0, 0 P1, 10 P2, 16 P3;
-- this migration + the accompanying edge/shared-module changes
-- close the P2 set and the named P3 items D6–D10, D13, E6, E7).
--
-- Finding map (DB side):
--   D1  p2p_create_order takes per-user advisory xact locks for
--       BOTH parties (sorted, deterministic) before any limit read,
--       so a concurrent burst cannot pass the read-then-act caps in
--       two transactions at once.
--   D3  p2p_order_messages: the direct client INSERT path is closed
--       (policy dropped, INSERT grant revoked). Chat writes flow
--       ONLY through the p2p edge function (service role), which is
--       the path the 1c UI already uses; reads are untouched. No
--       participant can set created_at / scan_flags or post into
--       any order outside the scanned edge path.
--   D4  user_sanctions / p2p_reviews: admin FOR ALL policies and
--       write grants removed (SELECT kept for users-own + admins).
--       Sanction/review administration runs through audited RPCs;
--       p2p_apply_sanction now writes its own p2p_audit_log row so
--       no caller can skip the record. New p2p_resolve_review is
--       the audited clear path for the re-review queue.
--   D5  Unpaid cancel/expire counters are charged to fiat_buyer_id
--       (the party who did not pay) in cancel, dispute auto-cancel
--       and the expiry cron — never to a bystander taker.
--   D6  Party/actor checks run ABOVE the idempotent-replay branches
--       in cancel / mark-paid / confirm-release: a stored outcome
--       is visible only to a party to the order.
--   D7  p2p_execute_dispute_outcome guards itself: order + dispute
--       locked, existence, dispute<->order linkage, dispute still
--       open, outcome whitelisted (an unknown outcome can no longer
--       default into the refund branch); the system message no
--       longer claims Bitcoin moved when affects_escrow = false.
--   D8  POS: the expiry rule lives inside pos_apply_deposit_match
--       (a request past expiry at credit time never matches), match
--       failures persist to pos_match_failures, and
--       pos_retry_match_failures sweeps them every 5 minutes. The
--       deposit trigger stays exception-swallowed end to end.
--   D9  platform_settings.p2p_fee_percent gets CHECK (0..100), and
--       p2p_release_crypto_btc asserts the range before fee maths.
--   D10 p2p_apply_sanction / p2p_revoke_sanction take the acting
--       admin's id and verify has_role INSIDE the database. A NULL
--       admin id on apply is the trusted system path only (the
--       function is service-role-only; automation rungs 0/1);
--       revoke is human-only and refuses without a verified admin.
--   D13 unique_violation on the payment-claim and payment-method
--       inserts is caught and converted to the designed refusal /
--       risk-event path — never a raw error.
--
-- NOT touched: D2 (T+1 hold semantics — CEO decision, Binance-style
-- per-user hold at on-chain withdrawal), D11/D12, E8–E11, C1/C2.
--
-- ACL discipline is unchanged: every callable below stays
-- service_role-only (triple revoke + grant re-asserted; the two
-- signature changes DROP + CREATE and re-assert the full block).
-- =====================================================================

-- ── D9: bound the P2P fee percent at the schema ─────────────────
-- The live value is 0.5, inside the range; the constraint makes an
-- out-of-range value unwritable from any path (console included).
ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_p2p_fee_percent_range
  CHECK (p2p_fee_percent BETWEEN 0 AND 100);

-- ── D3: trade chat writes flow only through the edge ────────────
-- Verified before closing: the 1c client only SELECTs from
-- p2p_order_messages (fetchOrderMessages) and sends exclusively via
-- the p2p edge function's send_message action, which scans, masks,
-- stamps scan_flags/created_at itself and enforces the chat window
-- and order state. With the policy gone and the grant revoked, a
-- direct PostgREST insert is refused outright — created_at and
-- scan_flags can no longer be forged, and no unscanned body can be
-- planted into a live or closed order. SELECT policies/grants are
-- unchanged, so participant and admin reads keep working.
DROP POLICY IF EXISTS "Order participants can send trade messages" ON public.p2p_order_messages;
REVOKE INSERT ON TABLE public.p2p_order_messages FROM authenticated;

-- ── D4: sanctions and reviews — no direct admin writes ──────────
-- The FOR ALL policies and write grants are removed. Admins keep
-- SELECT (the console lists sanctions/reviews through RLS); every
-- write runs through the audited RPCs (apply/revoke below, the new
-- resolve_review). The sanctions history becomes append-only in
-- practice: no DELETE path remains for any client role.
DROP POLICY IF EXISTS "Admins can manage sanctions" ON public.user_sanctions;
DROP POLICY IF EXISTS "Admins can view all sanctions" ON public.user_sanctions;
CREATE POLICY "Admins can view all sanctions"
  ON public.user_sanctions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_sanctions FROM authenticated;

DROP POLICY IF EXISTS "Admins can manage P2P reviews" ON public.p2p_reviews;
DROP POLICY IF EXISTS "Admins can view P2P reviews" ON public.p2p_reviews;
CREATE POLICY "Admins can view P2P reviews"
  ON public.p2p_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE INSERT, UPDATE, DELETE ON TABLE public.p2p_reviews FROM authenticated;

-- ── D4 + D10: sanction RPCs verify the acting admin in-DB ───────
-- Signature changes (p_admin_id appended), so the old signatures
-- are dropped and the full ACL block re-asserted. Existing
-- positional callers with the old arity (the §6.8 appeal-abuse
-- tariff and the edge strike pipeline's system calls) still
-- resolve: p_admin_id defaults NULL, which is the trusted system
-- path — reachable only because EXECUTE is service-role-only and
-- the internal callers are themselves SECURITY DEFINER.
DROP FUNCTION IF EXISTS public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval);
DROP FUNCTION IF EXISTS public.p2p_revoke_sanction(uuid);

CREATE OR REPLACE FUNCTION public.p2p_apply_sanction(
  p_user_id uuid,
  p_scope text,
  p_level integer,
  p_reason_code text,
  p_detail text,
  p_applied_by text,
  p_duration interval DEFAULT NULL,
  p_admin_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_scope NOT IN ('p2p', 'platform') THEN
    RAISE EXCEPTION 'Invalid sanction scope: %', p_scope;
  END IF;
  IF p_level < 0 OR p_level > 4 THEN
    RAISE EXCEPTION 'Invalid sanction level: %', p_level;
  END IF;
  -- Delta-audit D10: a supplied admin identity must be a REAL
  -- admin — verified here, in the database, never trusted from
  -- the caller. NULL means the system path (automation rungs).
  IF p_admin_id IS NOT NULL
     AND NOT public.has_role(p_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can apply a sanction';
  END IF;

  INSERT INTO public.user_sanctions (
    user_id, scope, level, reason_code, detail, applied_by, expires_at
  ) VALUES (
    p_user_id, p_scope, p_level, p_reason_code, p_detail, p_applied_by,
    CASE WHEN p_duration IS NULL THEN NULL ELSE now() + p_duration END
  )
  RETURNING id INTO v_id;

  -- Delta-audit D4: the audit row is written HERE, inside the one
  -- function every sanction flows through, so no caller — console,
  -- dispute ruling, or automation — can apply a sanction without
  -- leaving the record.
  PERFORM public.p2p_write_audit(NULL, p_admin_id,
    CASE WHEN p_admin_id IS NULL THEN 'system' ELSE 'admin' END,
    'sanction_applied',
    jsonb_build_object('sanction_id', v_id, 'user_id', p_user_id,
                       'scope', p_scope, 'level', p_level,
                       'reason_code', p_reason_code,
                       'applied_by', p_applied_by));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_revoke_sanction(
  p_sanction_id uuid,
  p_admin_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.user_sanctions%ROWTYPE;
BEGIN
  -- Lifting a sanction is a human decision (delta-audit D10):
  -- there is no system path, and the admin role is verified here.
  IF p_admin_id IS NULL
     OR NOT public.has_role(p_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can revoke a sanction';
  END IF;

  UPDATE public.user_sanctions
     SET status = 'revoked'
   WHERE id = p_sanction_id
     AND status = 'active'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That sanction was not found, or has already been lifted';
  END IF;

  PERFORM public.p2p_write_audit(NULL, p_admin_id, 'admin',
    'sanction_revoked',
    jsonb_build_object('sanction_id', v_row.id, 'user_id', v_row.user_id,
                       'scope', v_row.scope, 'level', v_row.level,
                       'reason_code', v_row.reason_code));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_revoke_sanction(uuid, uuid) TO service_role;

-- p2p_resolve_review (new, D4): the audited clear path for the
-- re-review queue. Reviews are created by the identity-change
-- triggers; clearing one is an admin act and now leaves the same
-- grade of record as a sanction action.
CREATE OR REPLACE FUNCTION public.p2p_resolve_review(
  p_admin_id uuid,
  p_review_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.p2p_reviews%ROWTYPE;
BEGIN
  IF p_admin_id IS NULL
     OR NOT public.has_role(p_admin_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only an admin can clear a review';
  END IF;

  UPDATE public.p2p_reviews
     SET status = 'cleared',
         resolved_at = now()
   WHERE id = p_review_id
     AND status = 'pending'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That review was not found, or has already been cleared';
  END IF;

  PERFORM public.p2p_write_audit(NULL, p_admin_id, 'admin',
    'review_cleared',
    jsonb_build_object('review_id', v_row.id, 'user_id', v_row.user_id,
                       'reason', v_row.reason));
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_resolve_review(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_resolve_review(uuid, uuid) TO service_role;

-- ── D13: payment-method registration race ───────────────────────
CREATE OR REPLACE FUNCTION public.p2p_create_payment_method(
  p_user_id uuid,
  p_type text,
  p_account_number text,
  p_account_name text,
  p_bank_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm text := public.p2p_normalise_account_number(p_account_number);
  v_kyc_name_norm text;
  v_name_match boolean := false;
  v_is_first boolean := false;
  v_row public.p2p_payment_methods%ROWTYPE;
BEGIN
  IF p_type NOT IN ('mobile_money', 'bank') THEN
    RAISE EXCEPTION 'Unsupported payment method type: %', p_type;
  END IF;
  IF v_norm IS NULL OR length(v_norm) < 9 THEN
    RAISE EXCEPTION 'That account number does not look complete — check it and try again';
  END IF;
  IF p_type = 'bank' AND NULLIF(btrim(COALESCE(p_bank_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Bank name is required for a bank account';
  END IF;

  -- Idempotent re-registration of the caller's OWN active account:
  -- return the existing row instead of duplicating it (the partial
  -- unique index would refuse a second active row anyway).
  SELECT * INTO v_row
    FROM public.p2p_payment_methods
   WHERE user_id = p_user_id
     AND account_number_norm = v_norm
     AND status = 'active';
  IF FOUND THEN
    RETURN to_jsonb(v_row);
  END IF;

  -- One payment account, one user (§4.1): an active registration
  -- under another user refuses — this is the anchor that stops a
  -- fraudster re-pointing a victim's MoMo number at themselves.
  IF EXISTS (
    SELECT 1
      FROM public.p2p_payment_methods
     WHERE account_number_norm = v_norm
       AND status = 'active'
       AND user_id <> p_user_id
  ) THEN
    RAISE EXCEPTION 'This payment account is already registered to another user';
  END IF;

  -- Name-match (§2.4): the account name must match the canonical
  -- KYC name; the result is recorded, not assumed — orders later
  -- refuse or flag on verified_name_match = false.
  SELECT k.name_norm
    INTO v_kyc_name_norm
    FROM public.kyc_verifications k
   WHERE k.user_id = p_user_id;

  v_name_match := v_kyc_name_norm IS NOT NULL
                  AND public.p2p_normalise_name(p_account_name) IS NOT NULL
                  AND public.p2p_normalise_name(p_account_name) = v_kyc_name_norm;

  SELECT NOT EXISTS (
           SELECT 1 FROM public.p2p_payment_methods
            WHERE user_id = p_user_id AND status = 'active'
         )
    INTO v_is_first;

  -- Delta-audit D13: the checks above and this insert are not
  -- atomic — a concurrent registration of the same account can win
  -- the race in between. The partial unique index is the backstop;
  -- catching its violation converts the race into the designed
  -- outcomes (idempotent return for the caller's own row, the
  -- crafted refusal for another user's), never a raw error.
  BEGIN
    INSERT INTO public.p2p_payment_methods (
      user_id, type, account_number, account_number_norm, account_name,
      bank_name, is_primary, verified_name_match
    ) VALUES (
      p_user_id, p_type, btrim(p_account_number), v_norm, btrim(p_account_name),
      NULLIF(btrim(COALESCE(p_bank_name, '')), ''), v_is_first, v_name_match
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_row
      FROM public.p2p_payment_methods
     WHERE account_number_norm = v_norm
       AND status = 'active';
    IF FOUND AND v_row.user_id = p_user_id THEN
      RETURN to_jsonb(v_row);
    END IF;
    RAISE EXCEPTION 'This payment account is already registered to another user';
  END;

  -- Identity signal (§3.2): the payment-account fingerprint joins
  -- the anchor set; a hash already held by another user keeps its
  -- first registration (the conflict above already refused the
  -- active duplicate; this covers disabled/removed history).
  INSERT INTO public.p2p_identity_signals (user_id, signal_type, signal_hash)
  VALUES (p_user_id, 'payment_account_hash', encode(extensions.digest(v_norm::bytea, 'sha256'), 'hex'))
  ON CONFLICT (signal_type, signal_hash) DO NOTHING;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_create_payment_method(uuid, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_create_payment_method(uuid, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_create_payment_method(uuid, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_create_payment_method(uuid, text, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_set_payment_method_status(
  p_user_id uuid,
  p_method_id uuid,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.p2p_payment_methods%ROWTYPE;
  v_promote_id uuid;
BEGIN
  IF p_status NOT IN ('active', 'disabled', 'removed') THEN
    RAISE EXCEPTION 'Invalid payment method status: %', p_status;
  END IF;

  SELECT * INTO v_row
    FROM public.p2p_payment_methods
   WHERE id = p_method_id
     AND user_id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment method not found';
  END IF;

  IF p_status = 'active' AND v_row.status <> 'active' THEN
    IF EXISTS (
      SELECT 1
        FROM public.p2p_payment_methods
       WHERE account_number_norm = v_row.account_number_norm
         AND status = 'active'
         AND user_id <> p_user_id
    ) THEN
      RAISE EXCEPTION 'This payment account is already registered to another user';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM public.p2p_payment_methods
       WHERE account_number_norm = v_row.account_number_norm
         AND status = 'active'
         AND user_id = p_user_id
         AND id <> p_method_id
    ) THEN
      RAISE EXCEPTION 'This payment account is already active on your account';
    END IF;
  END IF;

  -- Delta-audit D13: reactivation re-runs the uniqueness anchor
  -- as check-then-act; the same race as registration applies. The
  -- partial unique index backstop is converted to the designed
  -- refusals, never a raw error.
  BEGIN
    UPDATE public.p2p_payment_methods
       SET status = p_status,
           is_primary = CASE WHEN p_status = 'active' THEN is_primary ELSE false END,
           updated_at = now()
     WHERE id = p_method_id
     RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    IF EXISTS (
      SELECT 1
        FROM public.p2p_payment_methods
       WHERE account_number_norm = v_row.account_number_norm
         AND status = 'active'
         AND user_id <> p_user_id
    ) THEN
      RAISE EXCEPTION 'This payment account is already registered to another user';
    END IF;
    RAISE EXCEPTION 'This payment account is already active on your account';
  END;

  -- If that change removed the primary, promote the oldest
  -- remaining active method so the user always has a primary while
  -- they have any active method.
  IF p_status <> 'active' AND NOT EXISTS (
    SELECT 1
      FROM public.p2p_payment_methods
     WHERE user_id = p_user_id
       AND status = 'active'
       AND is_primary
  ) THEN
    SELECT id INTO v_promote_id
      FROM public.p2p_payment_methods
     WHERE user_id = p_user_id
       AND status = 'active'
     ORDER BY created_at ASC
     LIMIT 1;

    IF v_promote_id IS NOT NULL THEN
      UPDATE public.p2p_payment_methods
         SET is_primary = true,
             updated_at = now()
       WHERE id = v_promote_id;
    END IF;
  END IF;

  SELECT * INTO v_row
    FROM public.p2p_payment_methods
   WHERE id = p_method_id;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_set_payment_method_status(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_set_payment_method_status(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_set_payment_method_status(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_set_payment_method_status(uuid, uuid, text) TO service_role;

-- ── D9: fee assert inside the release path ──────────────────────
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

  -- Delta-audit D9: the CHECK on platform_settings makes an
  -- out-of-range fee unwritable; this assert is the second line —
  -- a release must never silently compute from a bad value.
  IF v_fee_percent < 0 OR v_fee_percent > 100 THEN
    RAISE EXCEPTION 'The P2P fee setting is invalid — releases are paused until it is corrected';
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

-- ── D1: p2p_create_order serialises per user pair ───────────────
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
  v_advertiser_id uuid;
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

  -- Delta-audit D1: per-user advisory transaction locks for BOTH
  -- parties, taken in a deterministic (sorted) order BEFORE any
  -- limit is read. The caps below are read-then-act (daily totals,
  -- open-order counts, the pair cap); two concurrent creates for
  -- the same pair could each read "under the cap" and both land.
  -- The ad owner's id is read unlocked solely to key the locks —
  -- ad ownership never changes — and the authoritative FOR UPDATE
  -- read follows immediately. Locks release at transaction end.
  SELECT a.owner_id INTO v_advertiser_id
    FROM public.p2p_ads a
   WHERE a.id = p_ad_id;
  IF FOUND THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'p2p-order-user:' || LEAST(p_taker_id::text, v_advertiser_id::text), 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'p2p-order-user:' || GREATEST(p_taker_id::text, v_advertiser_id::text), 0));
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
    RAISE EXCEPTION 'This ad is priced more than 10%% away from the market price — if you understand and want to continue, confirm the warning and try again';
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

-- ── D5 + D6: p2p_cancel_order ───────────────────────────────────
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

  -- Delta-audit D6: the party check runs BEFORE the replay
  -- branch — a stored outcome belongs to the parties; anyone else
  -- gets the plain refusal and learns nothing from it.
  IF p_caller_id NOT IN (v_order.advertiser_id, v_order.taker_id) THEN
    RAISE EXCEPTION 'Only a party to this order can cancel it';
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

  -- Seller-side restriction (§2.3 amendment c): the crypto
  -- seller cannot cancel before the payment window expires.
  IF p_caller_id = v_order.crypto_seller_id AND now() < v_order.expires_at THEN
    RAISE EXCEPTION 'The seller cannot cancel while the payment window is still open — the escrow unlocks automatically when the window expires unpaid';
  END IF;

  PERFORM public.p2p_unlock_crypto_btc(p_order_id,
    CASE WHEN p_caller_id = v_order.crypto_seller_id THEN 'expire' ELSE 'cancel' END);

  -- A seller cancelling after expiry is the expiry outcome by
  -- another door (the buyer let the window die); a pre-expiry
  -- cancel is the buyer's free exit. Either way the FIAT BUYER's
  -- unpaid counters move (delta-audit D5): the counter belongs to
  -- the party who did not pay — on a buy ad the taker is the
  -- seller, a bystander who must never be charged for it.
  IF p_caller_id = v_order.crypto_seller_id THEN
    v_final_status := 'expired_unpaid';
    PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
    UPDATE public.p2p_trader_profiles
       SET orders_expired_unpaid = orders_expired_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.fiat_buyer_id;
  ELSE
    v_final_status := 'cancelled_unpaid';
    PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
    UPDATE public.p2p_trader_profiles
       SET orders_cancelled_unpaid = orders_cancelled_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.fiat_buyer_id;
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

-- ── D6 + D13: p2p_mark_paid ─────────────────────────────────────
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

  -- Delta-audit D6: the buyer check runs BEFORE the replay
  -- branch — the stored outcome of a paid-marked order is the
  -- buyer's record, not a public oracle for any caller.
  IF p_buyer_id <> v_order.fiat_buyer_id THEN
    RAISE EXCEPTION 'Only the buyer can mark this order as paid';
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

  -- Delta-audit D13: the EXISTS check above and this insert are
  -- not atomic — a concurrent mark-paid on another order can claim
  -- the same reference in between. The unique index is the
  -- backstop; catching its violation produces the SAME designed
  -- refusal + risk event as the pre-check, never a raw error.
  BEGIN
    INSERT INTO public.p2p_payment_claims (
      order_id, payment_method_id, rail_reference, rail_reference_norm,
      amount_sent_zmw, payer_name_attested, proof_file_hash, proof_storage_path
    ) VALUES (
      p_order_id, p_payment_method_id, btrim(p_rail_reference), v_ref_norm,
      round(p_amount_sent_zmw, 2), p_payer_name_attested,
      p_proof_file_hash, p_proof_storage_path
    );
  EXCEPTION WHEN unique_violation THEN
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
  END;

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

-- ── D6: p2p_confirm_release ─────────────────────────────────────
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

  -- Delta-audit D6: the seller check runs BEFORE the replay
  -- branch — the stored release outcome is the seller's record;
  -- anyone else is refused before they can observe it.
  IF p_seller_id <> v_order.crypto_seller_id THEN
    RAISE EXCEPTION 'Only the seller can confirm release for this order';
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

-- ── D7: p2p_execute_dispute_outcome guards itself ───────────────
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
  -- Delta-audit D7: this core now guards ITSELF instead of
  -- trusting its callers — both rows locked, existence checked,
  -- the dispute must belong to the order and still be open, and
  -- the outcome is whitelisted: an unrecognised outcome can no
  -- longer fall through into the refund branch.
  SELECT * INTO v_order
    FROM public.p2p_orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;
  SELECT * INTO v_dispute
    FROM public.p2p_disputes
   WHERE id = p_dispute_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dispute not found';
  END IF;
  IF v_dispute.order_id <> p_order_id THEN
    RAISE EXCEPTION 'This dispute does not belong to this order';
  END IF;
  IF v_dispute.status <> 'open' THEN
    RAISE EXCEPTION 'This dispute is already closed';
  END IF;
  IF p_outcome NOT IN ('release_to_buyer', 'refund_to_seller') THEN
    RAISE EXCEPTION 'Unknown dispute outcome: %', p_outcome;
  END IF;

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
    CASE WHEN NOT v_dispute.affects_escrow
         THEN 'Dispute closed. No Bitcoin was held in escrow for this order, so no Bitcoin moved.'
         WHEN p_outcome = 'release_to_buyer'
         THEN 'Dispute resolved: the Bitcoin has been released to the buyer.'
         ELSE 'Dispute resolved: the Bitcoin has been returned to the seller.'
    END);

  RETURN v_settled;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_execute_dispute_outcome(uuid, uuid, text, text, text, uuid, text, boolean, text) FROM authenticated;

-- ── D5: p2p_open_dispute auto-cancel counter ────────────────────
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
      -- Delta-audit D5: the unpaid counter belongs to the fiat
      -- buyer (the party who did not pay), never a bystander.
      PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
      UPDATE public.p2p_trader_profiles
         SET orders_cancelled_unpaid = orders_cancelled_unpaid + 1, updated_at = now()
       WHERE user_id = v_order.fiat_buyer_id;
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
      -- No sanction_applied audit row here (delta-audit D4):
      -- p2p_apply_sanction writes its own, so the event exists
      -- exactly once and no caller can skip it.
    END IF;
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_open_dispute(uuid, uuid, text, text, text) TO service_role;

-- ── D4 + D10: p2p_resolve_dispute sanction path ─────────────────
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
      END,
      p_admin_id);
    -- No sanction_applied audit row here (delta-audit D4):
    -- p2p_apply_sanction writes its own — now with the ruling
    -- admin's verified identity attached (delta-audit D10).
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

-- ── D5: p2p_expire_orders counter ───────────────────────────────
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
    -- Delta-audit D5: the expired-unpaid counter belongs to the
    -- fiat buyer who let the window die, never a bystander taker.
    PERFORM public.p2p_ensure_profile(v_order.fiat_buyer_id);
    UPDATE public.p2p_trader_profiles
       SET orders_expired_unpaid = orders_expired_unpaid + 1, updated_at = now()
     WHERE user_id = v_order.fiat_buyer_id;
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

-- ── D8: POS match failures persist and self-heal ────────────────
CREATE TABLE IF NOT EXISTS public.pos_match_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id uuid NOT NULL UNIQUE REFERENCES public.btc_deposits (id),
  error_message text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution text
);

CREATE INDEX IF NOT EXISTS pos_match_failures_unresolved_idx
  ON public.pos_match_failures (last_attempt_at)
  WHERE resolved_at IS NULL;

ALTER TABLE public.pos_match_failures ENABLE ROW LEVEL SECURITY;

-- No policies, no client grants: service-role / owner visibility
-- only (ops read it through the dashboard or service queries).
REVOKE ALL ON TABLE public.pos_match_failures FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.pos_apply_deposit_match(p_deposit_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dep public.btc_deposits;
  v_req public.pos_payment_requests;
  v_status TEXT;
BEGIN
  SELECT * INTO v_dep FROM public.btc_deposits WHERE id = p_deposit_id;
  IF v_dep.id IS NULL OR v_dep.status <> 'credited' THEN
    RETURN 'not_credited';
  END IF;

  IF EXISTS (SELECT 1 FROM public.pos_payment_requests
             WHERE deposit_id = p_deposit_id) THEN
    RETURN 'already_matched';
  END IF;

  -- Exact-amount candidates first, then oldest first (FIFO). The row
  -- lock + the status re-check inside the UPDATE keep two deposits
  -- racing for one request from both matching it.
  -- Delta-audit D8: a request past its expiry at CREDIT time
  -- does not match. The */5 sweep may not have flipped its status
  -- yet; without this predicate a late deposit would annotate an
  -- expired request as paid. Credit time is the deposit's
  -- credited_at (falling back to now()).
  SELECT * INTO v_req
  FROM public.pos_payment_requests
  WHERE user_id = v_dep.user_id
    AND deposit_address = v_dep.address
    AND status = 'awaiting_payment'
    AND expires_at > COALESCE(v_dep.credited_at, now())
  ORDER BY (sats_expected = v_dep.amount_sats) DESC, created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF v_req.id IS NULL THEN
    RETURN 'no_open_request';
  END IF;

  IF v_dep.amount_sats = v_req.sats_expected THEN
    v_status := 'paid';
  ELSIF v_dep.amount_sats < v_req.sats_expected THEN
    v_status := 'underpaid';
  ELSE
    v_status := 'overpaid';
  END IF;

  UPDATE public.pos_payment_requests
  SET status = v_status,
      deposit_id = v_dep.id,
      txid = v_dep.txid,
      sats_received = v_dep.amount_sats,
      confirmations_at_detection = v_dep.confirmations,
      btc_zmw_rate_at_payment = btc_zmw_rate,
      paid_at = COALESCE(v_dep.credited_at, now()),
      updated_at = now()
  WHERE id = v_req.id
    AND status = 'awaiting_payment';

  IF NOT FOUND THEN
    RETURN 'no_open_request';
  END IF;

  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.pos_match_deposit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.pos_apply_deposit_match(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'POS deposit match failed for deposit %: %', NEW.id, SQLERRM;
    -- Delta-audit D8: persist the failure for the retry sweep.
    -- The bookkeeping is itself exception-swallowed — crediting
    -- must never be affected by it either.
    BEGIN
      INSERT INTO public.pos_match_failures (deposit_id, error_message)
      VALUES (NEW.id, SQLERRM)
      ON CONFLICT (deposit_id) DO UPDATE
        SET attempts = public.pos_match_failures.attempts + 1,
            last_attempt_at = now(),
            error_message = EXCLUDED.error_message,
            resolved_at = NULL,
            resolution = NULL;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'POS match failure bookkeeping failed for deposit %: %', NEW.id, SQLERRM;
    END;
  END;
  RETURN NEW;
END;
$$;

-- The retry sweep: re-runs the matcher for unresolved failures.
-- Any completed matcher run resolves the row with its outcome as
-- the resolution — 'paid'/'underpaid'/'overpaid' matched,
-- 'already_matched' means another path annotated it meanwhile,
-- 'no_open_request' is a terminal fact (nothing open to match).
-- 'not_credited' stays unresolved (the deposit record may lag).
-- Attempts cap at 10; the row remains for ops inspection.
CREATE OR REPLACE FUNCTION public.pos_retry_match_failures()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fail public.pos_match_failures%ROWTYPE;
  v_result text;
  v_resolved integer := 0;
BEGIN
  FOR v_fail IN
    SELECT * FROM public.pos_match_failures
     WHERE resolved_at IS NULL
       AND attempts < 10
     ORDER BY last_attempt_at ASC
     LIMIT 50
  LOOP
    BEGIN
      v_result := public.pos_apply_deposit_match(v_fail.deposit_id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.pos_match_failures
         SET attempts = attempts + 1,
             last_attempt_at = now(),
             error_message = SQLERRM
       WHERE id = v_fail.id;
      CONTINUE;
    END;

    IF v_result = 'not_credited' THEN
      UPDATE public.pos_match_failures
         SET attempts = attempts + 1,
             last_attempt_at = now()
       WHERE id = v_fail.id;
      CONTINUE;
    END IF;

    UPDATE public.pos_match_failures
       SET resolved_at = now(),
           resolution = v_result,
           attempts = attempts + 1,
           last_attempt_at = now()
     WHERE id = v_fail.id;
    v_resolved := v_resolved + 1;
  END LOOP;

  RETURN v_resolved;
END;
$$;

REVOKE ALL ON FUNCTION public.pos_retry_match_failures() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_retry_match_failures() FROM anon;
REVOKE ALL ON FUNCTION public.pos_retry_match_failures() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pos_retry_match_failures() TO service_role;

-- Retry sweep cron (idempotent unschedule-first, as the expiry job).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pos-retry-match-failures') THEN
    PERFORM cron.unschedule('pos-retry-match-failures');
  END IF;
END $$;

SELECT cron.schedule(
  'pos-retry-match-failures',
  '*/5 * * * *',
  $$SELECT public.pos_retry_match_failures();$$);
