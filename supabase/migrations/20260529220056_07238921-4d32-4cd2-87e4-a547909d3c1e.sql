-- PR-A2 part 2/2: Supply-gap signal layer
CREATE TABLE IF NOT EXISTS public.supply_gap_signals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_engine      TEXT NOT NULL
                       CHECK (source_engine IN ('directory_request', 'map_oracle')),
  work_order_id      UUID UNIQUE
                       REFERENCES public.work_orders(id) ON DELETE CASCADE,
  city               TEXT,
  region             TEXT,
  zip                TEXT,
  essential_services public.marketplace_specialty[] NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at        TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ
);

-- Data API grants (auth-only; admin reads via has_role policy, writes via service role)
GRANT ALL ON public.supply_gap_signals TO service_role;

CREATE INDEX IF NOT EXISTS idx_supply_gap_signals_open
  ON public.supply_gap_signals (created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_supply_gap_signals_geo
  ON public.supply_gap_signals (lower(city), region)
  WHERE resolved_at IS NULL;

ALTER TABLE public.supply_gap_signals ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage supply_gap_signals"
    ON public.supply_gap_signals FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read supply_gap_signals"
    ON public.supply_gap_signals FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.detect_directory_supply_gaps(
  p_lookback INTERVAL DEFAULT INTERVAL '7 days'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.supply_gap_signals
    (source_engine, work_order_id, city, region, zip, essential_services)
  SELECT 'directory_request', wo.id, wo.city, wo.region, wo.zip,
         COALESCE(wo.essential_services, '{}'::public.marketplace_specialty[])
    FROM public.work_orders wo
   WHERE wo.created_at > now() - p_lookback
     AND NOT EXISTS (
       SELECT 1 FROM public.work_order_invites wi WHERE wi.work_order_id = wo.id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.supply_gap_signals s WHERE s.work_order_id = wo.id
     )
  ON CONFLICT (work_order_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.detect_directory_supply_gaps(INTERVAL) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_directory_supply_gaps(INTERVAL) TO service_role;

CREATE OR REPLACE VIEW public.operator_open_supply_gaps
  WITH (security_invoker = true) AS
SELECT s.id, s.source_engine, s.work_order_id, s.city, s.region, s.zip,
       s.essential_services, s.created_at, s.notified_at
  FROM public.supply_gap_signals s
 WHERE s.resolved_at IS NULL
 ORDER BY s.created_at DESC;

-- Post-migration EXECUTE hygiene (Supabase auto-grants on SECURITY DEFINER fns;
-- mirrors the PR-A1 follow-up REVOKE for _resolve_platform_fee_cents)
REVOKE EXECUTE ON FUNCTION public.detect_directory_supply_gaps(INTERVAL)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._link_client_provider_on_work_order_confirm()
  FROM anon, authenticated, PUBLIC;