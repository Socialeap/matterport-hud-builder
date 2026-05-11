CREATE TABLE IF NOT EXISTS public.processed_webhook_events (
  event_id     TEXT        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'stripe',
  event_type   TEXT        NOT NULL,
  env          TEXT        NOT NULL CHECK (env IN ('sandbox', 'live')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id)
);

CREATE INDEX IF NOT EXISTS processed_webhook_events_processed_at_idx
  ON public.processed_webhook_events (processed_at DESC);

CREATE INDEX IF NOT EXISTS processed_webhook_events_source_type_idx
  ON public.processed_webhook_events (source, event_type);

COMMENT ON TABLE public.processed_webhook_events IS
  'Idempotency ledger for inbound webhook deliveries. PK on event_id; handlers INSERT … ON CONFLICT DO NOTHING and short-circuit on dup.';

ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.processed_webhook_events FROM PUBLIC;
REVOKE ALL ON public.processed_webhook_events FROM anon, authenticated;