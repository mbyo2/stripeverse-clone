-- =====================================================================
-- 20261209_p2p_gate_policy.sql
--
-- CEO POLICY DECISIONS (2026-10-24, go-live):
--
-- (1) DROP the phone requirement. p2p_kyc_tier's T1 gate required
--     auth.users.phone_confirmed_at IS NOT NULL, but no user-reachable
--     writer of that column exists (phone auth disabled, no SMS
--     provider credentials, no app flow) — proven live by the go-live
--     gauntlet: a fully KYC-approved, aged user still derived T0 with
--     reason kyc_required forever. Decision: approved KYC alone
--     unlocks trading. The phone conjunct is removed.
--
-- (2) FACE VERIFICATION JOINS THE P2P GATE (Binance-style). T1
--     additionally requires an APPROVED in-house identity
--     verification: a public.identity_verifications row for the user
--     with status = 'approved' (the human-review decision written by
--     verify-identity admin_decide; nothing auto-approves).
--
-- T2 and T3 derivations are unchanged. CREATE OR REPLACE preserves
-- the function's ACL ({postgres, service_role}).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.p2p_kyc_tier(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_face_approved boolean := false;
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

  SELECT u.created_at
    INTO v_account_created_at
    FROM auth.users u
   WHERE u.id = p_user_id;

  -- Face verification (CEO decision 2026-10-24): an APPROVED
  -- in-house identity verification joins the T1 gate.
  SELECT EXISTS (
           SELECT 1 FROM public.identity_verifications iv
            WHERE iv.user_id = p_user_id
              AND iv.status = 'approved'
         )
    INTO v_face_approved;

  -- T1 (§3.2, as amended by CEO decisions 2026-10-24): approved KYC
  -- (level >= basic, finding 3 + name, DOB and ID number recorded +
  -- verified_at set) + an approved face verification. Phone
  -- confirmation is NOT required (decision 20261209 (1)).
  IF NOT (
    v_level IN ('basic', 'full')
    AND v_verified_at IS NOT NULL
    AND NULLIF(btrim(COALESCE(v_first_name, '')), '') IS NOT NULL
    AND NULLIF(btrim(COALESCE(v_last_name, '')), '') IS NOT NULL
    AND v_dob IS NOT NULL
    AND v_id_number_norm IS NOT NULL
    AND COALESCE(v_face_approved, false)
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
$function$;
