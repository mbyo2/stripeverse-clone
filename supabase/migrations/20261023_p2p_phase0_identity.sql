-- =====================================================================
-- 20261023_p2p_phase0_identity.sql — P2P Phase 0: identity & trust
-- foundations (scope: p2p-marketplace-scope.md §5.1).
--
-- Implements ONLY the Phase 0 layer of the P2P marketplace design:
--   * §3.2  KYC tier derivation (p2p_kyc_tier) + identity anchoring:
--           normalised KYC names / ID numbers, verified-row UNIQUE on
--           (id_type, id_number_norm), service-role-only identity
--           signals table (p2p_identity_signals).
--   * §4.1  Payment-method registry (p2p_payment_methods) with
--           name-match evaluation; writes only through RPCs.
--   * §3.9  user_sanctions (platform-wide shape; P2P is the first
--           consumer) + apply/revoke RPCs.
--   * §3.4  p2p_trader_profiles (counters written only by settlement
--           RPCs — users can never write it) + public-safe projection
--           view + reserved-nickname list and guard (§5.1).
--   * §3.3  p2p_effective_limits — tier rights, cooling periods,
--           graduated caps, velocity hard caps, sanction holds and
--           identity-review holds.
--   * §4.1  Re-review queue (p2p_reviews): a change to a verified
--           identity or to the verified phone opens a review and a
--           72-hour P2P trade hold (§3.2 phone anchoring).
-- NO marketplace surface is created here: no ads, no orders, no
-- escrow holds — those are Phase 1. p2p_enabled ships DEFAULT false,
-- so everything below is inert until Phase 1 turns the switch on.
--
-- REPO FINDINGS the design rests on (verified 2026-10-23):
-- (1) PHONE VERIFICATION — there is NO app-side representation: no
--     OTP / phone-verification table, no phone_confirmed column, and
--     the KYC flow (src/components/wallet/KycVerification.tsx) never
--     touches a phone number. The only phone-confirmation evidence
--     in the system is Supabase Auth's auth.users.phone_confirmed_at,
--     so p2p_kyc_tier reads it inside a SECURITY DEFINER function
--     (the auth schema is not client-visible). Until the app runs a
--     phone-confirmation flow, phone_confirmed_at stays NULL and
--     every user derives T0 — the safe direction.
-- (2) AML SCREENINGS — status is free TEXT with DEFAULT 'completed'
--     (migration 20260308183034); nothing in src/ or
--     supabase/functions ever inserts or transitions a screening
--     (useAmlScreening is a read-only hook), so 'completed' is the
--     only status value evidenced anywhere in the repo. "Completed
--     with no unresolved match" is therefore implemented as:
--     EXISTS(status = 'completed') AND NOT EXISTS(match_found AND
--     reviewed_at IS NULL) — a found match nobody has reviewed
--     blocks T2 even when another screening completed clean.
-- (3) KYC LEVELS — src/components/wallet/KycVerificationStatus.tsx
--     KycLevel enum: 'none' < 'basic' < 'full'. KycStatus is NOT
--     stored; the client derives it (verified_at set => approved,
--     metadata.rejection_reason => rejected). "Level >= basic"
--     below means level IN ('basic','full'); T2 additionally
--     requires level = 'full' + document presence — the
--     server-verifiable form of §3.2's "documents + selfie reviewed
--     and approved" (the review itself is evidenced by verified_at,
--     which is set on approval).
--
-- SETTINGS ADAPTATION — the scope (§4.1) lists platform_settings
-- additions as if the table were key/value; live it is a WIDE
-- SINGLE-ROW table (boolean id PK + one column per setting — see
-- 20261023_send_money_platform_fee.sql). The P2P settings are added
-- as COLUMNS in section 2 and read with the established pattern
-- COALESCE((SELECT col FROM public.platform_settings WHERE id),
-- default), so a missing row falls back instead of failing.
--
-- GRANT DISCIPLINE — every function created here is pinned
-- SET search_path = public, SECURITY DEFINER where it must cross
-- RLS / the auth schema, and gets the explicit triple revoke
-- (PUBLIC + anon + authenticated): this project's default
-- privileges grant EXECUTE to anon/authenticated on fresh
-- functions, so a PUBLIC-only revoke leaves them callable (proven
-- live 2026-10-23, M1 btc_reserve_withdrawal). Only service_role is
-- granted EXECUTE; the `p2p` edge function (Phase 1) verifies the
-- caller's JWT and then calls these RPCs with the service-role
-- client — the sole caller path (scope §3.1 iron rule 6).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2. platform_settings: P2P columns (wide single-row table)
-- ---------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_fee_percent numeric NOT NULL DEFAULT 0.5;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_seller_response_hours integer NOT NULL DEFAULT 12;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_dispute_sla_hours integer NOT NULL DEFAULT 72;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_new_account_cooldown_hours integer NOT NULL DEFAULT 24;

ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS p2p_withdrawal_hold_hours integer NOT NULL DEFAULT 24;

