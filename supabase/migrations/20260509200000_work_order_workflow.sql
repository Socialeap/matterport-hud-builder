-- =============================================================================
-- Work Order Workflow ("Uber-style" 5-Step Marketplace) — Per Handbook v2
-- =============================================================================
-- Replaces the MSP-initiated Outreach Composer with an anonymized,
-- agent-driven Work Order flow:
--   Request → Selection → Anonymized Work Order → MSP "Available"/"Not Available"
--   within 3h → Agent confirms one MSP → Job complete → 1-5★ rating.
--
-- Invariants:
--   * Agent PII (full name, email, full address) is hidden from invited MSPs
--     until the agent confirms exactly one MSP (`pii_released_at` set).
--   * Top 5 Pros visible during the dynamic priority window:
--       ≥3 eligible Pros → 24h, 1-2 → 12h, 0 → immediate (all qualifying).
--   * Standing score events (Handbook §4):
--       +0.10 "Available" within 3h
--       +0.20 Job Confirmed
--       +0.15 Positive Rating (≥4 stars)
--        0.00 "Not Available" / Intent Signal View
--       −0.50 Missed 3h response window
--       −0.50 Agent flag (existing, with new repeat-flag clamp on 2nd in 30d)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.work_order_status AS ENUM (
    'pending',         -- Submitted; invites sent; awaiting MSP responses
    'confirmed',       -- Agent picked one MSP; PII released
    'completed',       -- Job marked complete by MSP
    'incomplete',      -- Job marked incomplete by MSP
    'cancelled',       -- Agent cancelled (or system cancelled)
    'expired'          -- All invites expired with no Available; no agent action
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_invite_status AS ENUM (
    'invited',         -- MSP has been notified, no response yet
    'available',       -- MSP responded "Available"
    'not_available',   -- MSP responded "Not Available"
    'expired',         -- 3h window passed with no response
    'not_selected',    -- Agent confirmed a different MSP; this invite closed
    'withdrawn'        -- Agent cancelled the work order before responses
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_completion AS ENUM (
    'complete',
    'incomplete'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 2. work_orders table
-- -----------------------------------------------------------------------------
-- Source-of-truth for an authenticated agent's job request. Anonymized fields
-- (`city`, `region`, `zip`, services, property_type, size_band, time window)
-- are visible to invited MSPs at the invite stage; full address + agent
-- contact info are gated until `pii_released_at`.
CREATE TABLE IF NOT EXISTS public.work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auth-gated requester. Email/name resolved via auth.users + profiles
  -- at confirmation time; we do NOT denormalize PII here.
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional link to the agent_beacons row that started the discovery
  -- (so MSP recruitment intel and Work Orders share lineage).
  source_beacon_id UUID REFERENCES public.agent_beacons(id) ON DELETE SET NULL,

  -- Job spec (anonymized — visible to invited MSPs)
  property_type TEXT NOT NULL CHECK (length(property_type) BETWEEN 2 AND 80),
  size_band TEXT NOT NULL CHECK (size_band IN (
    'under_1500', '1500_3000', '3000_5000', 'over_5000', 'unknown'
  )),
  available_from TIMESTAMPTZ NOT NULL,
  available_to TIMESTAMPTZ NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),

  essential_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  preferable_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',

  -- Geo (visible to invited MSPs at invite stage)
  city TEXT NOT NULL,
  region TEXT,
  zip TEXT,
  lat NUMERIC(9, 6),
  lng NUMERIC(9, 6),
  wo_point geometry(Point, 4326)
    GENERATED ALWAYS AS (
      CASE
        WHEN lat IS NOT NULL AND lng IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
        ELSE NULL
      END
    ) STORED,

  -- Gated PII (full address) — only readable by confirmed MSP after pii_released_at
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,

  -- Lifecycle
  status public.work_order_status NOT NULL DEFAULT 'pending',
  priority_window_until TIMESTAMPTZ, -- NULL = no Pro-only window (0 Pros at submit)
  confirmed_provider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  pii_released_at TIMESTAMPTZ,
  completion public.work_order_completion,
  completion_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  -- TTL for stale pending work orders (24h after last invite expires + buffer)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT work_orders_window_chk CHECK (available_to > available_from),
  CONSTRAINT work_orders_pref_disjoint_chk CHECK (
    NOT (essential_services && preferable_services)
  )
);

CREATE INDEX IF NOT EXISTS idx_work_orders_agent
  ON public.work_orders (agent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_status
  ON public.work_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_confirmed_provider
  ON public.work_orders (confirmed_provider_id)
  WHERE confirmed_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_zip
  ON public.work_orders (zip);
CREATE INDEX IF NOT EXISTS idx_work_orders_point_gix
  ON public.work_orders USING GIST (wo_point)
  WHERE wo_point IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_priority_window
  ON public.work_orders (priority_window_until)
  WHERE priority_window_until IS NOT NULL AND status = 'pending';

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

-- Service role full access (RPCs run SECURITY DEFINER and use this).
DO $$ BEGIN
  CREATE POLICY "Service role can manage work_orders"
    ON public.work_orders FOR ALL
    TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Agents can read their own work orders.
DO $$ BEGIN
  CREATE POLICY "Agents can view own work orders"
    ON public.work_orders FOR SELECT
    USING (auth.uid() = agent_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admins can read all.
DO $$ BEGIN
  CREATE POLICY "Admins can view all work orders"
    ON public.work_orders FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 3. work_order_invites table
-- -----------------------------------------------------------------------------
-- One row per invited MSP per work order. The `respond_by` deadline drives
-- the −0.50 "Missed 3h Window" penalty applied by the cron job.
CREATE TABLE IF NOT EXISTS public.work_order_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_at_invite SMALLINT, -- 1..5, ranking position when invite was sent

  respond_by TIMESTAMPTZ NOT NULL,
  response_status public.work_order_invite_status NOT NULL DEFAULT 'invited',
  responded_at TIMESTAMPTZ,
  provider_note TEXT CHECK (provider_note IS NULL OR length(provider_note) <= 1000),

  -- Notification audit
  email_sent_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ, -- stub for PWA push (v2)

  -- Idempotency guards on score deltas
  available_score_delta_at TIMESTAMPTZ,
  expired_penalty_applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (work_order_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_invites_provider
  ON public.work_order_invites (provider_id, response_status, respond_by);
CREATE INDEX IF NOT EXISTS idx_work_order_invites_work_order
  ON public.work_order_invites (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_invites_pending_expiry
  ON public.work_order_invites (respond_by)
  WHERE response_status = 'invited';

ALTER TABLE public.work_order_invites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage work_order_invites"
    ON public.work_order_invites FOR ALL
    TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Provider sees their own invites.
DO $$ BEGIN
  CREATE POLICY "Providers can view own work_order_invites"
    ON public.work_order_invites FOR SELECT
    USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Agent can see invites tied to their own work orders.
DO $$ BEGIN
  CREATE POLICY "Agents can view invites on own work orders"
    ON public.work_order_invites FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.work_orders wo
        WHERE wo.id = work_order_invites.work_order_id
          AND wo.agent_user_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view all work_order_invites"
    ON public.work_order_invites FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 4. work_order_ratings table
-- -----------------------------------------------------------------------------
-- One rating per completed work order. The `rating_token` is the unguessable
-- public key used by the agent's rating link in the post-job email.
CREATE TABLE IF NOT EXISTS public.work_order_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL UNIQUE REFERENCES public.work_orders(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating_token UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  stars SMALLINT CHECK (stars IS NULL OR stars BETWEEN 1 AND 5),
  feedback_text TEXT CHECK (feedback_text IS NULL OR length(feedback_text) <= 2000),
  submitted_at TIMESTAMPTZ,
  score_delta_applied_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_order_ratings_provider
  ON public.work_order_ratings (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_ratings_agent
  ON public.work_order_ratings (agent_user_id);

ALTER TABLE public.work_order_ratings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage work_order_ratings"
    ON public.work_order_ratings FOR ALL
    TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Providers can view own ratings"
    ON public.work_order_ratings FOR SELECT
    USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Agents can view own submitted ratings"
    ON public.work_order_ratings FOR SELECT
    USING (auth.uid() = agent_user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can view all ratings"
    ON public.work_order_ratings FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- -----------------------------------------------------------------------------
-- 5. updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._wo_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_orders_touch ON public.work_orders;
CREATE TRIGGER trg_work_orders_touch
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public._wo_touch_updated_at();

DROP TRIGGER IF EXISTS trg_work_order_invites_touch ON public.work_order_invites;
CREATE TRIGGER trg_work_order_invites_touch
  BEFORE UPDATE ON public.work_order_invites
  FOR EACH ROW EXECUTE FUNCTION public._wo_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 6. _is_provider_serving_work_order — geo predicate (mirrors beacon version)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._is_provider_serving_work_order(
  p_provider_id UUID,
  p_work_order_id UUID
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
    JOIN public.work_orders wo ON wo.id = p_work_order_id
    WHERE bs.provider_id = p_provider_id
      AND bs.is_directory_public = TRUE
      AND (
        (
          bs.service_polygon IS NOT NULL
          AND wo.wo_point IS NOT NULL
          AND ST_Contains(bs.service_polygon, wo.wo_point)
        )
        OR (
          bs.service_center IS NOT NULL
          AND wo.wo_point IS NOT NULL
          AND bs.service_radius_miles IS NOT NULL
          AND ST_DWithin(
            bs.service_center::geography,
            wo.wo_point::geography,
            bs.service_radius_miles * 1609.34
          )
          AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region)
        )
        OR (
          wo.zip IS NOT NULL
          AND wo.zip = ANY(bs.service_zips)
        )
        OR (
          bs.primary_city IS NOT NULL
          AND wo.city IS NOT NULL
          AND similarity(lower(bs.primary_city), lower(wo.city)) > 0.75
          AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region)
        )
      )
  );
$$;

REVOKE EXECUTE ON FUNCTION public._is_provider_serving_work_order(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_provider_serving_work_order(UUID, UUID)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. _count_eligible_pros_for_geo — supply count for window calculation
-- -----------------------------------------------------------------------------
-- Used at submission time to choose 24h / 12h / immediate window. We mirror
-- the four-tier geo predicate from `_is_provider_serving_work_order` so the
-- supply count matches the actual eligibility check.
CREATE OR REPLACE FUNCTION public._count_eligible_pros_for_work_order(
  p_work_order_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.branding_settings bs
  JOIN public.work_orders wo ON wo.id = p_work_order_id
  LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
  WHERE bs.tier = 'pro'::public.app_tier
    AND bs.is_directory_public = TRUE
    AND public.provider_has_paid_access(bs.provider_id)
    AND COALESCE(pr.score, 1.00) >= 0.70
    AND (
      coalesce(array_length(wo.essential_services, 1), 0) = 0
      OR wo.essential_services <@ bs.specialties
    )
    AND (
      (
        bs.service_polygon IS NOT NULL AND wo.wo_point IS NOT NULL
        AND ST_Contains(bs.service_polygon, wo.wo_point)
      )
      OR (
        bs.service_center IS NOT NULL AND wo.wo_point IS NOT NULL
        AND bs.service_radius_miles IS NOT NULL
        AND ST_DWithin(
          bs.service_center::geography,
          wo.wo_point::geography,
          bs.service_radius_miles * 1609.34
        )
        AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region)
      )
      OR (wo.zip IS NOT NULL AND wo.zip = ANY(bs.service_zips))
      OR (
        bs.primary_city IS NOT NULL AND wo.city IS NOT NULL
        AND similarity(lower(bs.primary_city), lower(wo.city)) > 0.75
        AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region)
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public._count_eligible_pros_for_work_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._count_eligible_pros_for_work_order(UUID)
  TO authenticated, service_role;

-- =============================================================================
-- End of schema migration; RPCs follow in 20260509200010_*.sql
-- =============================================================================
