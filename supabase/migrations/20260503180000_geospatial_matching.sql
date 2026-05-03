-- ============================================================
-- 3DPS Marketplace v2 — PR1: Geospatial Matching
-- ------------------------------------------------------------
-- Replaces the v1 city-string matcher with a four-tier geo
-- predicate (polygon → radius → ZIP → trigram fuzzy city) that
-- eliminates the "St. Louis vs Saint Louis" miss and gives Pro
-- providers a real polygon-defined service area.
--
-- All schema changes are additive:
--   * new generated geometry columns on branding_settings and
--     agent_beacons (derived from the existing nullable
--     latitude/longitude / lat/lng numeric columns — one source of
--     truth, no dual-write drift);
--   * a new user-drawn polygon column on branding_settings (Pro
--     differentiator);
--   * GIST indexes on the geometry columns and a GIN/trigram index
--     on lower(primary_city) for the fuzzy fallback.
--
-- Existing callers (get_my_matched_beacons, search_msp_directory,
-- claim_pending_beacon_matches, is_provider_serving_location) keep
-- their signatures and are rewritten in place to use the new geo
-- predicate. Rows without geocoded points fall through to the
-- ZIP/trigram tiers, so the matcher keeps working without a
-- backfill — geocoding can be filled in lazily.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Extensions
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ------------------------------------------------------------
-- 2. branding_settings: geocoded_at, service_polygon, service_center
-- ------------------------------------------------------------
-- service_center is GENERATED ALWAYS from the pre-existing
-- latitude/longitude numeric columns. service_polygon is a regular
-- column (it's user-drawn in the Pro Service Area editor, not
-- derived from anything else).
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

-- Trigram index so the fuzzy city fallback ("St. Louis" ~
-- "Saint Louis") doesn't fall back to a sequential scan.
CREATE INDEX IF NOT EXISTS idx_branding_primary_city_trgm
  ON public.branding_settings
  USING GIN (lower(primary_city) gin_trgm_ops)
  WHERE is_directory_public = TRUE;

-- ------------------------------------------------------------
-- 3. agent_beacons: lat / lng / geocoded_at + beacon_point
-- ------------------------------------------------------------
-- Two ALTER statements: numeric columns must exist before the
-- generated column can reference them. Both are idempotent.
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

-- ------------------------------------------------------------
-- 4. _is_provider_serving_beacon (four-tier geo predicate)
-- ------------------------------------------------------------
-- Returns TRUE if the named provider serves the named beacon's
-- location via any of:
--
--   Tier 1: Pro polygon set AND beacon_point inside polygon
--   Tier 2: service_center + radius_miles set AND beacon_point
--           within radius (geography-based, distance in metres)
--   Tier 3: beacon.zip ∈ service_zips
--   Tier 4: similarity(lower(city)) > 0.75 (pg_trgm fuzzy match)
--
-- Tiers 2 and 4 enforce a region match when both sides set it,
-- so "Springfield, IL" can't match a Pro centered in
-- "Springfield, MO". Tier 1 is unconstrained because polygons
-- are explicitly drawn — if a Pro's polygon spans state lines
-- they meant it.
--
-- Implemented as a single SQL with EXISTS so the planner can
-- short-circuit on the first matching tier per provider row.
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
        -- Tier 1: Pro polygon containment (most precise)
        (
          bs.service_polygon IS NOT NULL
          AND b.beacon_point IS NOT NULL
          AND ST_Contains(bs.service_polygon, b.beacon_point)
        )
        -- Tier 2: radius around service_center
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
        -- Tier 3: explicit ZIP list (precise key, exact match)
        OR (
          b.zip IS NOT NULL
          AND b.zip = ANY(bs.service_zips)
        )
        -- Tier 4: trigram fuzzy city, region-guarded
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