-- ---------------------------------------------------------------------
-- 3. kyc_verifications: normalised identity columns (§3.2)
-- ---------------------------------------------------------------------

-- Canonical name form: upper-cased, every run of non-alphanumerics
-- folded to a single space, trimmed. "Name is canonical" (§3.2):
-- every P2P name comparison uses this form, never the raw fields.
CREATE OR REPLACE FUNCTION public.p2p_normalise_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    btrim(regexp_replace(upper(COALESCE(p_name, '')), '[^A-Z0-9]+', ' ', 'g')),
    '');
$$;

REVOKE ALL ON FUNCTION public.p2p_normalise_name(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_normalise_name(text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_normalise_name(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_normalise_name(text) TO service_role;

-- Canonical ID-number form: upper-cased, spaces and hyphens stripped
-- (NRC / passport numbers are compared without their separators).
CREATE OR REPLACE FUNCTION public.p2p_normalise_id_number(p_id_number text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(upper(COALESCE(p_id_number, '')), '[\s-]+', '', 'g'), '');
$$;

REVOKE ALL ON FUNCTION public.p2p_normalise_id_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_normalise_id_number(text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_normalise_id_number(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_normalise_id_number(text) TO service_role;

ALTER TABLE public.kyc_verifications
  ADD COLUMN IF NOT EXISTS name_norm text;

ALTER TABLE public.kyc_verifications
  ADD COLUMN IF NOT EXISTS id_number_norm text;

-- Keep both normalised columns in step with the source fields on
-- every insert / identity-field update.
CREATE OR REPLACE FUNCTION public.p2p_kyc_sync_normalised()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.name_norm := public.p2p_normalise_name(
    btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')));
  NEW.id_number_norm := public.p2p_normalise_id_number(NEW.id_number);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_kyc_sync_normalised() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_kyc_sync_normalised() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_kyc_sync_normalised() FROM authenticated;

DROP TRIGGER IF EXISTS trg_p2p_kyc_sync_normalised ON public.kyc_verifications;
CREATE TRIGGER trg_p2p_kyc_sync_normalised
  BEFORE INSERT OR UPDATE OF first_name, last_name, id_number
  ON public.kyc_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_kyc_sync_normalised();

-- Backfill (the live table is empty today; written anyway so the
-- migration is correct on any environment that already has rows).
UPDATE public.kyc_verifications
   SET name_norm = public.p2p_normalise_name(
         btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))),
       id_number_norm = public.p2p_normalise_id_number(id_number);

-- One identity, one trading account (§3.2): a verified ID number may
-- back exactly ONE account. Partial: unverified drafts may repeat a
-- number (data-entry errors happen before review); the anchor bites
-- at verification time.
CREATE UNIQUE INDEX IF NOT EXISTS kyc_verifications_verified_id_unique
  ON public.kyc_verifications (id_type, id_number_norm)
  WHERE verified_at IS NOT NULL
    AND id_number_norm IS NOT NULL
    AND id_number_norm <> '';

-- ---------------------------------------------------------------------
-- 4. p2p_identity_signals — identity fingerprints (§3.2, §4.1)
-- Service-role only: NO client policies at all. A duplicate
-- (signal_type, signal_hash) is the anti-return signal: the second
-- account presenting the same ID fingerprint / phone / payment
-- account collides here and is flagged for admin review (Phase 1
-- wires the flagging; the anchor itself lands now).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_identity_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  signal_type text NOT NULL,
  signal_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signal_type, signal_hash)
);

ALTER TABLE public.p2p_identity_signals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.p2p_identity_signals FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. user_sanctions — the sanctions ladder (§3.9)
-- Platform-wide shape; P2P is the first consumer. History is
-- immutable: revocation is a status change, never a delete, and no
-- client role gets a write policy except admins (console) — the
-- engine writes through service_role RPCs (§10).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_sanctions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('p2p', 'platform')),
  level integer NOT NULL CHECK (level >= 0 AND level <= 4),
  reason_code text NOT NULL,
  detail text,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  applied_by text NOT NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_sanctions_user_status_idx
  ON public.user_sanctions (user_id, status);

ALTER TABLE public.user_sanctions ENABLE ROW LEVEL SECURITY;

-- Users must be able to see (and appeal) their own sanctions (§3.9).
CREATE POLICY "Users can view their own sanctions"
  ON public.user_sanctions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage sanctions"
  ON public.user_sanctions FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.user_sanctions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_sanctions TO authenticated;
-- The grants above are inert without a policy: the only write path
-- RLS admits for `authenticated` is the admin policy; everyone else
-- writes via service_role (which bypasses RLS).


-- ---------------------------------------------------------------------
-- 6. p2p_trader_profiles — reputation counters (§3.4)
-- One row per user, updated ONLY by settlement RPCs (Phase 1) —
-- users can never write it: no client write policies and the write
-- grants are revoked. user_id follows the crypto_wallets convention
-- (plain uuid, no FK to auth.users).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_trader_profiles (
  user_id uuid PRIMARY KEY,
  nickname text,
  trades_completed integer NOT NULL DEFAULT 0,
  trades_as_buyer integer NOT NULL DEFAULT 0,
  trades_as_seller integer NOT NULL DEFAULT 0,
  orders_cancelled_unpaid integer NOT NULL DEFAULT 0,
  orders_expired_unpaid integer NOT NULL DEFAULT 0,
  disputes_opened integer NOT NULL DEFAULT 0,
  disputes_won integer NOT NULL DEFAULT 0,
  disputes_lost integer NOT NULL DEFAULT 0,
  volume_zmw_completed numeric NOT NULL DEFAULT 0,
  median_release_minutes numeric,
  first_trade_at timestamptz,
  last_trade_at timestamptz,
  t3_approved_at timestamptz,
  t3_approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.p2p_trader_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own trader profile"
  ON public.p2p_trader_profiles FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.p2p_trader_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.p2p_trader_profiles FROM authenticated;
GRANT SELECT ON TABLE public.p2p_trader_profiles TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS p2p_trader_profiles_nickname_unique
  ON public.p2p_trader_profiles (lower(nickname))
  WHERE nickname IS NOT NULL;

-- Public-safe projection (§4.1): nickname + counters only — never a
-- legal name, never an identifier. The view runs as its owner and
-- bypasses the base table's owner-only policy by design; the column
-- list above is the entire exposure.
CREATE OR REPLACE VIEW public.p2p_trader_public AS
SELECT user_id,
       nickname,
       trades_completed,
       trades_as_buyer,
       trades_as_seller,
       disputes_won,
       disputes_lost,
       volume_zmw_completed,
       median_release_minutes,
       first_trade_at
  FROM public.p2p_trader_profiles;

REVOKE ALL ON TABLE public.p2p_trader_public FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.p2p_trader_public TO authenticated;

-- ---------------------------------------------------------------------
-- 7. p2p_reserved_nicknames + guard (§5.1, §3.4)
-- Nicknames are cosmetic and shown on ads; platform-impersonating
-- names are refused at write time, inside the database, so no
-- client path can claim one.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_reserved_nicknames (
  nickname text PRIMARY KEY
);

INSERT INTO public.p2p_reserved_nicknames (nickname) VALUES
  ('bmaglass'), ('bmaglasspay'), ('admin'), ('administrator'),
  ('support'), ('official'), ('staff'), ('moderator'), ('system'),
  ('help'), ('helpdesk'), ('security'), ('payments'), ('payment'),
  ('bitcoin'), ('btc'), ('wallet'), ('team'), ('ceo'), ('owner')
ON CONFLICT (nickname) DO NOTHING;

ALTER TABLE public.p2p_reserved_nicknames ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.p2p_reserved_nicknames FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.p2p_trader_profile_nickname_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.nickname IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.p2p_reserved_nicknames r
     WHERE r.nickname = lower(NEW.nickname)
  ) THEN
    RAISE EXCEPTION 'This nickname is reserved and cannot be used';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_trader_profile_nickname_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_trader_profile_nickname_guard() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_trader_profile_nickname_guard() FROM authenticated;

DROP TRIGGER IF EXISTS trg_p2p_trader_profile_nickname_guard ON public.p2p_trader_profiles;
CREATE TRIGGER trg_p2p_trader_profile_nickname_guard
  BEFORE INSERT OR UPDATE OF nickname
  ON public.p2p_trader_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_trader_profile_nickname_guard();

-- ---------------------------------------------------------------------
-- 8. p2p_reviews — re-review queue + trade hold (§3.2, §4.1)
-- Changing a verified identity, or the phone on a verified account,
-- opens a review and a 72-hour P2P trade hold (account-takeover
-- defence: a hijacked account must not be able to re-point payments
-- before the owner notices). The queue stores WHICH fields changed
-- — never the KYC values themselves.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.p2p_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('identity_change', 'phone_change')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared')),
  hold_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS p2p_reviews_user_status_idx
  ON public.p2p_reviews (user_id, status);

ALTER TABLE public.p2p_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage P2P reviews"
  ON public.p2p_reviews FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON TABLE public.p2p_reviews FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.p2p_reviews TO authenticated;
-- As with user_sanctions: the grants are inert without a policy —
-- only the admin policy admits `authenticated`; the triggers below
-- and Phase 1 services write as service_role / function owner.

-- Verified-identity change -> review + 72h hold. Fires only when the
-- row is verified (verified_at set): pre-verification edits are the
-- normal application flow, not a takeover signal.
CREATE OR REPLACE FUNCTION public.p2p_kyc_review_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF NEW.verified_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.first_name IS DISTINCT FROM OLD.first_name THEN
    v_changed := v_changed || 'first_name';
  END IF;
  IF NEW.last_name IS DISTINCT FROM OLD.last_name THEN
    v_changed := v_changed || 'last_name';
  END IF;
  IF NEW.id_number IS DISTINCT FROM OLD.id_number THEN
    v_changed := v_changed || 'id_number';
  END IF;
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    v_changed := v_changed || 'date_of_birth';
  END IF;
  IF array_length(v_changed, 1) IS NOT NULL THEN
    INSERT INTO public.p2p_reviews (user_id, reason, detail, hold_until)
    VALUES (NEW.user_id, 'identity_change',
            jsonb_build_object('changed_fields', to_jsonb(v_changed)),
            now() + interval '72 hours');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_kyc_review_on_identity_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_kyc_review_on_identity_change() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_kyc_review_on_identity_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_p2p_kyc_review_on_identity_change ON public.kyc_verifications;
CREATE TRIGGER trg_p2p_kyc_review_on_identity_change
  AFTER UPDATE OF first_name, last_name, id_number, date_of_birth
  ON public.kyc_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_kyc_review_on_identity_change();

-- Verified-phone change -> review + 72h hold. "Verified" here means
-- the account holds a verified KYC row: profiles.phone is the
-- platform's phone of record and there is no separate phone-proof
-- table (finding 1).
CREATE OR REPLACE FUNCTION public.p2p_profile_review_on_phone_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.phone IS DISTINCT FROM OLD.phone AND EXISTS (
    SELECT 1
      FROM public.kyc_verifications k
     WHERE k.user_id = NEW.id
       AND k.verified_at IS NOT NULL
  ) THEN
    INSERT INTO public.p2p_reviews (user_id, reason, detail, hold_until)
    VALUES (NEW.id, 'phone_change',
            jsonb_build_object('changed_fields', to_jsonb(ARRAY['phone'])),
            now() + interval '72 hours');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_profile_review_on_phone_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_profile_review_on_phone_change() FROM anon;
REVOKE ALL ON FUNCTION public.p2p_profile_review_on_phone_change() FROM authenticated;

DROP TRIGGER IF EXISTS trg_p2p_profile_review_on_phone_change ON public.profiles;
CREATE TRIGGER trg_p2p_profile_review_on_phone_change
  AFTER UPDATE OF phone
  ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.p2p_profile_review_on_phone_change();
-- Neither trigger function writes to its own trigger table, so the
-- review inserts can never recurse.

-- ---------------------------------------------------------------------
-- 9. p2p_payment_methods — the payment registry (§4.1, §2.4)
-- Owner reads own rows; ALL writes go through the section-10 RPCs
-- (cross-user uniqueness + name-match live there, and the partial
-- unique index below is the hard backstop). account_number_norm is
-- the comparison form: for Zambian mobile money that is the local
-- 0-prefixed MSISDN, so '+260 977 …', '260977…' and '0977 …' are
-- the same account.
-- ---------------------------------------------------------------------

-- Digits only, then fold international forms onto the local form:
--   260XXXXXXXXX (12 digits: country code, no trunk 0) -> 0XXXXXXXXX
--   00260XXXXXXXXX (14 digits: 00 international prefix) -> 0XXXXXXXXX
-- A 13-digit string starting 260 is NOT a valid Zambian MSISDN
-- shape (260 + 10 digits); it is returned as-is rather than guessing
-- which digit is wrong — it simply never matches a real account.
CREATE OR REPLACE FUNCTION public.p2p_normalise_account_number(p_number text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_number, ''), '\D', '', 'g');
BEGIN
  IF v_digits = '' THEN
    RETURN NULL;
  END IF;
  IF length(v_digits) = 12 AND left(v_digits, 3) = '260' THEN
    RETURN '0' || substr(v_digits, 4);
  END IF;
  IF length(v_digits) = 14 AND left(v_digits, 5) = '00260' THEN
    RETURN '0' || substr(v_digits, 6);
  END IF;
  RETURN v_digits;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_normalise_account_number(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_normalise_account_number(text) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_normalise_account_number(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_normalise_account_number(text) TO service_role;

CREATE TABLE IF NOT EXISTS public.p2p_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('mobile_money', 'bank')),
  account_number text NOT NULL,
  account_number_norm text NOT NULL,
  account_name text NOT NULL,
  bank_name text,
  is_primary boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'removed')),
  verified_name_match boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Unique normalised number across users, for ACTIVE rows (§4.1).
