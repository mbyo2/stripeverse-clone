-- =====================================================================
-- 20261208_aml_screening_on_kyc_approval.sql
--
-- DEFECT (verified live 2026-10-24, go-live gauntlet):
-- public.p2p_kyc_tier(p_user_id) derives tier T2 only when an
-- aml_screenings row exists for the user with status = 'completed'
-- AND no unresolved match (no row with match_found = true and
-- reviewed_at IS NULL). Nothing in the platform ever inserted into
-- public.aml_screenings — the table held 0 rows — so no user could
-- ever satisfy the AML half of T2, however thoroughly an admin had
-- reviewed and approved their KYC.
--
-- MECHANISM:
-- Admin KYC approval in the real app is an authenticated admin
-- updating public.kyc_verifications SET level = 'full',
-- verified_at = now() (AdminUsers handleApproveKyc, direct
-- PostgREST under the admin's JWT; RLS permits admins). This
-- migration adds an AFTER UPDATE trigger on kyc_verifications that
-- fires exactly on the approval transition — verified_at moving
-- from NULL to NOT NULL — and records the screening that approval
-- actually represents.
--
-- HONESTY RULE:
-- The approving admin's review IS a manual human review; it is NOT
-- an external sanctions/PEP provider check, and this migration
-- never claims otherwise. The row is recorded with
-- screening_type = 'manual_admin_review', match_found = false,
-- status = 'completed', reviewed_by = auth.uid() (the approving
-- admin under their JWT; NULL when no JWT is present, e.g. a
-- service-role write), reviewed_at = now(), and match_details
-- naming the source (manual_admin_review via kyc_approval, with
-- the kyc_verifications id). If a real external provider is
-- integrated later, it must write its own screening_type — the
-- manual-review rows must not be relabelled.
--
-- IDEMPOTENCY:
-- Re-approvals must not stack rows. The trigger function refuses
-- to insert when a completed 'manual_admin_review' row already
-- exists for the user, so each user gains at most one such row
-- through this path.
--
-- NOTES:
-- * aml_screenings has RLS enabled with NO policies (postgres /
--   service_role only), so the trigger function is SECURITY
--   DEFINER with SET search_path = public — the insert succeeds
--   regardless of the approving admin's RLS surface, following the
--   repo pattern for cross-table trigger writes.
-- * p2p_kyc_tier itself is deliberately UNCHANGED: with a
--   completed, match-free screening row present it already derives
--   T2 correctly.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.record_aml_screening_on_kyc_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotency guard: one completed manual-review row per user.
  IF EXISTS (
    SELECT 1
      FROM public.aml_screenings a
     WHERE a.user_id = NEW.user_id
       AND a.screening_type = 'manual_admin_review'
       AND a.status = 'completed'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.aml_screenings (
    user_id,
    screening_type,
    full_name,
    date_of_birth,
    status,
    match_found,
    reviewed_by,
    reviewed_at,
    match_details
  ) VALUES (
    NEW.user_id,
    'manual_admin_review',
    NEW.first_name || ' ' || NEW.last_name,
    NEW.date_of_birth::text,
    'completed',
    false,
    auth.uid(),
    now(),
    jsonb_build_object(
      'source', 'manual_admin_review',
      'via', 'kyc_approval',
      'kyc_verification_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_aml_screening_on_kyc_approval() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_aml_screening_on_kyc_approval() FROM anon;
REVOKE ALL ON FUNCTION public.record_aml_screening_on_kyc_approval() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.record_aml_screening_on_kyc_approval() TO service_role;

DROP TRIGGER IF EXISTS trg_aml_screening_on_kyc_approval
  ON public.kyc_verifications;
CREATE TRIGGER trg_aml_screening_on_kyc_approval
AFTER UPDATE ON public.kyc_verifications
FOR EACH ROW
WHEN (OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL)
EXECUTE FUNCTION public.record_aml_screening_on_kyc_approval();
