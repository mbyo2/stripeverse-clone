-- =====================================================================
-- 20261031_identity_face_verification.sql — in-house identity + face
-- verification ("like Sumsub", built on our own stack; design note:
-- docs/face-verification.md).
--
-- PURPOSE (CEO, 2026-10-23): face verification like Binance, so that
-- if something goes wrong the fraudster's face is known. Concretely:
--   * a liveness-checked selfie, matched 1:1 against the portrait on
--     the user's own ID document, is captured with explicit consent
--     and kept on record (document images + selfie in a PRIVATE
--     bucket, the face template in a service-role-only table);
--   * ONE FACE, ONE ACCOUNT: every new selfie template is compared
--     against every existing enrollment (dedupe). A face that is
--     already enrolled under another account can never be quietly
--     auto-approved — the submission is flagged for a human with
--     the matched account named;
--   * uncertain cases (borderline match, dedupe hit, manual photo
--     submission) go to a human review queue; only a clean automatic
--     pass or an admin decision enrols a face.
--
-- SHAPE — everything here follows the established patterns:
--   * platform_settings is a wide single-row table: the switch is a
--     COLUMN (face_verification_enabled), read with the COALESCE
--     pattern, DEFAULT false — enforcement stays OFF in this build:
--     nothing else in the app gates on face verification yet, and
--     the verify-identity edge function refuses NEW sessions while
--     the switch is off (the p2p kill-switch posture).
--   * The document/selfie bucket mirrors p2p-evidence: private,
--     10 MiB, images + PDF (SVG deliberately excluded), participant
--     policies + an admin read policy via
--     public.has_role(auth.uid(), 'admin'::app_role), and NO
--     update/delete policy for anyone — evidence is immutable
--     through the API. Paths are pinned by the client:
--       <user_id>/<kind>-<timestamp>.<ext>
--     so the owner predicate is simply "first folder segment is
--     the caller's own id".
--   * identity_verifications is owner-readable (a user sees their
--     own verification state and the reviewer's notes) and
--     admin-readable; there are NO client write policies — every
--     write flows through the verify-identity edge function on the
--     service-role client after it verifies the caller's JWT.
--   * face_enrollments, identity_verification_embeddings and
--     identity_liveness_sessions have NO client policies at all and
--     no grants to anon/authenticated (the pos_api_keys pattern):
--     face templates and liveness sessions NEVER transit PostgREST.
--     Embeddings are double precision[] — this project has no
--     pgvector (checked across all prior migrations) — and cosine
--     similarity is computed in the edge function.
--   * NO SQL functions are created: all decision logic lives in the
--     edge function's pure core module (unit-tested), so there is
--     nothing new to ACL here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. platform_settings: the face-verification switch.
-- DEFAULT false: the feature is dark until the CEO turns it on.
-- ---------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ADD COLUMN IF NOT EXISTS face_verification_enabled boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------
-- 2. The identity-evidence bucket (mirrors p2p-evidence config).
-- ON CONFLICT converges the config if the relay re-runs this file.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'identity-evidence',
  'identity-evidence',
  false,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'image/bmp', 'image/tiff', 'image/heic', 'image/heif',
    'image/avif', 'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2a. Owners can upload under their own user-id folder only.
DROP POLICY IF EXISTS "Identity evidence: owners can upload to their folder"
  ON storage.objects;
CREATE POLICY "Identity evidence: owners can upload to their folder"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'identity-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2b. Owners can read their own files back (review status screen and
-- the admin console's signed URLs are gated by the SELECT policies).
DROP POLICY IF EXISTS "Identity evidence: owners can view their files"
  ON storage.objects;
CREATE POLICY "Identity evidence: owners can view their files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'identity-evidence'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- 2c. Admins can read everything in the bucket (review queue).
DROP POLICY IF EXISTS "Identity evidence: admins can view all files"
  ON storage.objects;
CREATE POLICY "Identity evidence: admins can view all files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'identity-evidence'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- No UPDATE policy. No DELETE policy. For anyone. Verification
-- evidence is immutable through the API by construction (absence of
-- a policy is a denial under RLS). Withdrawal of consent is handled
-- by service-role admin tooling off-API, never by a client path.

-- ---------------------------------------------------------------------
-- 3. identity_verifications — one row per verification attempt.
-- Written ONLY by the verify-identity edge function (service role).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Decision state machine (docs/face-verification.md):
  --   pending         row written, decision not yet recorded
  --   liveness_failed the liveness transcript did not validate
  --   match_failed    selfie vs document cosine below the fail floor
  --   review          a human must decide (borderline match, dedupe
  --                   hit, or a manual photo submission)
  --   auto_verified   RESERVED for a future server-side-inference
  --                   build; never written today (audit V1/V2: no
  --                   auto-approval on client-computed embeddings)
  --   approved        admin approved from the review queue
  --   rejected        admin rejected from the review queue
  --   erased          biometric artefacts deleted on the user's
  --                   erasure request (paths/score/transcript are
  --                   nulled; the row remains as the audit anchor)
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'liveness_failed', 'match_failed',
                      'review', 'auto_verified', 'rejected', 'approved',
                      'erased')),
  document_type TEXT
    CHECK (document_type IN ('national_id', 'passport', 'driver_licence')),
  -- Storage paths inside identity-evidence, under the user's folder.
  document_front_path TEXT,
  document_back_path TEXT,
  selfie_path TEXT,
  -- Liveness evidence: the challenge transcript the client produced
  -- (challenge order, per-challenge completion timings and observed
  -- signal peaks, plus antispoof/liveness model scores when the
  -- engine provided them), or { "mode": "manual" } for a photo
  -- submission that went straight to human review.
  liveness JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Cosine similarity of selfie vs document-portrait embeddings,
  -- in [-1, 1]; NULL for manual submissions (no embeddings taken).
  match_score NUMERIC(6, 5),
  -- Dedupe outcome: { "checked": <enrollments compared>,
  -- "hits": [ { "user_id": ..., "score": ... } ] } — hits are only
  -- ever surfaced to admins, never to the submitting user.
  dedupe JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Zambia DPA: biometric data is sensitive personal data. Consent
  -- is captured on the consent screen BEFORE any capture happens;
  -- the version pins the exact wording the user agreed to.
  consent_given_at TIMESTAMPTZ,
  consent_text_version TEXT,
  reviewer_id UUID REFERENCES auth.users(id),
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_identity_verifications_user_created
  ON public.identity_verifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_verifications_review_queue
  ON public.identity_verifications (created_at)
  WHERE status = 'review';

