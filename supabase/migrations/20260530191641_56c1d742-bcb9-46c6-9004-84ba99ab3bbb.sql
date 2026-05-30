-- ============================================================
-- Frontiers3D — Phase 1: Gap-Discovery Layer (Layers 1 + 2)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============================================================
-- LAYER 1 — RAW INGEST
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scrape_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by      TEXT,
  scraper_version   TEXT,
  query_params      JSONB,
  status            TEXT NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running','completed','failed','cancelled')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  total_snapshots   INTEGER NOT NULL DEFAULT 0,
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_status ON public.scrape_runs (status);
CREATE INDEX IF NOT EXISTS idx_scrape_runs_started_at ON public.scrape_runs (started_at DESC);

GRANT ALL ON public.scrape_runs TO service_role;

ALTER TABLE public.scrape_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage scrape_runs"
    ON public.scrape_runs FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read scrape_runs"
    ON public.scrape_runs FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.raw_scrape_snapshots (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_run_id      UUID NOT NULL REFERENCES public.scrape_runs(id) ON DELETE CASCADE,
  source             TEXT NOT NULL
                       CHECK (source IN (
                         'google_places_details',
                         'google_places_nearby',
                         'google_maps_search',
                         'google_places_text'
                       )),
  source_place_id    TEXT NOT NULL,
  query_context      JSONB,
  raw_payload        JSONB NOT NULL,
  scraped_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at       TIMESTAMPTZ,
  processing_error   TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_snapshots_place_id ON public.raw_scrape_snapshots (source_place_id);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_run ON public.raw_scrape_snapshots (scrape_run_id);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_unprocessed
  ON public.raw_scrape_snapshots (scraped_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_payload_gin
  ON public.raw_scrape_snapshots USING GIN (raw_payload jsonb_path_ops);

GRANT ALL ON public.raw_scrape_snapshots TO service_role;

ALTER TABLE public.raw_scrape_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage raw_scrape_snapshots"
    ON public.raw_scrape_snapshots FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read raw_scrape_snapshots"
    ON public.raw_scrape_snapshots FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- LAYER 2 — NORMALIZED PROPERTY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.properties (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id         TEXT NOT NULL UNIQUE,
  name                    TEXT NOT NULL,
  formatted_address       TEXT,
  street_number           TEXT,
  street_name             TEXT,
  locality                TEXT,
  administrative_area     TEXT,
  postal_code             TEXT,
  country_code            TEXT CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  primary_category        TEXT,
  google_types            TEXT[],
  business_status         TEXT CHECK (
                            business_status IS NULL
                            OR business_status IN ('OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY')
                          ),
  rating                  NUMERIC(2,1) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  user_ratings_total      INTEGER CHECK (user_ratings_total IS NULL OR user_ratings_total >= 0),
  price_level             SMALLINT CHECK (price_level IS NULL OR price_level BETWEEN 0 AND 4),
  primary_photo_url       TEXT,
  hero_summary            TEXT,
  first_seen_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_snapshot_id        UUID REFERENCES public.raw_scrape_snapshots(id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_name_trgm ON public.properties USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_properties_address_trgm
  ON public.properties USING GIN (formatted_address gin_trgm_ops)
  WHERE formatted_address IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_locality
  ON public.properties (country_code, administrative_area, locality);
CREATE INDEX IF NOT EXISTS idx_properties_category
  ON public.properties (primary_category) WHERE primary_category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_properties_last_seen ON public.properties (last_seen_at DESC);

GRANT ALL ON public.properties TO service_role;

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage properties"
    ON public.properties FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read properties"
    ON public.properties FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_properties_updated_at
    BEFORE UPDATE ON public.properties
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_geo (
  property_id     UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  latitude        NUMERIC(9, 6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude       NUMERIC(9, 6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location        geometry(Point, 4326)
                    GENERATED ALWAYS AS (
                      ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326)
                    ) STORED,
  viewport        JSONB,
  plus_code       TEXT,
  timezone        TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_geo_location_gix
  ON public.property_geo USING GIST (location);

GRANT ALL ON public.property_geo TO service_role;

ALTER TABLE public.property_geo ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_geo"
    ON public.property_geo FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_geo"
    ON public.property_geo FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_property_geo_updated_at
    BEFORE UPDATE ON public.property_geo
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_contacts (
  property_id     UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  phone_e164      TEXT,
  phone_display   TEXT,
  website_url     TEXT,
  email           CITEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_contacts_email
  ON public.property_contacts (email) WHERE email IS NOT NULL;

GRANT ALL ON public.property_contacts TO service_role;

ALTER TABLE public.property_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_contacts"
    ON public.property_contacts FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_contacts"
    ON public.property_contacts FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_property_contacts_updated_at
    BEFORE UPDATE ON public.property_contacts
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_hours (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id     UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  day_of_week     SMALLINT CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  special_date    DATE,
  opens_at        TIME,
  closes_at       TIME,
  is_closed       BOOLEAN NOT NULL DEFAULT FALSE,
  is_24h          BOOLEAN NOT NULL DEFAULT FALSE,
  raw_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_property_hours_property
  ON public.property_hours (property_id);

GRANT ALL ON public.property_hours TO service_role;

ALTER TABLE public.property_hours ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_hours"
    ON public.property_hours FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_hours"
    ON public.property_hours FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_photos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  source_photo_ref  TEXT,
  cdn_url           TEXT,
  width             INTEGER,
  height            INTEGER,
  attribution       TEXT,
  ordinal           SMALLINT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_photos_property_ordinal
  ON public.property_photos (property_id, ordinal);

GRANT ALL ON public.property_photos TO service_role;

ALTER TABLE public.property_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_photos"
    ON public.property_photos FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_photos"
    ON public.property_photos FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_enrichment (
  property_id                  UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  estimated_employees          INTEGER CHECK (estimated_employees IS NULL OR estimated_employees >= 0),
  estimated_annual_revenue_usd BIGINT CHECK (estimated_annual_revenue_usd IS NULL OR estimated_annual_revenue_usd >= 0),
  domain                       TEXT,
  social_links                 JSONB,
  tech_stack                   TEXT[],
  signals                      JSONB,
  enrichment_source            TEXT,
  enriched_at                  TIMESTAMPTZ,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.property_enrichment TO service_role;

ALTER TABLE public.property_enrichment ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_enrichment"
    ON public.property_enrichment FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_enrichment"
    ON public.property_enrichment FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER update_property_enrichment_updated_at
    BEFORE UPDATE ON public.property_enrichment
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.property_review_summaries (
  property_id              UUID PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  reviews_sample           JSONB,
  recent_review_velocity   NUMERIC,
  sentiment_score          NUMERIC CHECK (sentiment_score IS NULL OR sentiment_score BETWEEN -1 AND 1),
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.property_review_summaries TO service_role;

ALTER TABLE public.property_review_summaries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage property_review_summaries"
    ON public.property_review_summaries FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read property_review_summaries"
    ON public.property_review_summaries FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- TRANSFORM PIPELINE — HELPERS
-- ============================================================

CREATE OR REPLACE FUNCTION public._extract_address_component(
  p_components JSONB,
  p_type_filter TEXT,
  p_use_short BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_result TEXT;
BEGIN
  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' THEN
    RETURN NULL;
  END IF;

  SELECT CASE WHEN p_use_short THEN (c->>'short_name') ELSE (c->>'long_name') END
    INTO v_result
    FROM jsonb_array_elements(p_components) AS c
   WHERE c->'types' ? p_type_filter
   LIMIT 1;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public._normalize_phone_e164(p_intl TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_cleaned TEXT;
BEGIN
  IF p_intl IS NULL OR btrim(p_intl) = '' THEN
    RETURN NULL;
  END IF;

  v_cleaned := regexp_replace(p_intl, '[^\d+]', '', 'g');

  IF left(v_cleaned, 1) <> '+' OR length(v_cleaned) < 9 THEN
    RETURN NULL;
  END IF;

  RETURN v_cleaned;
END;
$$;

CREATE OR REPLACE FUNCTION public._parse_google_time(p_t TEXT)
RETURNS TIME
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_t IS NULL OR length(p_t) <> 4 OR p_t !~ '^\d{4}$' THEN
    RETURN NULL;
  END IF;
  RETURN make_time(
    substring(p_t FROM 1 FOR 2)::int,
    substring(p_t FROM 3 FOR 2)::int,
    0
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._safe_numeric(p_v JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_v IS NULL OR jsonb_typeof(p_v) = 'null' THEN
    RETURN NULL;
  END IF;
  RETURN (p_v#>>'{}')::NUMERIC;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._safe_integer(p_v JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_v IS NULL OR jsonb_typeof(p_v) = 'null' THEN
    RETURN NULL;
  END IF;
  RETURN (p_v#>>'{}')::INTEGER;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ============================================================
-- TRANSFORM PIPELINE — PER-SNAPSHOT TRANSFORM
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_raw_snapshot(p_snapshot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload          JSONB;
  v_place_id         TEXT;
  v_components       JSONB;
  v_property_id      UUID;
  v_name             TEXT;
  v_business_status  TEXT;
  v_lat              NUMERIC;
  v_lng              NUMERIC;
  v_period           JSONB;
  v_photo            JSONB;
  v_ordinal          INT;
  v_review_sample    JSONB;
BEGIN
  SELECT rs.raw_payload, rs.source_place_id
    INTO v_payload, v_place_id
    FROM public.raw_scrape_snapshots rs
   WHERE rs.id = p_snapshot_id;

  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'snapshot % not found or has null raw_payload', p_snapshot_id;
  END IF;

  v_place_id := COALESCE(v_payload->>'place_id', v_place_id);
  IF v_place_id IS NULL OR btrim(v_place_id) = '' THEN
    RAISE EXCEPTION 'snapshot % has no place_id', p_snapshot_id;
  END IF;

  v_name := nullif(btrim(v_payload->>'name'), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'snapshot % (place_id=%) has no name', p_snapshot_id, v_place_id;
  END IF;

  v_components := v_payload->'address_components';

  v_business_status := COALESCE(
    v_payload->>'business_status',
    CASE WHEN (v_payload->>'permanently_closed')::boolean IS TRUE
         THEN 'CLOSED_PERMANENTLY' END
  );
  IF v_business_status IS NOT NULL
     AND v_business_status NOT IN ('OPERATIONAL','CLOSED_TEMPORARILY','CLOSED_PERMANENTLY') THEN
    v_business_status := NULL;
  END IF;

  INSERT INTO public.properties (
    google_place_id, name, formatted_address,
    street_number, street_name, locality, administrative_area, postal_code, country_code,
    primary_category, google_types, business_status,
    rating, user_ratings_total, price_level,
    primary_photo_url, hero_summary,
    last_snapshot_id, last_seen_at
  ) VALUES (
    v_place_id,
    v_name,
    nullif(v_payload->>'formatted_address', ''),
    public._extract_address_component(v_components, 'street_number'),
    public._extract_address_component(v_components, 'route'),
    public._extract_address_component(v_components, 'locality'),
    public._extract_address_component(v_components, 'administrative_area_level_1'),
    public._extract_address_component(v_components, 'postal_code'),
    public._extract_address_component(v_components, 'country', p_use_short => TRUE),
    COALESCE(
      (
        SELECT t FROM jsonb_array_elements_text(COALESCE(v_payload->'types', '[]'::jsonb)) AS t
        WHERE t NOT IN ('point_of_interest','establishment','premise')
        LIMIT 1
      ),
      (
        SELECT t FROM jsonb_array_elements_text(COALESCE(v_payload->'types', '[]'::jsonb)) AS t
        LIMIT 1
      )
    ),
    CASE WHEN jsonb_typeof(v_payload->'types') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(v_payload->'types'))
         END,
    v_business_status,
    public._safe_numeric(v_payload->'rating'),
    public._safe_integer(v_payload->'user_ratings_total'),
    public._safe_integer(v_payload->'price_level')::SMALLINT,
    nullif(v_payload->>'icon', ''),
    nullif(v_payload->'editorial_summary'->>'overview', ''),
    p_snapshot_id,
    now()
  )
  ON CONFLICT (google_place_id) DO UPDATE
    SET name                = EXCLUDED.name,
        formatted_address   = EXCLUDED.formatted_address,
        street_number       = EXCLUDED.street_number,
        street_name         = EXCLUDED.street_name,
        locality            = EXCLUDED.locality,
        administrative_area = EXCLUDED.administrative_area,
        postal_code         = EXCLUDED.postal_code,
        country_code        = EXCLUDED.country_code,
        primary_category    = EXCLUDED.primary_category,
        google_types        = EXCLUDED.google_types,
        business_status     = EXCLUDED.business_status,
        rating              = EXCLUDED.rating,
        user_ratings_total  = EXCLUDED.user_ratings_total,
        price_level         = EXCLUDED.price_level,
        primary_photo_url   = COALESCE(EXCLUDED.primary_photo_url, public.properties.primary_photo_url),
        hero_summary        = COALESCE(EXCLUDED.hero_summary, public.properties.hero_summary),
        last_snapshot_id    = EXCLUDED.last_snapshot_id,
        last_seen_at        = EXCLUDED.last_seen_at
  RETURNING id INTO v_property_id;

  v_lat := public._safe_numeric(v_payload#>'{geometry,location,lat}');
  v_lng := public._safe_numeric(v_payload#>'{geometry,location,lng}');

  IF v_lat IS NOT NULL AND v_lng IS NOT NULL
     AND v_lat BETWEEN -90 AND 90
     AND v_lng BETWEEN -180 AND 180 THEN
    INSERT INTO public.property_geo (
      property_id, latitude, longitude, viewport, plus_code, timezone
    ) VALUES (
      v_property_id,
      v_lat,
      v_lng,
      CASE WHEN v_payload#>'{geometry,viewport}' IS NOT NULL
           THEN jsonb_build_object(
             'ne', v_payload#>'{geometry,viewport,northeast}',
             'sw', v_payload#>'{geometry,viewport,southwest}'
           ) END,
      v_payload#>>'{plus_code,global_code}',
      nullif(v_payload->>'timezone', '')
    )
    ON CONFLICT (property_id) DO UPDATE
      SET latitude  = EXCLUDED.latitude,
          longitude = EXCLUDED.longitude,
          viewport  = EXCLUDED.viewport,
          plus_code = EXCLUDED.plus_code,
          timezone  = COALESCE(EXCLUDED.timezone, public.property_geo.timezone);
  END IF;

  IF (v_payload ? 'international_phone_number')
     OR (v_payload ? 'formatted_phone_number')
     OR (v_payload ? 'website') THEN
    INSERT INTO public.property_contacts (
      property_id, phone_e164, phone_display, website_url
    ) VALUES (
      v_property_id,
      public._normalize_phone_e164(v_payload->>'international_phone_number'),
      nullif(v_payload->>'formatted_phone_number', ''),
      nullif(v_payload->>'website', '')
    )
    ON CONFLICT (property_id) DO UPDATE
      SET phone_e164    = COALESCE(EXCLUDED.phone_e164,    public.property_contacts.phone_e164),
          phone_display = COALESCE(EXCLUDED.phone_display, public.property_contacts.phone_display),
          website_url   = COALESCE(EXCLUDED.website_url,   public.property_contacts.website_url);
  END IF;

  DELETE FROM public.property_hours WHERE property_id = v_property_id;

  IF jsonb_typeof(v_payload#>'{opening_hours,periods}') = 'array' THEN
    FOR v_period IN SELECT * FROM jsonb_array_elements(v_payload#>'{opening_hours,periods}')
    LOOP
      IF (v_period#>>'{open,time}') = '0000'
         AND NOT (v_period ? 'close') THEN
        INSERT INTO public.property_hours (
          property_id, day_of_week, is_24h, raw_text
        ) VALUES (
          v_property_id, NULL, TRUE, 'Open 24 hours'
        );
        CONTINUE;
      END IF;

      INSERT INTO public.property_hours (
        property_id, day_of_week, opens_at, closes_at, is_closed
      ) VALUES (
        v_property_id,
        (v_period#>>'{open,day}')::SMALLINT,
        public._parse_google_time(v_period#>>'{open,time}'),
        public._parse_google_time(v_period#>>'{close,time}'),
        FALSE
      );
    END LOOP;
  END IF;

  DELETE FROM public.property_photos WHERE property_id = v_property_id;

  IF jsonb_typeof(v_payload->'photos') = 'array' THEN
    v_ordinal := 0;
    FOR v_photo IN SELECT * FROM jsonb_array_elements(v_payload->'photos')
    LOOP
      INSERT INTO public.property_photos (
        property_id, source_photo_ref, width, height, attribution, ordinal
      ) VALUES (
        v_property_id,
        nullif(v_photo->>'photo_reference', ''),
        public._safe_integer(v_photo->'width'),
        public._safe_integer(v_photo->'height'),
        CASE WHEN jsonb_typeof(v_photo->'html_attributions') = 'array'
             THEN array_to_string(
               ARRAY(SELECT jsonb_array_elements_text(v_photo->'html_attributions')),
               ' | '
             ) END,
        v_ordinal
      );
      v_ordinal := v_ordinal + 1;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_payload->'reviews') = 'array' THEN
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
      INTO v_review_sample
      FROM (
        SELECT r
          FROM jsonb_array_elements(v_payload->'reviews') AS r
         ORDER BY COALESCE((r->>'time')::bigint, 0) DESC
         LIMIT 5
      ) capped;

    INSERT INTO public.property_review_summaries (
      property_id, reviews_sample, computed_at
    ) VALUES (
      v_property_id, v_review_sample, now()
    )
    ON CONFLICT (property_id) DO UPDATE
      SET reviews_sample = EXCLUDED.reviews_sample,
          computed_at    = EXCLUDED.computed_at;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_raw_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_raw_snapshot(UUID) TO service_role;

-- ============================================================
-- TRANSFORM PIPELINE — BATCH WORKER
-- ============================================================

CREATE OR REPLACE FUNCTION public.process_unprocessed_snapshots(
  p_batch_size INT DEFAULT 100
)
RETURNS TABLE (processed INTEGER, failed INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snap        RECORD;
  v_processed   INT := 0;
  v_failed      INT := 0;
  v_err_msg     TEXT;
  v_err_state   TEXT;
BEGIN
  IF p_batch_size <= 0 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch_size must be between 1 and 5000 (got %)', p_batch_size;
  END IF;

  FOR v_snap IN
    SELECT id
      FROM public.raw_scrape_snapshots
     WHERE processed_at IS NULL
     ORDER BY scraped_at
     LIMIT p_batch_size
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.process_raw_snapshot(v_snap.id);

      UPDATE public.raw_scrape_snapshots
         SET processed_at     = now(),
             processing_error = NULL
       WHERE id = v_snap.id;

      v_processed := v_processed + 1;

    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_err_msg   = MESSAGE_TEXT,
        v_err_state = RETURNED_SQLSTATE;

      UPDATE public.raw_scrape_snapshots
         SET processed_at     = now(),
             processing_error = format('[%s] %s', v_err_state, v_err_msg)
       WHERE id = v_snap.id;

      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_processed, v_failed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_unprocessed_snapshots(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_unprocessed_snapshots(INT) TO service_role;

-- ============================================================
-- OPERATOR TRIAGE VIEW
-- ============================================================

CREATE OR REPLACE VIEW public.operator_failed_snapshots
  WITH (security_invoker = true) AS
  SELECT rs.id,
         rs.scrape_run_id,
         rs.source,
         rs.source_place_id,
         rs.scraped_at,
         rs.processed_at,
         rs.processing_error,
         sr.initiated_by
    FROM public.raw_scrape_snapshots rs
    LEFT JOIN public.scrape_runs sr ON sr.id = rs.scrape_run_id
   WHERE rs.processing_error IS NOT NULL
   ORDER BY rs.processed_at DESC;

COMMENT ON VIEW public.operator_failed_snapshots IS
  'Snapshots that the transform worker could not parse. processed_at is set so they no longer block the queue; investigate processing_error, fix the payload or worker, then NULL out processed_at on the affected rows to re-queue.';

GRANT SELECT ON public.operator_failed_snapshots TO service_role, authenticated;