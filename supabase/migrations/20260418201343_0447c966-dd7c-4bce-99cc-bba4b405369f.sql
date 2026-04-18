-- Create sandbox_demos table — one canonical demo per provider
CREATE TABLE public.sandbox_demos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL UNIQUE,
  is_published boolean NOT NULL DEFAULT false,
  brand_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  properties jsonb NOT NULL DEFAULT '[]'::jsonb,
  behaviors jsonb NOT NULL DEFAULT '{}'::jsonb,
  agent jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sandbox_demos ENABLE ROW LEVEL SECURITY;

-- Providers: full CRUD on their own row
CREATE POLICY "Providers manage their own demo"
  ON public.sandbox_demos
  FOR ALL
  TO authenticated
  USING (auth.uid() = provider_id)
  WITH CHECK (auth.uid() = provider_id);

-- Public (anon + authenticated): read only when published
CREATE POLICY "Anyone can view published demos"
  ON public.sandbox_demos
  FOR SELECT
  TO anon, authenticated
  USING (is_published = true);

-- updated_at trigger
CREATE TRIGGER update_sandbox_demos_updated_at
  BEFORE UPDATE ON public.sandbox_demos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Index for slug-based lookups via branding_settings join
CREATE INDEX idx_sandbox_demos_provider_published
  ON public.sandbox_demos (provider_id, is_published);