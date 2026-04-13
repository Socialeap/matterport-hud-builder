
CREATE POLICY "Users can insert their own purchases"
ON public.purchases
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id AND environment = 'sandbox');
