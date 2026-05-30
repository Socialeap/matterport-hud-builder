-- ============================================================
-- Frontiers3D — Phase 3.3: Enforce platform-routed release (additive)
-- ------------------------------------------------------------
-- Closes the last no-fee download path. The provider-facing
-- "Mark Paid" / "Release" overrides in /dashboard/orders are obsolete:
-- all studio-presentation download payments now route from the end-user
-- through Stripe Connect to the provider (Phase 3.1), and that charge
-- carries the mandatory Frontiers3D platform fee. Those overrides were
-- direct, RLS-backed browser writes that set saved_models to
-- paid / is_released WITHOUT any Stripe transaction — i.e. with no
-- platform fee collected.
--
-- Phase 3.3 removes those buttons/handlers (frontend — see
-- BACKEND_ACTIVATION_PHASE_3_3.md) and, here, enforces server-side that
-- ONLY the platform payment flow (service role: create-connect-checkout
-- owner self-build + payments-webhook) may transition a saved_model into
-- paid / released. Any authenticated (provider/client) attempt to do so
-- directly is rejected. This makes "the platform fee is always collected
-- before release" a hard invariant, not just a UI convention.
--
-- Verified safe against origin/main: the ONLY non-service-role writers of
-- saved_models.status='paid' / is_released=true were the two removed
-- orders.tsx handlers. Every legitimate release path — owner self-build
-- (create-connect-checkout), the Stripe webhook (payments-webhook), and
-- the Phase 3.2 comp (now sets retail_waived, not paid/released) — runs as
-- service_role and is unaffected.
--
-- Strictly additive: one trigger function + one trigger. No DROP of
-- existing objects, no DELETE/TRUNCATE, no policy/RLS change, no column
-- change, no secret change. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- Guard: only service_role may transition a saved_model INTO
-- paid / released. Other edits (properties, branding, model_count,
-- retail_waived, reverting to pending/false, re-saving an already
-- paid/released row) pass freely.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enforce_saved_models_release_via_platform()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Block only the client-reachable PostgREST roles (a provider/client JWT).
  -- service_role (the platform payment flow) and direct backend/migration
  -- contexts (auth.role() NULL) are trusted and pass.
  IF (
        -- transition INTO 'paid'
        (NEW.status = 'paid' AND COALESCE(OLD.status, '') IS DISTINCT FROM 'paid')
        OR
        -- transition INTO released (false/null -> true)
        (COALESCE(NEW.is_released, false) = true AND COALESCE(OLD.is_released, false) = false)
     )
     AND auth.role() = ANY (ARRAY['authenticated', 'anon'])
  THEN
    RAISE EXCEPTION
      'saved_models can only be marked paid/released by the platform payment flow. Route the client through Stripe checkout (create-connect-checkout).'
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE INSERT OR UPDATE so neither a direct UPDATE nor an INSERT that
-- pre-sets paid/released can bypass the platform flow.
DO $$ BEGIN
  CREATE TRIGGER trg_saved_models_release_guard
    BEFORE INSERT OR UPDATE ON public.saved_models
    FOR EACH ROW
    EXECUTE FUNCTION public._enforce_saved_models_release_via_platform();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- End of Phase 3.3 schema. Frontend removal of the obsolete
-- "Mark Paid" / "Release" overrides is deployed alongside per
-- BACKEND_ACTIVATION_PHASE_3_3.md.
-- ============================================================
