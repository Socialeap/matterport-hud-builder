-- ============================================================
-- Frontiers3D — Phase 3.0: Platform-Fee Foundation (additive only)
-- ------------------------------------------------------------
-- Lays the database foundation for the Frontiers3D mandatory
-- platform fee, which sits ON TOP OF the existing 3DPS marketplace
-- without altering any of it. This migration is STRICTLY ADDITIVE:
-- it adds one column to client_providers (nullable-by-default,
-- backfilled) and creates two new tables, one resolver function,
-- their indexes, RLS, and the fee seed.
--
-- It does NOT touch marketplace routing, Pro exclusivity, Stripe
-- Connect, provider retail pricing, the payments webhook, or any
-- existing function/policy. See the "Out of scope" list below.
--
-- Business model recap:
--   Final Client Price = Frontiers3D platform fee + Provider retail fee
--   The platform fee is MANDATORY (provider may waive their own
--   retail fee, never the platform fee) and scales by:
--     (acquisition_source, model_count)  -- model_count in 1..5
--
--   Marketplace schedule (map_oracle / agent_form / directory_request):
--     1=$20  2=$30  3=$40  4=$50  5=$60
--   Direct schedule (scs_direct):
--     1=$10  2=$15  3=$20  4=$25  5=$30
--
-- What this lands:
--   * client_providers.acquisition_source  -- 'map_oracle'|'agent_form'|'directory_request'|'scs_direct'
--                                              (existing rows backfilled 'scs_direct')
--   * platform_fee_schedule   -- versioned, table-driven fee matrix
--   * platform_fee_ledger     -- append-only platform-revenue ledger
--                                (created now; NOTHING writes to it yet)
--   * _resolve_platform_fee_cents(source, model_count) -- strict resolver
--   * seed: 20 active fee rows (4 sources x 5 model counts)
--
-- Out of scope (explicitly NOT touched — later phases):
--   * create-connect-checkout / create-checkout  (Phase 3.1)
--   * payments-webhook + ledger writes            (Phase 3.1)
--   * application_fee_amount / Stripe Connect      (Phase 3.1)
--   * provider retail pricing (_shared/pricing.ts, branding_settings) (unchanged)
--   * marketplace routing (_provider_can_receive_leads,
--     get_my_matched_beacons, claim_pending_beacon_matches,
--     repool_expired_exclusives_and_enqueue, _is_provider_serving_beacon) (unchanged)
--   * Pro exclusivity / exclusive-window flow      (unchanged)
--   * licenses / purchases / setup-tier pricing     (unchanged)
--   * agent_beacons -> client_providers bridge      (later phase)
--   * server-authoritative model_count derivation in checkout (Phase 3.1)
--
-- Safety: no DROP, no DELETE, no TRUNCATE, no destructive ALTER,
-- no policy removal, no RLS weakening, no secret changes.
-- ============================================================


-- ------------------------------------------------------------
-- 1. client_providers.acquisition_source
--    Records how the client<->provider relationship originated so
--    checkout (a later phase) can pick the Marketplace vs Direct
--    fee schedule. Added with a safe default; existing rows are
--    backfilled explicitly to 'scs_direct' (they predate the Map
--    Oracle / marketplace attribution system).
--
--    NOTE: Until the beacon->client bridge lands, marketplace-generated
--    relationships will NOT automatically receive Marketplace pricing.
--    Existing and newly invitation-created client_providers rows default
--    to 'scs_direct'. The future bridge is what stamps 'map_oracle' /
--    'agent_form' on links born from the marketplace.
-- ------------------------------------------------------------

ALTER TABLE public.client_providers
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT NOT NULL DEFAULT 'scs_direct';

-- Backfill any pre-existing rows that were created before this column
-- (the DEFAULT already covers them, but this is explicit and idempotent).
UPDATE public.client_providers
   SET acquisition_source = 'scs_direct'
 WHERE acquisition_source IS NULL;

