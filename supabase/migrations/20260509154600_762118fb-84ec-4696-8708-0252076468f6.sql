-- Restore geospatial matching dependencies for MSP Service Match
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- branding_settings: geocode + service area
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS service_polygon geometry(Polygon, 4326);

ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS service_center geometry(Point, 4326)
    GENERATED ALWAYS AS (
      CASE
        WHEN latitude IS NOT NULL AND longitude IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
        ELSE NULL
      END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_branding_service_center_gix
  ON public.branding_settings USING GIST (service_center)
  WHERE service_center IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branding_service_polygon_gix
  ON public.branding_settings USING GIST (service_polygon)
  WHERE service_polygon IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_branding_primary_city_trgm
  ON public.branding_settings
  USING GIN (lower(primary_city) gin_trgm_ops)
  WHERE is_directory_public = TRUE;

-- agent_beacons: geocode point
ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS lat NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS lng NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMPTZ;

ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS beacon_point geometry(Point, 4326)
    GENERATED ALWAYS AS (
      CASE
        WHEN lat IS NOT NULL AND lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
        ELSE NULL
      END
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_point_gix
  ON public.agent_beacons USING GIST (beacon_point)
  WHERE beacon_point IS NOT NULL;

-- _is_provider_serving_beacon: four-tier geo predicate
CREATE OR REPLACE FUNCTION public._is_provider_serving_beacon(
  p_provider_id UUID,
  p_beacon_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.branding_settings bs
    JOIN public.agent_beacons b ON b.id = p_beacon_id
    WHERE bs.provider_id = p_provider_id
      AND bs.is_directory_public = TRUE
      AND (
        (
          bs.service_polygon IS NOT NULL
          AND b.beacon_point IS NOT NULL
          AND ST_Contains(bs.service_polygon, b.beacon_point)
        )
        OR (
          bs.service_center IS NOT NULL
          AND b.beacon_point IS NOT NULL
          AND bs.service_radius_miles IS NOT NULL
          AND ST_DWithin(
            bs.service_center::geography,
            b.beacon_point::geography,
            bs.service_radius_miles * 1609.34
          )
          AND (b.region IS NULL OR bs.region IS NULL OR bs.region = b.region)
        )
        OR (
          b.zip IS NOT NULL
          AND b.zip = ANY(bs.service_zips)
        )
        OR (
          bs.primary_city IS NOT NULL
          AND b.city IS NOT NULL
          AND similarity(lower(bs.primary_city), lower(b.city)) > 0.75
          AND (b.region IS NULL OR bs.region IS NULL OR bs.region = b.region)
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public._is_provider_serving_beacon(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_provider_serving_beacon(UUID, UUID)
  TO authenticated, service_role;
