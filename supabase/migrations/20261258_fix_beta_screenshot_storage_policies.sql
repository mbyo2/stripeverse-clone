-- Fix stale beta-screenshot storage policies (2026-11-10 sweep).
--
-- The bucket was renamed to `beta_screenshots` (migration
-- 20260419173302), but the two storage policies still reference the
-- retired pre-rename bucket id, so they never match:
--   * signed-in users uploading a beta screenshot got 403
--     "new row violates row-level security policy" on EVERY upload
--     (proven live 2026-11-10 with a QA user, both the
--     `feedback/<file>` app path and a `<uid>/<file>` path);
--     the bucket has been empty since the rename;
--   * admins could not list beta screenshots either.
-- The app also uploaded to the shared `feedback/` prefix while the
-- user-scoped policy requires foldername[1] = auth.uid(); the app
-- path is fixed alongside (src/utils/feedbackService.ts) to
-- `<uid>/<file>`. The `beta_feedback` table has no screenshot-path
-- column, so admins locate a screenshot by listing the user's
-- folder under the fixed admin-list policy.
--
-- No privilege change: both policies keep their original shape and
-- role (authenticated only, admin list + owner-scoped upload).

DROP POLICY IF EXISTS "Admins can list beta feedback screenshots v2" ON storage.objects;
DROP POLICY IF EXISTS "Beta feedback screenshots user-scoped upload" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can upload beta feedback screenshots" ON storage.objects;

CREATE POLICY "Admins can list beta feedback screenshots v2"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'beta_screenshots'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Beta feedback screenshots user-scoped upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'beta_screenshots'
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );
