-- ============================================================
-- Frontiers3D — Phase 3.7: Supply-gap signals (no-match → recruiting input)
-- ------------------------------------------------------------
-- Closes the last Engine-1 gap-analysis item: when a client's directory
-- Request-Availability work order matches ZERO eligible providers, the
-- platform today does nothing (the work order silently sits pending then
-- cron-expires). This is exactly the supply gap the business model's
-- capacity balancing must react to (0.4444 SCS per property won; ~10 SCS
-- onboarded/month to absorb demand).
--
-- This migration adds a lightweight signal layer:
--   * supply_gap_signals  — one row per unmatched demand (a work order
--                           with no invites), keyed for de-dup
--   * detect_directory_supply_gaps(lookback) — cron-able detector that
--     records signals for recent zero-invite work orders (idempotent)
--   * operator_open_supply_gaps — admin triage view of unresolved gaps
--
-- Design choices:
--   * A DETECTOR (cron-driven) is used instead of editing submit_work_order
--     — strictly additive, no reproduction of the ~70-line RPC, and a
--     zero-invite work order is a gap the moment it exists.
--   * No email is sent here: there is no configured ops/recruiting
--     recipient in the schema. Gaps are surfaced via the admin view;
--     wiring an ops notification (enqueue_email) is a follow-up once a
--     recipient is defined.
--   * source_engine is generic so Engine 2 (Map Oracle) can record gaps
--     here too when a closed client has no eligible SCS in range.
--
-- Reuses legacy: work_orders, work_order_invites, marketplace_specialty,
-- has_role. Prerequisite: none beyond those legacy objects. Strictly
-- additive: no DROP/DELETE/TRUNCATE, no policy/column change on existing
-- tables, no destructive ALTER. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. supply_gap_signals
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 2. detect_directory_supply_gaps(lookback)
--    Records a signal for every recent work order that received zero
--    invites and has no signal yet. Idempotent (NOT EXISTS + UNIQUE +
--    ON CONFLICT DO NOTHING). Returns the number of new signals.
--    Schedule via pg_cron (see BACKEND_ACTIVATION_PHASE_3_7.md).
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 3. operator_open_supply_gaps — admin triage surface
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.operator_open_supply_gaps
  WITH (security_invoker = true) AS
SELECT s.id,
       s.source_engine,
       s.work_order_id,
       s.city,
       s.region,
       s.zip,
       s.essential_services,
       s.created_at,
       s.notified_at
  FROM public.supply_gap_signals s
 WHERE s.resolved_at IS NULL
 ORDER BY s.created_at DESC;

-- ============================================================
-- End of Phase 3.7. Recording-and-surfacing only; the actual SCS
-- recruiting/onboarding action consuming these signals is a downstream
-- ops/marketing process. Engine 2 can record map_oracle gaps in the same
-- table when a closed client has no eligible SCS in range.
-- ============================================================
