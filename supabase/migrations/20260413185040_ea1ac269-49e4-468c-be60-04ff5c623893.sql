-- Table for tracking one-time tier purchases
CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  stripe_session_id text NOT NULL UNIQUE,
  stripe_customer_id text,
  product_id text NOT NULL,
  price_id text NOT NULL,
  amount_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'completed',
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchases_user_id ON public.purchases(user_id);

ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own purchases"
  ON public.purchases FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage purchases"
  ON public.purchases FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger for updated_at
CREATE TRIGGER update_purchases_updated_at
  BEFORE UPDATE ON public.purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Helper function to check if a user has purchased a specific tier
CREATE OR REPLACE FUNCTION public.get_user_tier(user_uuid uuid, check_env text DEFAULT 'live')
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.purchases
      WHERE user_id = user_uuid
      AND environment = check_env
      AND status = 'completed'
      AND product_id = 'pro_tier'
    ) THEN 'pro'
    WHEN EXISTS (
      SELECT 1 FROM public.purchases
      WHERE user_id = user_uuid
      AND environment = check_env
      AND status = 'completed'
      AND product_id = 'pro_upgrade'
    ) THEN 'pro'
    WHEN EXISTS (
      SELECT 1 FROM public.purchases
      WHERE user_id = user_uuid
      AND environment = check_env
      AND status = 'completed'
      AND product_id = 'starter_tier'
    ) THEN 'starter'
    ELSE NULL
  END
$$;