
-- Allow authenticated users to insert their own client_providers link
CREATE POLICY "Users can insert their own client_provider link"
  ON public.client_providers
  FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());
