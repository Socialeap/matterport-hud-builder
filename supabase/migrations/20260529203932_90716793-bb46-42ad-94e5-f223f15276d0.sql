-- ============================================================
-- Frontiers3D — Phase 3.0: Platform-Fee Foundation (additive only)
-- ============================================================

ALTER TABLE public.client_providers
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT NOT NULL DEFAULT 'scs_direct';

UPDATE public.client_providers
   SET acquisition_source = 'scs_direct'
 WHERE acquisition_source IS NULL;

DO $$ BEGIN
  ALTER TABLE public.client_providers
    ADD CONSTRAINT client_providers_acquisition_source_check
    CHECK (acquisition_source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_providers_acquisition_source
  ON public.client_providers (acquisition_source);

CREATE TABLE IF NOT EXISTS public.platform_fee_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL
                    CHECK (source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct')),
  model_count     SMALLINT NOT NULL CHECK (model_count BETWEEN 1 AND 5),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT platform_fee_schedule_window_valid
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fee_schedule_active
  ON public.platform_fee_schedule (source, model_count)
  WHERE effective_until IS NULL;

CREATE INDEX IF NOT EXISTS idx_platform_fee_schedule_lookup
  ON public.platform_fee_schedule (source, model_count, effective_from DESC);

GRANT SELECT ON public.platform_fee_schedule TO authenticated;
GRANT ALL ON public.platform_fee_schedule TO service_role;

ALTER TABLE public.platform_fee_schedule ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage platform_fee_schedule"
    ON public.platform_fee_schedule FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read platform_fee_schedule"
    ON public.platform_fee_schedule FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.platform_fee_ledger (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_model_id              UUID
                                REFERENCES public.saved_models(id) ON DELETE SET NULL,
  client_id                   UUID
                                REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_id                 UUID
                                REFERENCES auth.users(id) ON DELETE SET NULL,
  acquisition_source          TEXT NOT NULL
                                CHECK (acquisition_source IN
                                  ('map_oracle', 'agent_form', 'directory_request', 'scs_direct')),
  model_count                 SMALLINT NOT NULL CHECK (model_count BETWEEN 1 AND 5),
  platform_fee_cents          INTEGER NOT NULL CHECK (platform_fee_cents >= 0),
  fee_schedule_id             UUID NOT NULL
                                REFERENCES public.platform_fee_schedule(id) ON DELETE RESTRICT,
  checkout_path               TEXT
                                CHECK (checkout_path IN
                                  ('provider_connected', 'platform_direct')),
  stripe_payment_intent_id    TEXT,
  stripe_checkout_session_id  TEXT,
  stripe_application_fee_id   TEXT,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                CHECK (status IN
                                  ('pending', 'collected', 'refunded', 'failed')),
  occurred_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  collected_at                TIMESTAMPTZ,
  refunded_at                 TIMESTAMPTZ,
  failed_reason               TEXT,
  notes                       TEXT
);

CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_saved_model
  ON public.platform_fee_ledger (saved_model_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_provider
  ON public.platform_fee_ledger (provider_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_client
  ON public.platform_fee_ledger (client_id);
CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_status
  ON public.platform_fee_ledger (status);
CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_payment_intent
  ON public.platform_fee_ledger (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

GRANT ALL ON public.platform_fee_ledger TO service_role;

ALTER TABLE public.platform_fee_ledger ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage platform_fee_ledger"
    ON public.platform_fee_ledger FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read platform_fee_ledger"
    ON public.platform_fee_ledger FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public._resolve_platform_fee_cents(
  p_source       TEXT,
  p_model_count  INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee INTEGER;
BEGIN
  IF p_source IS NULL OR p_source NOT IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct') THEN
    RAISE EXCEPTION 'unknown acquisition_source: %', p_source
      USING ERRCODE = '22023';
  END IF;

  IF p_model_count IS NULL OR p_model_count < 1 OR p_model_count > 5 THEN
    RAISE EXCEPTION 'model_count % is outside the billable range 1..5', p_model_count
      USING ERRCODE = '22003';
  END IF;

  SELECT fee_cents
    INTO v_fee
    FROM public.platform_fee_schedule
   WHERE source = p_source
     AND model_count = p_model_count::SMALLINT
     AND effective_until IS NULL;

  IF v_fee IS NULL THEN
    RAISE EXCEPTION 'no active platform fee for (source=%, model_count=%)',
      p_source, p_model_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_fee;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._resolve_platform_fee_cents(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._resolve_platform_fee_cents(TEXT, INTEGER) TO service_role;

INSERT INTO public.platform_fee_schedule (source, model_count, fee_cents)
SELECT s.source, s.model_count, s.fee_cents
  FROM (VALUES
    ('map_oracle', 1::SMALLINT, 2000), ('map_oracle', 2, 3000), ('map_oracle', 3, 4000),
    ('map_oracle', 4, 5000), ('map_oracle', 5, 6000),
    ('agent_form', 1, 2000), ('agent_form', 2, 3000), ('agent_form', 3, 4000),
    ('agent_form', 4, 5000), ('agent_form', 5, 6000),
    ('directory_request', 1, 2000), ('directory_request', 2, 3000), ('directory_request', 3, 4000),
    ('directory_request', 4, 5000), ('directory_request', 5, 6000),
    ('scs_direct', 1, 1000), ('scs_direct', 2, 1500), ('scs_direct', 3, 2000),
    ('scs_direct', 4, 2500), ('scs_direct', 5, 3000)
  ) AS s(source, model_count, fee_cents)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.platform_fee_schedule p
    WHERE p.source = s.source
      AND p.model_count = s.model_count
      AND p.effective_until IS NULL
 );