
-- Allow anonymous users to read branding_settings by slug (for public portal)
CREATE POLICY "Anyone can view branding by slug"
  ON public.branding_settings
  FOR SELECT
  TO anon, authenticated
  USING (slug IS NOT NULL);
