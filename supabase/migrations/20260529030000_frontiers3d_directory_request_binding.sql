-- ============================================================
-- Frontiers3D — Phase 3.6: Engine 1 (Directory Request) billing binding
-- ------------------------------------------------------------
-- Connects the EXISTING work-order / Request-Availability flow to the
-- Phase 3 billing/attribution model. Audit (PHASE_3_5_DEMAND_ENGINES_
-- DESIGN.md) found Engine 1 is ~90% built: the client browses the MSP
-- directory, requests availability (submit_work_order), invited providers
-- respond Available/Not Available, and the client CONFIRMS one provider
-- via confirm_work_order_msp (sets work_orders.status='confirmed',
-- confirmed_provider_id, pii_released_at). The ONLY missing piece for
-- billing is that this confirmation never creates a client_providers row
-- or stamps an acquisition_source — so the platform-fee resolver never
-- sees the relationship.
--
-- This migration adds an AFTER-UPDATE trigger on work_orders that, when a
-- work order transitions INTO 'confirmed' with a provider, creates the
-- client_providers binding with acquisition_source='directory_request'.
-- (A trigger is used instead of editing the ~110-line SECURITY DEFINER
-- confirm_work_order_msp RPC: it captures the exact same conversion event,
-- is strictly additive, and avoids reproducing a critical function verbatim.)
--
-- Mapping: the work-order requester (work_orders.agent_user_id) is the
-- billing "client"; work_orders.confirmed_provider_id is the provider.
-- This honors the locked invariants: provider availability/response does
-- NOT bind (no row on invite/respond); only the CLIENT confirming a
-- provider binds (status->'confirmed').
--
-- Companion (folded into the unapplied staged migrations, NOT here):
--   * directory_request is now a 4th acquisition_source in the CHECKs +
--     fee-schedule seed of 20260528400000 (3.0) and the invitations CHECK
--     of 20260529020000 (3.4); ALLOWED_SOURCES in create-connect-checkout
--     (3.1). directory_request bills the Marketplace tier ($20-$60), same
--     as map_oracle. See BACKEND_ACTIVATION_PHASE_3_6.md.
--
-- Prerequisite: Phase 3.0 (client_providers.acquisition_source + the
-- directory_request value in its CHECK). The work_orders table is legacy
-- (already on main). Strictly additive: no DROP/DELETE/TRUNCATE, no policy
-- or column change, no destructive ALTER. Idempotent.
-- ============================================================

CREATE OR REPLACE FUNCTION public._link_client_provider_on_work_order_confirm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Fire only on the transition INTO 'confirmed' with a provider set.
  -- (The trigger is declared on UPDATE OF status, confirmed_provider_id,
  --  so it only runs when those change; this guard makes it idempotent
  --  and ignores re-saves of an already-confirmed row.)
  IF NEW.status = 'confirmed'::public.work_order_status
     AND NEW.confirmed_provider_id IS NOT NULL
     AND NEW.agent_user_id IS NOT NULL
     AND (
          OLD.status IS DISTINCT FROM 'confirmed'::public.work_order_status
          OR OLD.confirmed_provider_id IS DISTINCT FROM NEW.confirmed_provider_id
         )
  THEN
    -- The client (the requesting agent) has selected this provider.
    -- Create the billing relationship, stamped Marketplace-origin.
    -- ON CONFLICT DO NOTHING preserves an existing link's origin
    -- (acquisition_source is set-once; a prior scs_direct link wins).
    INSERT INTO public.client_providers (client_id, provider_id, acquisition_source)
    VALUES (NEW.agent_user_id, NEW.confirmed_provider_id, 'directory_request')
    ON CONFLICT (client_id, provider_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER trg_work_order_confirm_links_client_provider
    AFTER UPDATE OF status, confirmed_provider_id ON public.work_orders
    FOR EACH ROW
    EXECUTE FUNCTION public._link_client_provider_on_work_order_confirm();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- End of Phase 3.6. After this, a directory-confirmed client resolves to
-- the Marketplace fee schedule automatically when the confirmed provider
-- delivers a presentation (existing Phase 3.1 checkout) — no checkout,
-- webhook, pricing, or UI change.
-- ============================================================
