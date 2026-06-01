-- Atlas PR-0 — admin-managed demo listing registry (atlas_demo_listings)
CREATE TABLE IF NOT EXISTS public.atlas_demo_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  address           text,
  city              text,
  region            text,
  country           text DEFAULT 'US',
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  category          text NOT NULL DEFAULT 'other',
  summary           text,
  presentation_url  text,
  hero_image_url    text,
  tags              text[] NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_atlas_demo_listings_active_sort
  ON public.atlas_demo_listings (is_active, sort_order, created_at);

GRANT SELECT ON public.atlas_demo_listings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.atlas_demo_listings TO authenticated;
GRANT ALL ON public.atlas_demo_listings TO service_role;

ALTER TABLE public.atlas_demo_listings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "atlas_demo service role all"
    ON public.atlas_demo_listings FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "atlas_demo admin all"
    ON public.atlas_demo_listings FOR ALL
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "atlas_demo public read active"
    ON public.atlas_demo_listings FOR SELECT
    USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_atlas_demo_listings_updated_at
    BEFORE UPDATE ON public.atlas_demo_listings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;