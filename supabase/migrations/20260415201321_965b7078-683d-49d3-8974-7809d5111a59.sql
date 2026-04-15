CREATE POLICY "Providers can view linked client profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_providers cp
      WHERE cp.provider_id = auth.uid()
      AND cp.client_id = profiles.user_id
    )
  );