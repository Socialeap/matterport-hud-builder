-- ============================================================
-- Frontiers3D — Track B / B2: Doorway Candidates (property-centric)
-- ============================================================

CREATE OR REPLACE FUNCTION public._compose_hero_summary(p_property_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing       TEXT;
  v_name           TEXT;
  v_category_raw   TEXT;
  v_category       TEXT;
  v_locality       TEXT;
  v_review_text    TEXT;
  v_review_snippet TEXT;
BEGIN
  SELECT hero_summary, name, primary_category, locality
    INTO v_existing, v_name, v_category_raw, v_locality
    FROM public.properties
   WHERE id = p_property_id;

  IF v_existing IS NOT NULL AND btrim(v_existing) <> '' THEN
    RETURN v_existing;
  END IF;

  IF v_category_raw IS NOT NULL THEN
    v_category := initcap(replace(v_category_raw, '_', ' '));
  END IF;

  SELECT btrim(r->>'text')
    INTO v_review_text
    FROM public.property_review_summaries prs,
         LATERAL jsonb_array_elements(COALESCE(prs.reviews_sample, '[]'::jsonb)) AS r
   WHERE prs.property_id = p_property_id
     AND r->>'text' IS NOT NULL
     AND btrim(r->>'text') <> ''
   ORDER BY COALESCE(public._safe_integer(r->'rating'), 0) DESC,
            COALESCE((r->>'time')::bigint, 0) DESC
   LIMIT 1;

  IF v_review_text IS NOT NULL THEN
    v_review_snippet := substring(
      regexp_replace(v_review_text, E'[\r\n]+', ' ', 'g')
      FROM 1 FOR 140
    );
    IF length(v_review_text) > 140 THEN
      v_review_snippet := substring(v_review_snippet FROM 1 FOR 120) || '…';
    END IF;
  END IF;

  RETURN CASE
    WHEN v_category IS NOT NULL AND v_locality IS NOT NULL AND v_review_snippet IS NOT NULL
      THEN format('%s in %s. "%s"', v_category, v_locality, v_review_snippet)
    WHEN v_category IS NOT NULL AND v_locality IS NOT NULL
      THEN format('%s in %s', v_category, v_locality)
    WHEN v_category IS NOT NULL
      THEN v_category
    WHEN v_locality IS NOT NULL
      THEN format('%s in %s', v_name, v_locality)
    ELSE v_name
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._compose_hero_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._compose_hero_summary(UUID) TO service_role;


CREATE OR REPLACE FUNCTION public.compose_doorway_payload(p_property_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  WITH
  p AS (
    SELECT id, google_place_id, name, formatted_address, locality,
           administrative_area, country_code, postal_code,
           primary_category, google_types, business_status,
           rating, user_ratings_total, price_level, primary_photo_url
      FROM public.properties
     WHERE id = p_property_id
  ),
  g AS (
    SELECT latitude, longitude, viewport, plus_code, timezone
      FROM public.property_geo WHERE property_id = p_property_id
  ),
  c AS (
    SELECT phone_e164, phone_display, website_url, email
      FROM public.property_contacts WHERE property_id = p_property_id
  ),
  e AS (
    SELECT estimated_employees, estimated_annual_revenue_usd, domain,
           social_links, tech_stack, signals, enrichment_source, enriched_at
      FROM public.property_enrichment WHERE property_id = p_property_id
  ),
  h AS (
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'day', day_of_week,
               'opens_at', to_char(opens_at, 'HH24:MI'),
               'closes_at', to_char(closes_at, 'HH24:MI'),
               'is_24h', is_24h, 'is_closed', is_closed, 'raw', raw_text
             ) ORDER BY day_of_week NULLS FIRST
           ), '[]'::jsonb) AS hours
      FROM public.property_hours WHERE property_id = p_property_id
  ),
  ph AS (
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'cdn_url', cdn_url, 'source_ref', source_photo_ref,
               'width', width, 'height', height, 'attribution', attribution
             ) ORDER BY ordinal
           ), '[]'::jsonb) AS photos
      FROM (
        SELECT * FROM public.property_photos
         WHERE property_id = p_property_id ORDER BY ordinal LIMIT 5
      ) capped
  ),
  r AS (
    SELECT reviews_sample, recent_review_velocity, sentiment_score, computed_at
      FROM public.property_review_summaries WHERE property_id = p_property_id
  )
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'property_id', p.id,
    'google_place_id', p.google_place_id,
    'name', p.name,
    'hero_summary', public._compose_hero_summary(p.id),
    'address', p.formatted_address,
    'locality', p.locality,
    'region', p.administrative_area,
    'country_code', p.country_code,
    'postal_code', p.postal_code,
    'location', CASE WHEN g.latitude IS NOT NULL
                     THEN jsonb_build_object('lat', g.latitude, 'lng', g.longitude) END,
    'viewport', g.viewport,
    'plus_code', g.plus_code,
    'timezone', g.timezone,
    'category', p.primary_category,
    'google_types', to_jsonb(p.google_types),
    'business_status', p.business_status,
    'rating', p.rating,
    'rating_count', p.user_ratings_total,
    'price_level', p.price_level,
    'review_velocity', r.recent_review_velocity,
    'sentiment', r.sentiment_score,
    'phone', c.phone_e164,
    'phone_display', c.phone_display,
    'website', c.website_url,
    'email', c.email,
    'employees', e.estimated_employees,
    'revenue_usd', e.estimated_annual_revenue_usd,
    'domain', e.domain,
    'social', e.social_links,
    'tech_stack', to_jsonb(e.tech_stack),
    'enrichment_signals', e.signals,
    'enrichment_source', e.enrichment_source,
    'enriched_at', e.enriched_at,
    'primary_photo_url', p.primary_photo_url,
    'photos', ph.photos,
    'reviews', r.reviews_sample,
    'reviews_computed_at', r.computed_at,
    'hours', h.hours,
    'composed_at', to_jsonb(now())
  ))
    INTO v_payload
    FROM p
    LEFT JOIN g  ON TRUE
    LEFT JOIN c  ON TRUE
    LEFT JOIN e  ON TRUE
    LEFT JOIN h  ON TRUE
    LEFT JOIN ph ON TRUE
    LEFT JOIN r  ON TRUE;

  RETURN v_payload;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compose_doorway_payload(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compose_doorway_payload(UUID) TO service_role;


CREATE TABLE IF NOT EXISTS public.doorway_candidates (
  property_id      UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','queued','surfaced','dismissed')),
  doorway_payload  JSONB,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by      UUID
);

CREATE INDEX IF NOT EXISTS idx_doorway_candidates_status
  ON public.doorway_candidates (status, created_at DESC);

REVOKE ALL ON public.doorway_candidates FROM PUBLIC, anon;
GRANT SELECT ON public.doorway_candidates TO authenticated;
GRANT ALL ON public.doorway_candidates TO service_role;

ALTER TABLE public.doorway_candidates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage doorway_candidates"
    ON public.doorway_candidates FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read doorway_candidates"
    ON public.doorway_candidates FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;


CREATE OR REPLACE FUNCTION public.detect_doorway_candidates(p_limit INT DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'detect_doorway_candidates is operator (admin) only'
      USING ERRCODE = '42501';
  END IF;
  IF p_limit <= 0 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'limit must be between 1 and 5000 (got %)', p_limit;
  END IF;

  WITH picked AS (
    SELECT pr.id
      FROM public.properties pr
     ORDER BY pr.created_at DESC NULLS LAST
     LIMIT p_limit
  ),
  upsert AS (
    INSERT INTO public.doorway_candidates (property_id, doorway_payload, status)
    SELECT pk.id, public.compose_doorway_payload(pk.id), 'new'
      FROM picked pk
    ON CONFLICT (property_id) DO UPDATE
      SET doorway_payload = EXCLUDED.doorway_payload,
          updated_at      = now()
      WHERE public.doorway_candidates.status = 'new'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upsert;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detect_doorway_candidates(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_doorway_candidates(INT) TO service_role, authenticated;


CREATE OR REPLACE FUNCTION public.set_doorway_candidate_status(
  p_property_id UUID,
  p_status      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'set_doorway_candidate_status is operator (admin) only'
      USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('new','queued','surfaced','dismissed') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.doorway_candidates
     SET status      = p_status,
         updated_at  = now(),
         reviewed_by = auth.uid()
   WHERE property_id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no doorway_candidate for property %', p_property_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_doorway_candidate_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_doorway_candidate_status(UUID, TEXT) TO service_role, authenticated;


CREATE OR REPLACE VIEW public.operator_doorway_candidates
  WITH (security_invoker = true) AS
  SELECT dc.property_id,
         dc.status,
         p.google_place_id,
         p.name,
         p.locality,
         p.administrative_area AS region,
         p.primary_category    AS category,
         (dc.doorway_payload->>'hero_summary') AS hero_summary,
         dc.doorway_payload,
         dc.notes,
         dc.reviewed_by,
         dc.created_at,
         dc.updated_at
    FROM public.doorway_candidates dc
    LEFT JOIN public.properties p ON p.id = dc.property_id
   ORDER BY dc.created_at DESC;

COMMENT ON VIEW public.operator_doorway_candidates IS
  'Admin-only (security_invoker) operator triage surface for Map-Oracle doorway candidates.';

REVOKE ALL ON public.operator_doorway_candidates FROM PUBLIC, anon;
GRANT SELECT ON public.operator_doorway_candidates TO service_role, authenticated;