ALTER TABLE public.agent_beacons
  ADD COLUMN IF NOT EXISTS service_match_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_service_match_pending
  ON public.agent_beacons (created_at)
  WHERE service_match_notified_at IS NULL
    AND (cardinality(essential_services) > 0 OR cardinality(preferable_services) > 0);