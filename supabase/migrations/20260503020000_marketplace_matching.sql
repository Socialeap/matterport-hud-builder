-- ============================================================
-- 3DPS Marketplace — Matching Engine (PR 3)
-- ------------------------------------------------------------
-- Adds the core matcher and the provider-facing access RPC.
-- Triggering is event-driven (called from capture-beacon and the
-- branding save flow) — no pg_cron yet, no geocoding.
--
-- Functions added:
--   1. is_provider_serving_location(provider_id, city, region, zip)
--      Boolean helper used by both the matcher and the RPC.
--
--   2. get_my_matched_beacons()
--      Provider-callable RPC. Returns beacons in the caller's
--      service area, gated on active Pro license. PII included
--      (email, name, brokerage) so the MSP can reach out.
--
--   3. claim_pending_beacon_matches(p_limit)
--      Atomic matcher: picks `waiting` beacons that have no
--      `first_match` notification yet, finds the best provider
--      (Pro-preferred, oldest listing wins), inserts the
--      idempotency row, flips beacon to `matched`, returns the
--      claimed pairs for the caller to send emails on.
--
-- Out of scope (later PR):
--   * Day-90 re-engagement (cron + template)
--   * Weekly MSP digest (cron + template)
--   * pg_cron driver — current model is event-driven only
-- ============================================================

-- ------------------------------------------------------------
-- 1. is_provider_serving_location
-- ------------------------------------------------------------
-- Mirrors the matcher's eligibility logic in a single boolean
-- expression so we can reuse it from RLS-style guards and from
-- ad-hoc admin queries. Considers:
--   * MSP must have is_directory_public = TRUE
--   * Either (city AND region match) OR zip-in-array match
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
          AND lower(bs.primary_city) = lower(p_city)
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
-- 2. get_my_matched_beacons
-- ------------------------------------------------------------
-- Returns beacons in the caller's service area. Caller MUST be:
--   * authenticated
--   * a provider (has_role('provider'))
--   * holding an active Pro license
--
-- Rejected with a clean RAISE so the client can show a helpful
-- message rather than getting a generic 401.
--
-- The `is_first_match_with_me` flag tells the UI which beacons
-- this provider was the first emailer for vs ones where another
-- Pro got the agent first. Both kinds are visible (multi-MSP
-- per city is the agreed model) — this is just for display.
CREATE OR REPLACE FUNCTION public.get_my_matched_beacons()
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  brokerage TEXT,
  city TEXT,
  region TEXT,
  zip TEXT,
  status public.beacon_status,
  is_first_match_with_me BOOLEAN,
  created_at TIMESTAMPTZ,
  matched_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT public.has_role(v_caller, 'provider') THEN
    RAISE EXCEPTION 'Provider role required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.licenses l
    WHERE l.user_id = v_caller
      AND l.tier = 'pro'
      AND l.license_status = 'active'
      AND (l.license_expiry IS NULL OR l.license_expiry > now())
  ) THEN
    RAISE EXCEPTION 'Active Pro license required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    b.id,
    b.email,
    b.name,
    b.brokerage,
    b.city,
    b.region,
    b.zip,
    b.status,
    EXISTS (
      SELECT 1 FROM public.beacon_notifications n
      WHERE n.beacon_id = b.id
        AND n.provider_id = v_caller
        AND n.kind = 'first_match'
    ) AS is_first_match_with_me,
    b.created_at,
    b.matched_at
  FROM public.agent_beacons b
  WHERE b.status IN ('waiting', 'matched')
    AND b.expires_at > now()
    AND public.is_provider_serving_location(v_caller, b.city, b.region, b.zip)
  ORDER BY b.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_my_matched_beacons() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_matched_beacons() TO authenticated;

-- ------------------------------------------------------------
-- 3. claim_pending_beacon_matches
-- ------------------------------------------------------------
-- Atomically claims up to `p_limit` waiting beacons that have no
-- `first_match` notification yet. For each, picks the best
-- provider (Pro-tier preferred, oldest listing wins), inserts
-- the notification row, flips beacon to 'matched'.
--
-- Concurrency safety:
--   * FOR UPDATE OF agent_beacons SKIP LOCKED on the outer scan
--     prevents two parallel matcher runs from picking the same
--     beacon.
--   * INSERT ... ON CONFLICT DO NOTHING on beacon_notifications
--     is a belt-and-braces guard; FOUND tells us whether we
--     actually claimed.
--   * The whole function runs in a single implicit transaction
--     because we never call COMMIT.
--
-- Service-role only: this is the matcher's atomic claim engine.
-- Callers must be the match-beacons Edge Function.
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
  v_inserted BOOLEAN;
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
    -- Pick the best matching provider: Pro before Starter, then oldest
    -- listing first (proxy for "most established in the area").
    SELECT bs.provider_id, bs.brand_name, bs.slug, bs.tier, bs.custom_domain
    INTO v_provider
    FROM public.branding_settings bs
    WHERE bs.is_directory_public = TRUE
      AND (
        (
          bs.primary_city IS NOT NULL
          AND lower(bs.primary_city) = lower(v_beacon.city)
          AND (v_beacon.region IS NULL OR bs.region IS NULL OR bs.region = v_beacon.region)
        )
        OR (
          v_beacon.zip IS NOT NULL AND v_beacon.zip = ANY(bs.service_zips)
        )
      )
    ORDER BY
      CASE WHEN bs.tier = 'pro' THEN 0 ELSE 1 END,
      bs.created_at ASC NULLS LAST
    LIMIT 1;

    -- No matching provider yet — leave the beacon in 'waiting'.
    IF v_provider.provider_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Atomic claim. ON CONFLICT skips when a parallel run beat us.
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

    -- Yield this matched pair for the caller to email on.
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

-- ============================================================
-- End of matching engine migration
-- ============================================================
