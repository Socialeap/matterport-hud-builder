
-- Storage policies for brand-assets bucket
CREATE POLICY "Public read access for brand-assets"
ON storage.objects
FOR SELECT
USING (bucket_id = 'brand-assets');

CREATE POLICY "Authenticated users can upload to own folder"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'brand-assets'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Authenticated users can update own files"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'brand-assets'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Authenticated users can delete own files"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'brand-assets'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
