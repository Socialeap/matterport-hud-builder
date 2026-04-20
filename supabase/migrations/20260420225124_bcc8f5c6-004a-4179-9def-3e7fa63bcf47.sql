-- Add Google Analytics tracking ID to branding_settings
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS ga_tracking_id text;

-- Create page_visits table
CREATE TABLE IF NOT EXISTS public.page_visits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_id uuid NOT NULL,
  slug text NOT NULL,
  referrer text,
  user_agent text,
  visited_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_visits_provider_id ON public.page_visits(provider_id);
CREATE INDEX IF NOT EXISTS idx_page_visits_visited_at ON public.page_visits(visited_at DESC);

ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can record a visit
CREATE POLICY "Anyone can record a page visit"
  ON public.page_visits
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Providers can read their own visit records
CREATE POLICY "Providers can view their own page visits"
  ON public.page_visits
  FOR SELECT
  TO authenticated
  USING (auth.uid() = provider_id);