-- Constrain to the allowed set (named constraint, idempotent add).
DO $$ BEGIN
  ALTER TABLE public.client_providers
    ADD CONSTRAINT client_providers_acquisition_source_check
    CHECK (acquisition_source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_client_providers_acquisition_source
  ON public.client_providers (acquisition_source);


-- ------------------------------------------------------------
-- 2. platform_fee_schedule
--    Versioned, table-driven fee matrix. One "active" row per
--    (source, model_count) is the row whose effective_until IS NULL.
--    Future price changes = close the current row (set effective_until)
--    and insert a new active row — no application code changes.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_fee_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL
                    CHECK (source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct')),
  model_count     SMALLINT NOT NULL CHECK (model_count BETWEEN 1 AND 5),
  fee_cents       INTEGER NOT NULL CHECK (fee_cents >= 0),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A row is either open-ended (active) or has a valid closed window.
  CONSTRAINT platform_fee_schedule_window_valid
    CHECK (effective_until IS NULL OR effective_until > effective_from)
);

-- Exactly one ACTIVE fee per (source, model_count).
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_fee_schedule_active
  ON public.platform_fee_schedule (source, model_count)
  WHERE effective_until IS NULL;

-- Lookup index for historical/point-in-time queries.
CREATE INDEX IF NOT EXISTS idx_platform_fee_schedule_lookup
  ON public.platform_fee_schedule (source, model_count, effective_from DESC);

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


-- ------------------------------------------------------------
-- 3. platform_fee_ledger
--    Append-only record of platform-fee obligations, one row per
--    billable client download. Created NOW so Phase 3.1/3.2 can
--    write into it cleanly; NO production code writes to it yet.
--
--    The FINANCIAL facts are SNAPSHOTTED at charge time and are the
--    immutable record of what the platform earned. They do NOT depend
--    on any identity FK, so the ledger's revenue history survives the
--    deletion of a client, provider, or presentation:
--      - acquisition_source : snapshot of client_providers value
--      - model_count        : snapshot of the server-authoritative count
--      - platform_fee_cents : snapshot of the resolved fee
--      - fee_schedule_id    : the exact schedule row used (audit trail)
--      - stripe_* / status / timestamps : settlement facts (filled 3.1)
--
--    Identity references (client_id, provider_id, saved_model_id) use
--    ON DELETE SET NULL — they must NOT block account deletion or
--    privacy/erasure workflows. Note saved_models.client_id cascades
--    from auth.users, so a RESTRICT on saved_model_id would also block
--    user deletion transitively; SET NULL avoids that. When an identity
--    is erased the link goes NULL but the financial snapshot above is
--    retained. The ledger survives deletion; it never prevents it.
--    fee_schedule_id stays RESTRICT: schedule rows are versioned (closed
--    via effective_until), never deleted, and unrelated to user erasure.
--
--    Stripe identifiers and checkout path are nullable now — they are
--    filled by the webhook in Phase 3.1. status defaults to 'pending'.
--    The Phase 3.1 writer always populates client_id/provider_id/
--    saved_model_id at insert; they only become NULL on later deletion.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.platform_fee_ledger (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who / what was billed. Nullable + ON DELETE SET NULL so deletion of
  -- the presentation/client/provider is never blocked; the financial
  -- snapshot columns below preserve the revenue record regardless.
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

  -- Filled later by checkout/webhook (Phase 3.1) — nullable for now.
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
-- Reconcile by Stripe PI when the webhook fills it (partial — skip NULLs).
CREATE INDEX IF NOT EXISTS idx_platform_fee_ledger_payment_intent
  ON public.platform_fee_ledger (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

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


-- ------------------------------------------------------------
-- 4. _resolve_platform_fee_cents(source, model_count)
--    The single, strict authority for the platform fee. Keyed on
--    (acquisition_source, model_count) per the locked rule.
--
--    Strictness (no silent defaults, no fallback pricing):
--      * unknown source            -> RAISE (22023 invalid_parameter_value)
--      * model_count outside 1..5  -> RAISE (22003 numeric_value_out_of_range)
--      * no active schedule row     -> RAISE (P0001)
--
--    STABLE + SECURITY DEFINER so service-role checkout (later phase)
--    can call it regardless of RLS, with a pinned search_path.
-- ------------------------------------------------------------

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


-- ------------------------------------------------------------
-- 5. Seed the active fee schedule (20 rows).
--    Idempotent: only inserts a (source, model_count) active row if
--    one does not already exist. Re-running this migration will not
--    duplicate seeds or overwrite an adjusted active fee.
-- ------------------------------------------------------------

INSERT INTO public.platform_fee_schedule (source, model_count, fee_cents)
SELECT s.source, s.model_count, s.fee_cents
  FROM (VALUES
    -- Marketplace schedule
    ('map_oracle', 1::SMALLINT, 2000), ('map_oracle', 2, 3000), ('map_oracle', 3, 4000),
    ('map_oracle', 4, 5000), ('map_oracle', 5, 6000),
    ('agent_form', 1, 2000), ('agent_form', 2, 3000), ('agent_form', 3, 4000),
    ('agent_form', 4, 5000), ('agent_form', 5, 6000),
    ('directory_request', 1, 2000), ('directory_request', 2, 3000), ('directory_request', 3, 4000),
    ('directory_request', 4, 5000), ('directory_request', 5, 6000),
    -- Direct schedule
    ('scs_direct', 1, 1000), ('scs_direct', 2, 1500), ('scs_direct', 3, 2000),
    ('scs_direct', 4, 2500), ('scs_direct', 5, 3000)
  ) AS s(source, model_count, fee_cents)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.platform_fee_schedule p
    WHERE p.source = s.source
      AND p.model_count = s.model_count
      AND p.effective_until IS NULL
 );


-- ============================================================
-- End of Phase 3.0 — Platform-Fee Foundation.
-- Foundation only. Stripe / application-fee / checkout wiring is
-- deferred to Phase 3.1 after this schema is reviewed and verified.
-- ============================================================
