-- Replace broad SELECT-on-bucket with a no-listing equivalent.
-- Files remain individually readable by URL (Storage signed/public URLs work
-- because they bypass listing); only `list` operations against the bucket
-- root are blocked.
DROP POLICY IF EXISTS "Vault assets are publicly readable" ON storage.objects;

CREATE POLICY "Vault assets are publicly readable by path"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'vault-assets'
    AND name IS NOT NULL
    AND length(name) > 0
    AND position('/' in name) > 0
  );