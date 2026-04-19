-- The bucket id contains spaces ("Beta Feedback Screenshots"). Drop any broad SELECT
-- policies and replace with an admin-only listing policy.

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND (
        qual ILIKE '%Beta Feedback Screenshots%'
        OR policyname ILIKE '%beta%feedback%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "Admins can list beta feedback screenshots v2"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'Beta Feedback Screenshots'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "Authenticated can upload beta feedback screenshots"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'Beta Feedback Screenshots');
