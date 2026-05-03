-- =============================================================
-- Marketplace foundation + discovery + matching (consolidated)
-- Replaces the never-applied 20260503* migrations with a single
-- idempotent setup that ships the NEW two-group service taxonomy.
-- =============================================================

-- 1. New marketplace_specialty enum (two groups: scanning + studio)
DO $$ BEGIN
  CREATE TYPE public.marketplace_specialty AS ENUM (
    -- On-site scanning services
    'scan-matterport-pro3',
    'scan-drone-aerial',
    'scan-twilight-photography',
    'scan-floor-plans',
    'scan-dimensional-measurements',
    'scan-same-day-turnaround',
    -- Studio / Production Vault services
    'vault-sound-library',
    'vault-portal-filters',
    'vault-interactive-widgets',
    'vault-custom-icons',
    'vault-property-mapper',
    'ai-lead-generation'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. branding_settings: marketplace listing columns
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS primary_city TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS service_radius_miles INTEGER,
  ADD COLUMN IF NOT EXISTS service_zips TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS is_directory_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS specialties public.marketplace_specialty[]
    NOT NULL DEFAULT '{}'::public.marketplace_specialty[];

DO $$ BEGIN
  ALTER TABLE public.branding_settings
    ADD CONSTRAINT branding_service_radius_positive
    CHECK (service_radius_miles IS NULL OR service_radius_miles > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.branding_settings
    ADD CONSTRAINT branding_country_iso2
    CHECK (country ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_branding_directory_public
  ON public.branding_settings (is_directory_public)
  WHERE is_directory_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_branding_primary_city
  ON public.branding_settings (lower(primary_city), lower(region))
  WHERE is_directory_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_branding_service_zips
  ON public.branding_settings USING GIN (service_zips)
  WHERE is_directory_public = TRUE;

-- 3. Beacon status enum + agent_beacons table
DO $$ BEGIN
  CREATE TYPE public.beacon_status AS ENUM (
    'waiting', 'matched', 'unsubscribed', 'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_beacons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT,
  brokerage TEXT,
  city TEXT NOT NULL,
  region TEXT,
  zip TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  consent_given BOOLEAN NOT NULL,
  consent_text TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip TEXT,
  user_agent TEXT,
  status public.beacon_status NOT NULL DEFAULT 'waiting',
  matched_provider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_beacons_email_city_unique
  ON public.agent_beacons (lower(email), lower(city));
CREATE INDEX IF NOT EXISTS idx_agent_beacons_status_city
  ON public.agent_beacons (status, lower(city));
CREATE INDEX IF NOT EXISTS idx_agent_beacons_zip
  ON public.agent_beacons (zip) WHERE zip IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_beacons_expires
  ON public.agent_beacons (expires_at) WHERE status = 'waiting';

DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    ADD CONSTRAINT agent_beacons_country_us_only CHECK (country = 'US');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    ADD CONSTRAINT agent_beacons_consent_required
    CHECK (consent_given = TRUE AND length(consent_text) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_agent_beacons_updated_at
    BEFORE UPDATE ON public.agent_beacons
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.agent_beacons ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role can manage beacons" ON public.agent_beacons
    FOR ALL USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Admins can read beacons" ON public.agent_beacons
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 4. beacon_notifications (matcher idempotency)
CREATE TABLE IF NOT EXISTS public.beacon_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('first_match', 'reengagement')),
  email_send_log_id UUID REFERENCES public.email_send_log(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (beacon_id, provider_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_beacon_notifications_beacon ON public.beacon_notifications (beacon_id);
CREATE INDEX IF NOT EXISTS idx_beacon_notifications_provider ON public.beacon_notifications (provider_id);
ALTER TABLE public.beacon_notifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Service role can manage beacon_notifications" ON public.beacon_notifications
    FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE POLICY "Admins can read beacon_notifications" ON public.beacon_notifications
    FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 5. Backfill branding_settings rows for existing self-signup users
INSERT INTO public.branding_settings (provider_id)
SELECT u.id FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE COALESCE(p.provider_id, NULL) IS NULL
ON CONFLICT (provider_id) DO NOTHING;

-- 6. Public discovery RPCs
CREATE OR REPLACE FUNCTION public.search_msp_directory(
  p_city TEXT DEFAULT NULL,
  p_zip  TEXT DEFAULT NULL
) RETURNS TABLE (
  brand_name TEXT,
  slug TEXT,
  logo_url TEXT,
  tier public.app_tier,
  specialties public.marketplace_specialty[],
  primary_city TEXT,
  region TEXT
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT bs.brand_name, bs.slug, bs.logo_url, bs.tier,
         bs.specialties, bs.primary_city, bs.region
    FROM public.branding_settings bs
   WHERE bs.is_directory_public = TRUE
     AND bs.primary_city IS NOT NULL
     AND (
       (p_city IS NULL AND p_zip IS NULL)
       OR (p_city IS NOT NULL AND lower(bs.primary_city) = lower(trim(p_city)))
       OR (p_zip  IS NOT NULL AND trim(p_zip) = ANY(bs.service_zips))
     )
   ORDER BY (bs.tier = 'pro') DESC, bs.brand_name ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.public_beacon_demand()
RETURNS TABLE (city TEXT, region TEXT, waiting_count BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT initcap(lower(b.city)) AS city, b.region, count(*)::BIGINT AS waiting_count
    FROM public.agent_beacons b
   WHERE b.status = 'waiting' AND b.expires_at > now()
   GROUP BY lower(b.city), b.region
  HAVING count(*) >= 3
   ORDER BY count(*) DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.public_beacon_demand() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_beacon_demand() TO anon, authenticated;

-- 7. Matched-beacons RPC (Pro-gated)
CREATE OR REPLACE FUNCTION public.get_my_matched_beacons()
RETURNS TABLE (
  id UUID, name TEXT, email TEXT, brokerage TEXT,
  city TEXT, region TEXT, zip TEXT,
  status public.beacon_status, created_at TIMESTAMPTZ,
  is_first_match_with_me BOOLEAN
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.licenses l
     WHERE l.user_id = v_uid AND l.tier = 'pro'::public.app_tier
       AND l.license_status = 'active'::public.license_status
       AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'active pro license required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT b.id, b.name, b.email, b.brokerage,
           b.city, b.region, b.zip, b.status, b.created_at,
           (b.matched_provider_id = v_uid) AS is_first_match_with_me
      FROM public.agent_beacons b
      JOIN public.branding_settings bs ON bs.provider_id = v_uid
     WHERE bs.is_directory_public = TRUE
       AND b.status IN ('waiting', 'matched')
       AND b.expires_at > now()
       AND (
         (bs.primary_city IS NOT NULL AND lower(bs.primary_city) = lower(b.city))
         OR (b.zip IS NOT NULL AND b.zip = ANY(bs.service_zips))
       )
     ORDER BY b.created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;
