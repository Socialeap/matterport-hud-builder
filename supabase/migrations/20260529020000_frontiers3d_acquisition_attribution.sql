-- ============================================================
-- Frontiers3D — Phase 3.4: Acquisition Attribution Pipe (additive)
-- ------------------------------------------------------------
-- Makes client_providers.acquisition_source (Phase 3.0) actually carry
-- the lead origin, by propagating it from the invitation that created
-- the relationship — exactly mirroring the existing is_free propagation.
--
-- WHY: Phase 3.1 checkout resolves the platform fee from
-- client_providers.acquisition_source (Marketplace $20–$60 vs Direct
-- $10–$30). Today every client_providers row is created from a manual
-- provider invitation (handle_new_user) and defaults to 'scs_direct'.
-- This phase adds the attribution PIPE so that when a marketplace-
-- originated invitation is created (Map Oracle / agent-form), its
-- acquisition_source flows through to the client_providers link and the
-- Marketplace fee schedule applies.
--
-- This phase is the PLUMBING only. It has no behavioral effect on its
-- own: the sole invitation-creation site today (provider "invite client"
-- in /dashboard/clients) is genuinely Direct, so every invitation keeps
-- defaulting to 'scs_direct'. The map_oracle/agent_form STAMPING is a
-- dependent follow-up — see BACKEND_ACTIVATION_PHASE_3_4.md "The remaining
-- step (B)". It needs Phase 2 (agent_beacons.source) and the not-yet-built
-- Map-Oracle lead→client conversion flow.
--
-- Strictly additive: one column on invitations + a CREATE OR REPLACE of
-- handle_new_user that reproduces the current body verbatim and adds a
-- single propagated value. No DROP/DELETE/TRUNCATE, no policy/RLS change,
-- no destructive ALTER. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1. invitations.acquisition_source — mirrors invitations.is_free.
--    Set by whoever creates the invitation; defaults to the safe Direct
--    value. The manual provider-invite path needs no change (default).
-- ------------------------------------------------------------
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT NOT NULL DEFAULT 'scs_direct';

DO $$ BEGIN
  ALTER TABLE public.invitations
    ADD CONSTRAINT invitations_acquisition_source_check
    CHECK (acquisition_source IN ('map_oracle', 'agent_form', 'directory_request', 'scs_direct'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. handle_new_user — reproduced verbatim from the current definition
--    (20260503000000_marketplace_foundation.sql) with ONE change: the
--    client_providers INSERT now also propagates acquisition_source from
--    the invitation (COALESCE to 'scs_direct'), exactly as it already
--    propagates is_free. Everything else is byte-for-byte identical.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_token uuid;
  v_invitation RECORD;
BEGIN
  -- Create profile
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  EXCEPTION WHEN OTHERS THEN
    -- Profile creation failure should never block signup.
    RAISE WARNING 'handle_new_user: profile insert failed for %: %', NEW.id, SQLERRM;
  END;

  -- Check for invite token
  v_token := (NEW.raw_user_meta_data->>'invite_token')::uuid;

  IF v_token IS NOT NULL THEN
    SELECT * INTO v_invitation
    FROM public.invitations
    WHERE token = v_token
      AND status = 'pending'
      AND expires_at > now()
    LIMIT 1;

    IF v_invitation.id IS NOT NULL THEN
      -- Link client to provider, propagating is_free + acquisition_source
      INSERT INTO public.client_providers (client_id, provider_id, is_free, acquisition_source)
      VALUES (
        NEW.id,
        v_invitation.provider_id,
        COALESCE(v_invitation.is_free, false),
        COALESCE(v_invitation.acquisition_source, 'scs_direct')
      )
      ON CONFLICT DO NOTHING;

      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, 'client')
      ON CONFLICT (user_id, role) DO NOTHING;

      UPDATE public.profiles
      SET provider_id = v_invitation.provider_id
      WHERE user_id = NEW.id;

      UPDATE public.invitations
      SET status = 'accepted', updated_at = now()
      WHERE id = v_invitation.id;
    END IF;
  ELSE
    -- Self-signup path = treat as a provider/MSP.
    -- Seed an empty branding_settings row so the MSP can immediately
    -- configure marketplace listing fields without an upsert race.
    BEGIN
      INSERT INTO public.branding_settings (provider_id)
      VALUES (NEW.id)
      ON CONFLICT (provider_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'handle_new_user: branding_settings seed failed for %: %', NEW.id, SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============================================================
-- End of Phase 3.4. The trigger that calls handle_new_user
-- (on auth.users) is the existing legacy trigger — unchanged.
-- ============================================================