ALTER TABLE public.identity_verifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own identity verifications"
  ON public.identity_verifications;
CREATE POLICY "Users view own identity verifications"
  ON public.identity_verifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins view all identity verifications"
  ON public.identity_verifications;
CREATE POLICY "Admins view all identity verifications"
  ON public.identity_verifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No client INSERT/UPDATE/DELETE policies: writes only via the edge
-- function.
--
-- SELECT is COLUMN-SCOPED (delta audit V3): the owner-readable row
-- must never leak dedupe hits (which name OTHER accounts and their
-- scores — a dedupe oracle), the match score, or the liveness
-- transcript. authenticated therefore gets SELECT on the safe
-- status columns only; the full row is service-role (edge function)
-- and admin-via-edge-function only. The RLS policies above still
-- apply on top of the column grants.
REVOKE ALL ON TABLE public.identity_verifications FROM anon, authenticated;
GRANT SELECT (id, user_id, status, document_type, created_at,
              updated_at, decided_at, reviewer_notes)
  ON TABLE public.identity_verifications TO authenticated;

-- ---------------------------------------------------------------------
-- 4. identity_liveness_sessions — single-use challenge sessions.
-- Issued by start_session (3 random challenges, 5-minute expiry),
-- consumed exactly once by submit. NO client policies (service-role
-- only): a user must never be able to read or forge a session.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_liveness_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  challenges TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_liveness_sessions_user
  ON public.identity_liveness_sessions (user_id, created_at DESC);

ALTER TABLE public.identity_liveness_sessions ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies.
REVOKE ALL ON TABLE public.identity_liveness_sessions FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. identity_verification_embeddings — the selfie embedding captured
-- with each decided submission, kept apart from the readable
-- verification row so an admin approval from the review queue can
-- still enrol the face. NO client policies (service-role only):
-- face templates never transit PostgREST.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_verification_embeddings (
  verification_id UUID PRIMARY KEY
    REFERENCES public.identity_verifications(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  embedding DOUBLE PRECISION[] NOT NULL,
  model_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.identity_verification_embeddings ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies.
REVOKE ALL ON TABLE public.identity_verification_embeddings FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. face_enrollments — THE face on record: at most one enrolled
-- template per user, written ONLY on admin approval (there is no
-- auto-verification in this build — delta audit V1/V2).
-- This is the set every new selfie is dedupe-checked against.
-- NO client policies (service-role only).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.face_enrollments (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  embedding DOUBLE PRECISION[] NOT NULL,
  model_version TEXT NOT NULL,
  verification_id UUID
    REFERENCES public.identity_verifications(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.face_enrollments ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies.
REVOKE ALL ON TABLE public.face_enrollments FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 7. identity_audit_log — the safety audit trail for this system.
-- The verify-identity edge function writes one row for every
-- session start, every submission (accepted, decided, or refused —
-- including refused, so brute-force attempts are visible), every
-- admin decision, every blocked self-decision, and every erasure.
-- `detail` carries machine codes and counts ONLY — never an
-- embedding, a score, a storage path, or an image reference.
-- NO client policies (service-role only): users cannot read, forge,
-- or delete the trail.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.identity_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The account the event is about (the verification subject).
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who performed the action: the user themselves for start/submit,
  -- the admin for decisions and erasures.
  actor_id UUID NOT NULL,
  action TEXT NOT NULL
    CHECK (action IN ('session_started', 'submit_attempt',
                      'submit_decided',
                      'submit_rejected', 'submit_finalize_failed',
                      'admin_decision', 'admin_decision_blocked',
                      'erasure')),
  outcome TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_identity_audit_log_user_created
  ON public.identity_audit_log (user_id, created_at DESC);

ALTER TABLE public.identity_audit_log ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policies.
REVOKE ALL ON TABLE public.identity_audit_log FROM anon, authenticated;