-- ------------------------------------------------------------
-- 5. is_provider_serving_location (legacy 4-arg) — fuzzy upgrade
-- ------------------------------------------------------------
-- Existing callers don't have a beacon_id handy, so we can't run
-- the polygon/radius tiers from this signature. We CAN upgrade
-- the city tier from exact-match to trigram (the headline
-- correctness fix). ZIP-array logic is unchanged.
CREATE OR REPLACE FUNCTION public.is_provider_serving_location(
  p_provider_id UUID,
  p_city TEXT,
  p_region TEXT,
  p_zip TEXT
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
    WHERE bs.provider_id = p_provider_id
      AND bs.is_directory_public = TRUE
      AND (
        (
          p_city IS NOT NULL
          AND bs.primary_city IS NOT NULL
          AND similarity(lower(bs.primary_city), lower(p_city)) > 0.75
          AND (p_region IS NULL OR bs.region IS NULL OR bs.region = p_region)
        )
        OR (
          p_zip IS NOT NULL AND p_zip = ANY(bs.service_zips)
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_provider_serving_location(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_provider_serving_location(UUID, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 6. get_my_matched_beacons — same signature, geo-aware body
-- ------------------------------------------------------------
-- Thin wrapper: callers (the marketplace dashboard) keep their
-- existing call site. Auth/license gates and return shape are
-- unchanged from the consolidated v1 definition. Only the
-- WHERE-clause predicate changes — was a city/zip pair in the
-- function body, now is the four-tier geo predicate.
CREATE OR REPLACE FUNCTION public.get_my_matched_beacons()
RETURNS TABLE (
  id UUID,
  name TEXT,
  email TEXT,
  brokerage TEXT,
  city TEXT,
  region TEXT,
  zip TEXT,
  status public.beacon_status,
  created_at TIMESTAMPTZ,
  is_first_match_with_me BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE l.user_id = v_uid
      AND l.tier = 'pro'::public.app_tier
      AND l.license_status = 'active'::public.license_status
      AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'active pro license required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.name,
    b.email,
    b.brokerage,
    b.city,
    b.region,
    b.zip,
    b.status,
    b.created_at,
    (b.matched_provider_id = v_uid) AS is_first_match_with_me
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND public._is_provider_serving_beacon(v_uid, b.id)
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

-- ------------------------------------------------------------
-- 7. claim_pending_beacon_matches — geo-aware provider selection
-- ------------------------------------------------------------
-- Provider selection now uses the four-tier predicate. Concurrency
-- safety (FOR UPDATE SKIP LOCKED + ON CONFLICT DO NOTHING) and
-- the return shape are unchanged. Ranking remains
-- "Pro before Starter, oldest listing wins" — PR3 will plug in
-- the responsiveness score.
CREATE OR REPLACE FUNCTION public.claim_pending_beacon_matches(p_limit INT DEFAULT 10)
RETURNS TABLE (
  beacon_id UUID,
  beacon_email TEXT,
  beacon_name TEXT,
  beacon_city TEXT,
  beacon_region TEXT,
  provider_id UUID,
  provider_brand_name TEXT,
  provider_slug TEXT,
  provider_tier public.app_tier,
  provider_custom_domain TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_beacon RECORD;
  v_provider RECORD;
  v_inserted INT;
BEGIN
  FOR v_beacon IN
    SELECT b.id, b.email, b.name, b.city, b.region, b.zip
    FROM public.agent_beacons b
    WHERE b.status = 'waiting'
      AND b.expires_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM public.beacon_notifications n
        WHERE n.beacon_id = b.id AND n.kind = 'first_match'
      )
    ORDER BY b.created_at ASC
    FOR UPDATE OF b SKIP LOCKED
    LIMIT p_limit
  LOOP
    SELECT bs.provider_id, bs.brand_name, bs.slug, bs.tier, bs.custom_domain
    INTO v_provider
    FROM public.branding_settings bs
    WHERE bs.is_directory_public = TRUE
      AND public._is_provider_serving_beacon(bs.provider_id, v_beacon.id)
    ORDER BY
      CASE WHEN bs.tier = 'pro' THEN 0 ELSE 1 END,
      bs.created_at ASC NULLS LAST
    LIMIT 1;

    IF v_provider.provider_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.beacon_notifications (beacon_id, provider_id, kind)
    VALUES (v_beacon.id, v_provider.provider_id, 'first_match')
    ON CONFLICT (beacon_id, provider_id, kind) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.agent_beacons
    SET status = 'matched',
        matched_provider_id = v_provider.provider_id,
        matched_at = now()
    WHERE id = v_beacon.id;

    beacon_id := v_beacon.id;
    beacon_email := v_beacon.email;
    beacon_name := v_beacon.name;
    beacon_city := v_beacon.city;
    beacon_region := v_beacon.region;
    provider_id := v_provider.provider_id;
    provider_brand_name := v_provider.brand_name;
    provider_slug := v_provider.slug;
    provider_tier := v_provider.tier;
    provider_custom_domain := v_provider.custom_domain;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pending_beacon_matches(INT) TO service_role;

-- ------------------------------------------------------------
-- 8. search_msp_directory — fuzzy city, exact ZIP
-- ------------------------------------------------------------
-- Public discovery RPC. Trigram >0.75 absorbs typos and
-- "Saint vs St." aliasing. ZIPs stay exact-match — postcodes are
-- a precise key and fuzzy matching them would create false hits.
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
  SELECT
    bs.brand_name,
    bs.slug,
    bs.logo_url,
    bs.tier,
    bs.specialties,
    bs.primary_city,
    bs.region
  FROM public.branding_settings bs
  WHERE bs.is_directory_public = TRUE
    AND bs.primary_city IS NOT NULL
    AND (
      (
        (p_city IS NULL OR length(trim(p_city)) = 0)
        AND (p_zip IS NULL OR length(trim(p_zip)) = 0)
      )
      OR (
        p_city IS NOT NULL
        AND length(trim(p_city)) > 0
        AND similarity(lower(bs.primary_city), lower(trim(p_city))) > 0.75
      )
      OR (
        p_zip IS NOT NULL
        AND length(trim(p_zip)) > 0
        AND trim(p_zip) = ANY(bs.service_zips)
      )
    )
  ORDER BY (bs.tier = 'pro') DESC, bs.brand_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 9. set_my_service_polygon (Pro-only)
-- ------------------------------------------------------------
-- Lets the calling provider write or clear their service-area
-- polygon without us having to expose geometry-column writes
-- through Postgrest. Pass NULL to clear; pass a GeoJSON Polygon
-- (as jsonb) to set.
--
-- Server-side validation:
--   * caller must be authenticated and have provider role
--   * caller must hold an active Pro license (polygon UI is the
--     paid differentiator)
--   * coordinates must parse via ST_GeomFromGeoJSON; SRID is
--     forced to 4326 so client-supplied SRID can't poison the
--     geometry
--   * polygon must be valid (ST_IsValid) — degenerate / self-
--     intersecting input is rejected with a clean error rather
--     than silently stored
CREATE OR REPLACE FUNCTION public.set_my_service_polygon(
  p_geojson jsonb DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_geom geometry(Polygon, 4326);
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_role(v_uid, 'provider'::public.app_role) THEN
    RAISE EXCEPTION 'provider role required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.licenses l
    WHERE l.user_id = v_uid
      AND l.tier = 'pro'::public.app_tier
      AND l.license_status = 'active'::public.license_status
      AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'active pro license required' USING ERRCODE = '42501';
  END IF;

  IF p_geojson IS NULL THEN
    UPDATE public.branding_settings
       SET service_polygon = NULL
     WHERE provider_id = v_uid;
    RETURN TRUE;
  END IF;

  BEGIN
    v_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid geojson polygon' USING ERRCODE = '22023';
  END;

  IF GeometryType(v_geom) <> 'POLYGON' THEN
    RAISE EXCEPTION 'geometry must be a Polygon' USING ERRCODE = '22023';
  END IF;
  IF NOT ST_IsValid(v_geom) THEN
    RAISE EXCEPTION 'polygon is not valid' USING ERRCODE = '22023';
  END IF;

  UPDATE public.branding_settings
     SET service_polygon = v_geom
   WHERE provider_id = v_uid;

  RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_my_service_polygon(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_service_polygon(jsonb) TO authenticated;

-- ------------------------------------------------------------
-- 10. get_my_service_polygon
-- ------------------------------------------------------------
-- Returns the caller's polygon as GeoJSON. The polygon column
-- is a geometry type that Postgrest doesn't render natively, so
-- we ship a typed accessor that hands back ready-to-render JSON.
CREATE OR REPLACE FUNCTION public.get_my_service_polygon()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN bs.service_polygon IS NULL THEN NULL
      ELSE ST_AsGeoJSON(bs.service_polygon)::jsonb
    END
  FROM public.branding_settings bs
  WHERE bs.provider_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_service_polygon() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_service_polygon() TO authenticated;

-- ============================================================
-- End of geospatial matching migration
-- ============================================================
