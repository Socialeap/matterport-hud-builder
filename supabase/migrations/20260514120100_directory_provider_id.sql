-- =============================================================================
-- Add provider_id to search_msp_directory results
-- =============================================================================
-- The new "Request Availability from This MSP" direct-discovery flow on
-- /agents needs the provider's UUID to invoke submit_work_order(...). The
-- directory is already public (is_directory_public = TRUE), and provider_ids
-- are already exposed via get_service_match_results, so returning them here
-- is consistent with existing surface area.
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_msp_directory(TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION public.search_msp_directory(
  p_city   TEXT             DEFAULT NULL,
  p_region TEXT             DEFAULT NULL,
  p_zip    TEXT             DEFAULT NULL,
  p_lat    DOUBLE PRECISION DEFAULT NULL,
  p_lng    DOUBLE PRECISION DEFAULT NULL
)
RETURNS TABLE (
  provider_id  UUID,
  brand_name   TEXT,
  slug         TEXT,
  logo_url     TEXT,
  tier         public.app_tier,
  specialties  public.marketplace_specialty[],
  primary_city TEXT,
  region       TEXT,
  match_reason TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH q AS (
    SELECT
      NULLIF(trim(coalesce(p_city, '')),   '')                 AS city_q,
      upper(NULLIF(trim(coalesce(p_region, '')), ''))           AS region_q,
      NULLIF(trim(coalesce(p_zip, '')),    '')                 AS zip_q,
      CASE
        WHEN p_lat IS NULL OR p_lng IS NULL THEN NULL
        ELSE ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)
      END                                                       AS pt
  ),
  scored AS (
    SELECT
      bs.provider_id,
      bs.brand_name,
      bs.slug,
      bs.logo_url,
      bs.tier,
      bs.specialties,
      bs.primary_city,
      bs.region,
      CASE
        WHEN q.pt IS NOT NULL
             AND bs.service_polygon IS NOT NULL
             AND ST_Contains(bs.service_polygon, q.pt)
          THEN 'polygon'
        WHEN q.pt IS NOT NULL
             AND bs.service_center IS NOT NULL
             AND bs.service_radius_miles IS NOT NULL
             AND ST_DWithin(
               bs.service_center::geography,
               q.pt::geography,
               bs.service_radius_miles * 1609.34
             )
          THEN 'radius'
        WHEN q.zip_q IS NOT NULL
             AND q.zip_q = ANY(bs.service_zips)
          THEN 'zip'
        WHEN q.city_q IS NOT NULL
             AND similarity(lower(bs.primary_city), lower(q.city_q)) > 0.75
          THEN 'city'
        ELSE NULL
      END AS match_reason
    FROM public.branding_settings bs
    CROSS JOIN q
    WHERE bs.is_directory_public = TRUE
      AND bs.primary_city IS NOT NULL
      AND (
        (q.city_q IS NULL AND q.zip_q IS NULL AND q.pt IS NULL)
        OR (
          (
            q.pt IS NOT NULL
            AND bs.service_polygon IS NOT NULL
            AND ST_Contains(bs.service_polygon, q.pt)
          )
          OR (
            q.pt IS NOT NULL
            AND bs.service_center IS NOT NULL
            AND bs.service_radius_miles IS NOT NULL
            AND ST_DWithin(
              bs.service_center::geography,
              q.pt::geography,
              bs.service_radius_miles * 1609.34
            )
          )
          OR (q.zip_q IS NOT NULL AND q.zip_q = ANY(bs.service_zips))
          OR (
            q.city_q IS NOT NULL
            AND similarity(lower(bs.primary_city), lower(q.city_q)) > 0.75
          )
        )
      )
      AND (
        (SELECT region_q FROM q) IS NULL
        OR bs.region IS NULL
        OR bs.region = (SELECT region_q FROM q)
      )
  )
  SELECT
    provider_id,
    brand_name,
    slug,
    logo_url,
    tier,
    specialties,
    primary_city,
    region,
    match_reason
  FROM scored
  ORDER BY
    CASE match_reason
      WHEN 'polygon' THEN 1
      WHEN 'radius'  THEN 2
      WHEN 'zip'     THEN 3
      WHEN 'city'    THEN 4
      ELSE 5
    END,
    (tier = 'pro') DESC,
    brand_name ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.search_msp_directory(TEXT, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated;
