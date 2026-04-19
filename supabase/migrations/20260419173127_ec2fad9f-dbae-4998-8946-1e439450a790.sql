-- Replace overly broad SELECT policies on public buckets to prevent listing by anyone.
-- Direct file access via public URL still works (served by storage edge); only the
-- listing API (/object/list) is restricted to file owners.

-- AVATARS bucket
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view avatars" ON storage.objects;

CREATE POLICY "Owners can list their avatars"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- BETA FEEDBACK SCREENSHOTS bucket
DROP POLICY IF EXISTS "Public can view beta feedback screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can view beta feedback screenshots" ON storage.objects;
DROP POLICY IF EXISTS "Beta feedback screenshots are publicly accessible" ON storage.objects;

CREATE POLICY "Admins can list beta feedback screenshots"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'beta-feedback-screenshots'
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );
