-- Replace the broad "publicly readable by path" SELECT policy on
-- vault-assets with a scoped policy that only lets providers list their
-- own folder. Direct file fetches by URL keep working because the bucket
-- is marked public (bucket.public = true bypasses storage.objects RLS
-- for the public CDN endpoint).

DROP POLICY IF EXISTS "Vault assets are publicly readable by path"
  ON storage.objects;

CREATE POLICY "Providers can list their own vault assets"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'vault-assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );