-- ============================================================
-- 3DPS Marketplace — Public Discovery Surfaces (PR 2)
-- ------------------------------------------------------------
-- Adds two SECURITY DEFINER RPCs that power the public-facing
-- discovery routes:
--
--   1. search_msp_directory(p_city, p_zip)
--      Powers /agents (formerly /find-a-studio in the spec).
--      Returns only safe public columns from branding_settings.
--      Exact-text city match (case-insensitive) and/or
--      array-containment zip match. No geocoding yet.
--
--   2. public_beacon_demand()
--      Powers /opportunities. Returns aggregate (city, region,
--      waiting_count) tuples with a >= 3 threshold so a single
--      stale beacon can't make a market look thin. Status filter:
--      only 'waiting' beacons whose expires_at is in the future.
--
-- Both are SECURITY DEFINER + STABLE so anonymous visitors can
-- consume them via RPC without granting public SELECT on the
-- underlying tables. Provider PII (email/brokerage/etc.) is never
-- returned by either function.
-- ============================================================

-- ------------------------------------------------------------
-- 1. search_msp_directory
-- ------------------------------------------------------------
-- Empty/whitespace inputs are treated as "no filter on that
-- dimension" so callers can search by city OR zip OR both.
-- If both are empty the function returns the entire public
-- directory (caller is expected to gate this UX-side).
CREATE OR REPLACE FUNCTION public.search_msp_directory(
  p_city TEXT DEFAULT NULL,
  p_zip TEXT DEFAULT NULL
)
RETURNS TABLE (
  brand_name TEXT,
  slug TEXT,
  logo_url TEXT,
  tier public.app_tier,
  specialties public.marketplace_specialty[],
  primary_city TEXT,
  region TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
    AND bs.region IS NOT NULL
    -- City filter: case-insensitive exact match (per agreed scope:
    -- exact city match for v1, no fuzzy / no geocoding).
    AND (
      p_city IS NULL
      OR length(trim(p_city)) = 0
      OR lower(bs.primary_city) = lower(trim(p_city))
    )
    -- Zip filter: array containment.
    AND (
      p_zip IS NULL
      OR length(trim(p_zip)) = 0
      OR trim(p_zip) = ANY(bs.service_zips)
    )
  ORDER BY
    -- Pro listings ranked first as a quality signal, then by brand name.
    CASE WHEN bs.tier = 'pro' THEN 0 ELSE 1 END,
    bs.brand_name ASC
$$;

REVOKE EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. public_beacon_demand
-- ------------------------------------------------------------
-- Threshold is intentionally hardcoded at 3 — below that the
-- numbers feel thin and harm conversion on /opportunities.
-- Cities are normalized to "Title Case" for display; grouping
-- is on (lower(city), region) so "atlanta" and "Atlanta" merge.
CREATE OR REPLACE FUNCTION public.public_beacon_demand()
RETURNS TABLE (
  city TEXT,
  region TEXT,
  waiting_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    initcap(lower(b.city)) AS city,
    b.region,
    count(*)::bigint AS waiting_count
  FROM public.agent_beacons b
  WHERE b.status = 'waiting'
    AND b.expires_at > now()
  GROUP BY initcap(lower(b.city)), b.region
  HAVING count(*) >= 3
  ORDER BY count(*) DESC, initcap(lower(b.city)) ASC
$$;

REVOKE EXECUTE ON FUNCTION public.public_beacon_demand() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_beacon_demand() TO anon, authenticated;

-- ============================================================
-- End of public discovery surfaces migration
-- ============================================================
