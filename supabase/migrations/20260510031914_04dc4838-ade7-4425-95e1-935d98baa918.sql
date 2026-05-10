DO $$ BEGIN
  CREATE TYPE public.work_order_status AS ENUM ('pending','confirmed','completed','incomplete','cancelled','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_invite_status AS ENUM ('invited','available','not_available','expired','not_selected','withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.work_order_completion AS ENUM ('complete','incomplete');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.work_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_beacon_id UUID REFERENCES public.agent_beacons(id) ON DELETE SET NULL,
  property_type TEXT NOT NULL CHECK (length(property_type) BETWEEN 2 AND 80),
  size_band TEXT NOT NULL CHECK (size_band IN ('under_1500','1500_3000','3000_5000','over_5000','unknown')),
  available_from TIMESTAMPTZ NOT NULL,
  available_to TIMESTAMPTZ NOT NULL,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  essential_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  preferable_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  city TEXT NOT NULL,
  region TEXT,
  zip TEXT,
  lat NUMERIC(9, 6),
  lng NUMERIC(9, 6),
  wo_point geometry(Point, 4326)
    GENERATED ALWAYS AS (
      CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
        THEN ST_SetSRID(ST_MakePoint(lng::double precision, lat::double precision), 4326)
        ELSE NULL END
    ) STORED,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  status public.work_order_status NOT NULL DEFAULT 'pending',
  priority_window_until TIMESTAMPTZ,
  confirmed_provider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  pii_released_at TIMESTAMPTZ,
  completion public.work_order_completion,
  completion_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_orders_window_chk CHECK (available_to > available_from),
  CONSTRAINT work_orders_pref_disjoint_chk CHECK (NOT (essential_services && preferable_services))
);

CREATE INDEX IF NOT EXISTS idx_work_orders_agent ON public.work_orders (agent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON public.work_orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_confirmed_provider ON public.work_orders (confirmed_provider_id) WHERE confirmed_provider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_zip ON public.work_orders (zip);
CREATE INDEX IF NOT EXISTS idx_work_orders_point_gix ON public.work_orders USING GIST (wo_point) WHERE wo_point IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_orders_priority_window ON public.work_orders (priority_window_until) WHERE priority_window_until IS NOT NULL AND status = 'pending';

ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage work_orders" ON public.work_orders FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Agents can view own work orders" ON public.work_orders FOR SELECT USING (auth.uid() = agent_user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins can view all work orders" ON public.work_orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.work_order_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank_at_invite SMALLINT,
  respond_by TIMESTAMPTZ NOT NULL,
  response_status public.work_order_invite_status NOT NULL DEFAULT 'invited',
  responded_at TIMESTAMPTZ,
  provider_note TEXT CHECK (provider_note IS NULL OR length(provider_note) <= 1000),
  email_sent_at TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,
  available_score_delta_at TIMESTAMPTZ,
  expired_penalty_applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_work_order_invites_provider ON public.work_order_invites (provider_id, response_status, respond_by);
CREATE INDEX IF NOT EXISTS idx_work_order_invites_work_order ON public.work_order_invites (work_order_id);
CREATE INDEX IF NOT EXISTS idx_work_order_invites_pending_expiry ON public.work_order_invites (respond_by) WHERE response_status = 'invited';

ALTER TABLE public.work_order_invites ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage work_order_invites" ON public.work_order_invites FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Providers can view own work_order_invites" ON public.work_order_invites FOR SELECT USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Agents can view invites on own work orders" ON public.work_order_invites FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.id = work_order_invites.work_order_id AND wo.agent_user_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins can view all work_order_invites" ON public.work_order_invites FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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
CREATE INDEX IF NOT EXISTS idx_work_order_ratings_provider ON public.work_order_ratings (provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_ratings_agent ON public.work_order_ratings (agent_user_id);

ALTER TABLE public.work_order_ratings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage work_order_ratings" ON public.work_order_ratings FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Providers can view own ratings" ON public.work_order_ratings FOR SELECT USING (auth.uid() = provider_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Agents can view own submitted ratings" ON public.work_order_ratings FOR SELECT USING (auth.uid() = agent_user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Admins can view all ratings" ON public.work_order_ratings FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public._wo_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_work_orders_touch ON public.work_orders;
CREATE TRIGGER trg_work_orders_touch BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public._wo_touch_updated_at();
DROP TRIGGER IF EXISTS trg_work_order_invites_touch ON public.work_order_invites;
CREATE TRIGGER trg_work_order_invites_touch BEFORE UPDATE ON public.work_order_invites FOR EACH ROW EXECUTE FUNCTION public._wo_touch_updated_at();

CREATE OR REPLACE FUNCTION public._is_provider_serving_work_order(p_provider_id UUID, p_work_order_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branding_settings bs JOIN public.work_orders wo ON wo.id = p_work_order_id
    WHERE bs.provider_id = p_provider_id AND bs.is_directory_public = TRUE
      AND (
        (bs.service_polygon IS NOT NULL AND wo.wo_point IS NOT NULL AND ST_Contains(bs.service_polygon, wo.wo_point))
        OR (bs.service_center IS NOT NULL AND wo.wo_point IS NOT NULL AND bs.service_radius_miles IS NOT NULL
            AND ST_DWithin(bs.service_center::geography, wo.wo_point::geography, bs.service_radius_miles * 1609.34)
            AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region))
        OR (wo.zip IS NOT NULL AND wo.zip = ANY(bs.service_zips))
        OR (bs.primary_city IS NOT NULL AND wo.city IS NOT NULL
            AND similarity(lower(bs.primary_city), lower(wo.city)) > 0.75
            AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region))
      )
  );
$$;
REVOKE EXECUTE ON FUNCTION public._is_provider_serving_work_order(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._is_provider_serving_work_order(UUID, UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._count_eligible_pros_for_work_order(p_work_order_id UUID)
RETURNS INTEGER LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.branding_settings bs JOIN public.work_orders wo ON wo.id = p_work_order_id
  LEFT JOIN public.provider_responsiveness pr ON pr.provider_id = bs.provider_id
  WHERE bs.tier = 'pro'::public.app_tier AND bs.is_directory_public = TRUE
    AND public.provider_has_paid_access(bs.provider_id)
    AND COALESCE(pr.score, 1.00) >= 0.70
    AND (coalesce(array_length(wo.essential_services, 1), 0) = 0 OR wo.essential_services <@ bs.specialties)
    AND (
      (bs.service_polygon IS NOT NULL AND wo.wo_point IS NOT NULL AND ST_Contains(bs.service_polygon, wo.wo_point))
      OR (bs.service_center IS NOT NULL AND wo.wo_point IS NOT NULL AND bs.service_radius_miles IS NOT NULL
          AND ST_DWithin(bs.service_center::geography, wo.wo_point::geography, bs.service_radius_miles * 1609.34)
          AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region))
      OR (wo.zip IS NOT NULL AND wo.zip = ANY(bs.service_zips))
      OR (bs.primary_city IS NOT NULL AND wo.city IS NOT NULL
          AND similarity(lower(bs.primary_city), lower(wo.city)) > 0.75
          AND (wo.region IS NULL OR bs.region IS NULL OR bs.region = wo.region))
    );
$$;
REVOKE EXECUTE ON FUNCTION public._count_eligible_pros_for_work_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._count_eligible_pros_for_work_order(UUID) TO authenticated, service_role;