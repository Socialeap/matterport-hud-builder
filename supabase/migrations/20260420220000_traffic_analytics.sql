-- Add Google Analytics tracking ID to branding settings
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS ga_tracking_id text;

-- Page visits table for individualized MSP traffic analytics
CREATE TABLE IF NOT EXISTS public.page_visits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  referrer    text,
  user_agent  text,
  visited_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS page_visits_provider_id_idx ON public.page_visits (provider_id);
CREATE INDEX IF NOT EXISTS page_visits_visited_at_idx  ON public.page_visits (visited_at);

ALTER TABLE public.page_visits ENABLE ROW LEVEL SECURITY;

-- Providers can read their own visit data
CREATE POLICY "provider_select_own_visits"
  ON public.page_visits FOR SELECT
  USING (provider_id = auth.uid());

-- Anon/authenticated users can insert visits (public portal pages)
CREATE POLICY "insert_page_visits"
  ON public.page_visits FOR INSERT
  WITH CHECK (true);
