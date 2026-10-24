-- 20261210_kyc_user_update_policy.sql
--
-- BUG: a plain user's KYC RE-submission silently wrote nothing while
-- the mobile-money function reported success. public.kyc_verifications
-- had NO user UPDATE policy — only "Admins can update KYC
-- verifications" — so the caller's PostgREST UPDATE matched 0 rows,
-- and PostgREST treats a 0-row update as success. First submissions
-- (INSERT, which has a user policy) worked; every re-submission was
-- silently lost.
--
-- Policies on public.kyc_verifications BEFORE this migration
-- (enumerated live from pg_policies, 2026-10-24):
--   INSERT "Users can insert their own KYC"        (public)        check: uid = user_id
--   SELECT "Admins can view all KYC verifications" (authenticated) qual: has_role(admin)
--   SELECT "Users can view their own KYC"          (public)        qual: uid = user_id
--   SELECT "Users can view their own KYC verification" (public)    qual: uid = user_id
--   UPDATE "Admins can update KYC verifications"   (authenticated) qual+check: has_role(admin)
-- No existing policy is changed or dropped by this migration; the new
-- policy is additive (permissive policies OR, and this one grants
-- authenticated users a narrow path that did not exist before).
--
-- SHAPING (why a user cannot self-approve through this policy):
--   * USING pins the target row to the caller's own row AND to a row
--     that is still unverified (verified_at IS NULL). Once an admin
--     has approved a row, the user can no longer update it at all.
--   * WITH CHECK pins the resulting row: user_id must stay the
--     caller's, verified_at must stay NULL (approval is set by
--     admins only — every consumer of this table, including
--     public.p2p_kyc_tier and the check-kyc handler, keys approval
--     on verified_at, never on level alone), and level stays inside
--     the submission vocabulary ('none' | 'basic' | 'full') that the
--     verifyKyc handler itself writes on submission.
--   * The BEFORE UPDATE trigger trg_p2p_kyc_sync_normalised
--     unconditionally recomputes name_norm / id_number_norm from the
--     name / ID fields, so those derived columns cannot be poisoned.
--   * Column-level escalation beyond this does not exist: `level` on
--     an unverified row confers nothing (checkKycLevel downgrades an
--     unverified 'full' to 'basic'; p2p_kyc_tier returns T0 without
--     verified_at), so the service-write route was not needed.
--
-- Companion handler fix (same release): verifyKyc in the mobile-money
-- edge function now asserts the write returned a row and fails with a
-- crafted plain-language error otherwise, so a lost write can never
-- again masquerade as success.

CREATE POLICY "Users can update their own unverified KYC"
  ON public.kyc_verifications
  FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id AND verified_at IS NULL)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND verified_at IS NULL
    AND level IN ('none', 'basic', 'full')
  );