CREATE UNIQUE INDEX IF NOT EXISTS p2p_payment_methods_active_number_unique
  ON public.p2p_payment_methods (account_number_norm)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS p2p_payment_methods_user_idx
  ON public.p2p_payment_methods (user_id, status);

ALTER TABLE public.p2p_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own payment methods"
  ON public.p2p_payment_methods FOR SELECT
  USING (auth.uid() = user_id);

REVOKE ALL ON TABLE public.p2p_payment_methods FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.p2p_payment_methods FROM authenticated;
GRANT SELECT ON TABLE public.p2p_payment_methods TO authenticated;


-- ---------------------------------------------------------------------
-- 10. RPCs — all SECURITY DEFINER, search_path pinned, EXECUTE
-- granted to service_role only (see the grant-discipline note in
-- the header). The Phase 1 `p2p` edge function is the only caller.
-- ---------------------------------------------------------------------

-- p2p_kyc_tier: the authoritative tier derivation (§3.2). Never
-- reads a client-settable "tier" field — everything is derived
-- from the KYC row, the AML rows, Auth state and the trader
-- profile, in this function, every time it is asked.
CREATE OR REPLACE FUNCTION public.p2p_kyc_tier(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_level text;
  v_first_name text;
  v_last_name text;
  v_id_number_norm text;
  v_dob date;
  v_id_front_url text;
  v_id_back_url text;
  v_selfie_url text;
  v_address_doc_url text;
  v_verified_at timestamptz;
  v_phone_confirmed boolean := false;
  v_account_created_at timestamptz;
  v_aml_completed boolean := false;
  v_aml_unresolved boolean := false;
  v_trades_completed integer;
  v_cancelled integer;
  v_expired integer;
  v_disputes_lost integer;
  v_t3_approved_at timestamptz;
  v_denominator integer;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN 'T0';
  END IF;

  SELECT k.level, k.first_name, k.last_name, k.id_number_norm,
         k.date_of_birth, k.id_front_url, k.id_back_url, k.selfie_url,
         k.address_doc_url, k.verified_at
    INTO v_level, v_first_name, v_last_name, v_id_number_norm,
         v_dob, v_id_front_url, v_id_back_url, v_selfie_url,
         v_address_doc_url, v_verified_at
    FROM public.kyc_verifications k
   WHERE k.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'T0';
  END IF;

  SELECT (u.phone_confirmed_at IS NOT NULL), u.created_at
    INTO v_phone_confirmed, v_account_created_at
    FROM auth.users u
   WHERE u.id = p_user_id;

  -- T1 (§3.2): phone verified (finding 1: auth.users
  -- .phone_confirmed_at) + level >= basic (finding 3) + name, DOB
  -- and ID number recorded + verified_at set.
  IF NOT (
    COALESCE(v_phone_confirmed, false)
    AND v_level IN ('basic', 'full')
    AND v_verified_at IS NOT NULL
    AND NULLIF(btrim(COALESCE(v_first_name, '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(v_last_name, '')), '') IS NOT NULL
    AND v_dob IS NOT NULL
    AND v_id_number_norm IS NOT NULL
  ) THEN
    RETURN 'T0';
  END IF;

  -- T2 (§3.2): T1 + full level + ID front/back + selfie on file +
  -- AML completed with no unresolved match (finding 2).
  SELECT EXISTS (
           SELECT 1 FROM public.aml_screenings a
            WHERE a.user_id = p_user_id AND a.status = 'completed'
         ),
         EXISTS (
           SELECT 1 FROM public.aml_screenings a
            WHERE a.user_id = p_user_id
              AND a.match_found
              AND a.reviewed_at IS NULL
         )
    INTO v_aml_completed, v_aml_unresolved;

  IF NOT (
    v_level = 'full'
    AND v_id_front_url IS NOT NULL
    AND v_id_back_url IS NOT NULL
    AND v_selfie_url IS NOT NULL
    AND v_aml_completed
    AND NOT v_aml_unresolved
  ) THEN
    RETURN 'T1';
  END IF;

  -- T3 (§3.2): T2 + >= 30 completed trades + >= 95% completion
  -- (§3.4 formula) + >= 60 days account age + proof of address +
  -- manual admin approval recorded on the trader profile.
  SELECT t.trades_completed, t.orders_cancelled_unpaid,
         t.orders_expired_unpaid, t.disputes_lost, t.t3_approved_at
    INTO v_trades_completed, v_cancelled, v_expired, v_disputes_lost,
         v_t3_approved_at
    FROM public.p2p_trader_profiles t
   WHERE t.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN 'T2';
  END IF;

  v_denominator := v_trades_completed + v_cancelled + v_expired + v_disputes_lost;

  IF v_trades_completed >= 30
     AND v_denominator > 0
     AND v_trades_completed::numeric / v_denominator >= 0.95
     AND v_account_created_at IS NOT NULL
     AND now() - v_account_created_at >= interval '60 days'
     AND v_address_doc_url IS NOT NULL
     AND v_t3_approved_at IS NOT NULL THEN
    RETURN 'T3';
  END IF;

  RETURN 'T2';
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_kyc_tier(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_kyc_tier(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_kyc_tier(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_kyc_tier(uuid) TO service_role;

-- p2p_effective_limits: every P2P gate reads this (§3.3 limit
-- model). Returns the tier, the gates, the caps and the reasons —
-- refusals must be explainable in plain language, so every block
-- appends a machine-readable reason code.
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

  -- Today's usage / open orders / orders today. p2p_orders is a
  -- Phase 1 table; until it exists this guarded branch keeps every
  -- counter at 0. The dynamic query assumes the §4.1 shape
  -- (statuses escrow_locked / paid_marked / completed; fiat total
  -- in fiat_amount_zmw; day boundary = UTC date_trunc).
  -- PHASE 1: drop the to_regclass guard, keep the EXECUTE body.
  IF to_regclass('public.p2p_orders') IS NOT NULL THEN
    EXECUTE
      'SELECT COALESCE(SUM(o.fiat_amount_zmw)
                 FILTER (WHERE o.status IN (''escrow_locked'', ''paid_marked'', ''completed'')), 0),
              COALESCE(COUNT(*) FILTER (WHERE o.status IN (''escrow_locked'', ''paid_marked'')), 0),
              COALESCE(COUNT(*), 0)
         FROM public.p2p_orders o
        WHERE (o.taker_id = $1 OR o.advertiser_id = $1)
          AND o.created_at >= date_trunc(''day'', now())'
      INTO v_daily_used, v_open_orders, v_orders_today
      USING p_user_id;
  END IF;

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
  -- Phase 0 ships the gate only; the completed-trade /
  -- unique-counterparty bands (5/4, 15/10, 30/20, 75/40) that grow
  -- ad limits above this floor are computed in Phase 1, where
  -- p2p_orders exists to count counterparties from.
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

-- p2p_create_payment_method: registry write with name-match
-- evaluation + cross-user uniqueness + identity-signal
-- registration (§4.1, §4.2). Plain-language errors: these surface
-- to the user through the edge function.
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

  INSERT INTO public.p2p_payment_methods (
    user_id, type, account_number, account_number_norm, account_name,
    bank_name, is_primary, verified_name_match
  ) VALUES (
    p_user_id, p_type, btrim(p_account_number), v_norm, btrim(p_account_name),
    NULLIF(btrim(COALESCE(p_bank_name, '')), ''), v_is_first, v_name_match
  )
  RETURNING * INTO v_row;

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

-- p2p_set_payment_method_status: owner-only status transitions.
-- Reactivation re-runs the uniqueness anchor; losing the primary
-- promotes the oldest remaining active method (§4.2).
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

  UPDATE public.p2p_payment_methods
     SET status = p_status,
         is_primary = CASE WHEN p_status = 'active' THEN is_primary ELSE false END,
         updated_at = now()
   WHERE id = p_method_id
   RETURNING * INTO v_row;

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

-- p2p_apply_sanction / p2p_revoke_sanction: the ladder writes
-- (§3.9, §4.2). applied_by is 'system' for automatic rungs or the
-- admin's user id as text; revocation flips status, never deletes.
CREATE OR REPLACE FUNCTION public.p2p_apply_sanction(
  p_user_id uuid,
  p_scope text,
  p_level integer,
  p_reason_code text,
  p_detail text,
  p_applied_by text,
  p_duration interval DEFAULT NULL
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

  INSERT INTO public.user_sanctions (
    user_id, scope, level, reason_code, detail, applied_by, expires_at
  ) VALUES (
    p_user_id, p_scope, p_level, p_reason_code, p_detail, p_applied_by,
    CASE WHEN p_duration IS NULL THEN NULL ELSE now() + p_duration END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_apply_sanction(uuid, text, integer, text, text, text, interval) TO service_role;

CREATE OR REPLACE FUNCTION public.p2p_revoke_sanction(p_sanction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.user_sanctions
     SET status = 'revoked'
   WHERE id = p_sanction_id
     AND status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.p2p_revoke_sanction(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.p2p_revoke_sanction(uuid) TO service_role;
