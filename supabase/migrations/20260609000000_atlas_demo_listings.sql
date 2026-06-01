-- ============================================================
-- Atlas PR-0 — admin-managed demo listing registry (atlas_demo_listings)
-- ------------------------------------------------------------
-- A lightweight, ADDITIVE registry of Frontiers3D-owned SAMPLE Atlas listings,
-- curated by an admin and shown on the public /atlas demo route. Each row points
-- at an externally/platform-hosted 3D presentation via `presentation_url`.
--
-- This is intentionally separate from (and simpler than) the future
-- `atlas_entries` canonical model, but field names are kept close so it can
-- migrate cleanly later. It does NOT touch agent_beacons, Map Oracle, outreach,
-- Stripe/Track A, or any existing table.
--
-- RLS: public can read ONLY active rows; admins (and service_role) manage all.
-- No verification tokens, no URL crawling, no CPC — out of scope for PR-0.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.atlas_demo_listings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,                      -- space / business name
  address           text,
  city              text,
  region            text,
  country           text DEFAULT 'US',
  latitude          numeric(9,6),                       -- map pin
  longitude         numeric(9,6),
  category          text NOT NULL DEFAULT 'other',      -- business / property type
  summary           text,                               -- short value copy
  presentation_url  text,                               -- hosted 3D presentation (≈ atlas_entries.canonical_url)
  hero_image_url    text,                               -- optional
  tags              text[] NOT NULL DEFAULT '{}',
  is_active         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Public discovery reads active rows ordered by sort_order.
CREATE INDEX IF NOT EXISTS idx_atlas_demo_listings_active_sort
  ON public.atlas_demo_listings (is_active, sort_order, created_at);

ALTER TABLE public.atlas_demo_listings ENABLE ROW LEVEL SECURITY;

-- Service role: full management.
DO $$ BEGIN
  CREATE POLICY "atlas_demo service role all"
    ON public.atlas_demo_listings FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admins: full management (create/edit/activate sample listings).
DO $$ BEGIN
  CREATE POLICY "atlas_demo admin all"
    ON public.atlas_demo_listings FOR ALL
    USING (public.has_role(auth.uid(), 'admin'))
    WITH CHECK (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Public (anon + authenticated): read ACTIVE rows only. No write path.
DO $$ BEGIN
  CREATE POLICY "atlas_demo public read active"
    ON public.atlas_demo_listings FOR SELECT
    USING (is_active = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Privileges (RLS still gates rows). anon: read only; authenticated: write gated
-- by the admin policy above; service_role: all.
GRANT SELECT ON public.atlas_demo_listings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.atlas_demo_listings TO authenticated;
GRANT ALL ON public.atlas_demo_listings TO service_role;

-- Keep updated_at fresh (reuses the existing shared trigger function).
DO $$ BEGIN
  CREATE TRIGGER trg_atlas_demo_listings_updated_at
    BEFORE UPDATE ON public.atlas_demo_listings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- End — atlas_demo_listings (additive, admin-managed, public-read-active).
-- ============================================================
