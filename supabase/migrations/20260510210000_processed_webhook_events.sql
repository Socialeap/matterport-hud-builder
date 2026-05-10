-- processed_webhook_events
-- ─────────────────────────
-- Idempotency ledger for inbound webhook deliveries (currently Stripe via
-- supabase/functions/payments-webhook). Stripe retries any non-2xx
-- response and may also retry on its own timeout heuristics, so without
-- this guard a single payment event can flip a tier or extend a license
-- expiry multiple times.
--
-- Contract: handlers `INSERT … ON CONFLICT (event_id) DO NOTHING` and
-- short-circuit when no row is returned — see `claimEvent()` in
-- payments-webhook/index.ts. The table is intentionally append-only;
-- never delete a row inside a handler's transaction or you'll
-- re-enable the duplicate-application bug this migration fixes.
--
-- Operational note: rows older than 30 days can be purged via a cron
-- (Stripe documents a maximum 30-day retry window). A later migration
-- will add the purge job; for now the table is small enough that
-- unbounded growth is a Phase-6 cleanup concern, not a launch blocker.

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
  'Idempotency ledger for inbound webhook deliveries. PK on event_id; '
  'handlers INSERT … ON CONFLICT DO NOTHING and short-circuit on dup.';

-- RLS on, no policies — only the service role (which bypasses RLS) ever
-- reads/writes this table from the webhook function. Locking out all
-- other roles is intentional belt-and-braces.
ALTER TABLE public.processed_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.processed_webhook_events FROM PUBLIC;
REVOKE ALL ON public.processed_webhook_events FROM anon, authenticated;
