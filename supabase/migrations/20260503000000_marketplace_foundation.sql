-- ============================================================
-- 3DPS Marketplace Foundation (PR 1)
-- ------------------------------------------------------------
-- Adds the data foundation for the agent/MSP marketplace:
--   * Marketplace listing fields on branding_settings
--   * agent_beacons table (Demand Beacons)
--   * beacon_notifications table (idempotency for PR 3 matcher)
--   * handle_new_user backfills a branding_settings row for
--     self-signup providers so they can opt into the directory
--     immediately.
--
-- Out of scope (later PRs):
--   * Public Opportunity Board view (PR 2)
--   * Match-emails Edge Function & MSP digest (PR 3)
--   * Provider-scoped beacon read RPC (PR 3)
--   * Lat/lng geocoding pipeline (PR 3+) — columns are added
--     here as nullable so a future PR can layer on radius
--     search without another migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Marketplace specialty enum
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.marketplace_specialty AS ENUM (
    'residential',
    'luxury',
    'commercial',
    'new-construction',
    'multi-family',
    'vacation-rental',
    'ai-specialist',
    'cinema-mode-specialist'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 2. branding_settings: marketplace listing columns
-- ------------------------------------------------------------
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS primary_city TEXT,
  ADD COLUMN IF NOT EXISTS region TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT NOT NULL DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS service_radius_miles INTEGER,
  ADD COLUMN IF NOT EXISTS service_zips TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9, 6),
  ADD COLUMN IF NOT EXISTS is_directory_public BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS specialties public.marketplace_specialty[]
    NOT NULL DEFAULT '{}'::public.marketplace_specialty[];

-- Sanity check: radius must be positive when present, country must be 2 letters.
DO $$ BEGIN
  ALTER TABLE public.branding_settings
    ADD CONSTRAINT branding_service_radius_positive
    CHECK (service_radius_miles IS NULL OR service_radius_miles > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.branding_settings
    ADD CONSTRAINT branding_country_iso2
    CHECK (country ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes for directory search (PR 2 will use these)
CREATE INDEX IF NOT EXISTS idx_branding_directory_public
  ON public.branding_settings (is_directory_public)
  WHERE is_directory_public = TRUE;

CREATE INDEX IF NOT EXISTS idx_branding_primary_city
  ON public.branding_settings (lower(primary_city), lower(region))
  WHERE is_directory_public = TRUE;

CREATE INDEX IF NOT EXISTS idx_branding_service_zips
  ON public.branding_settings USING GIN (service_zips)
  WHERE is_directory_public = TRUE;

-- ------------------------------------------------------------
-- 3. agent_beacons: capture agent demand
-- ------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.beacon_status AS ENUM (
    'waiting',
    'matched',
    'unsubscribed',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_beacons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  name TEXT,
  brokerage TEXT,
  city TEXT NOT NULL,
  region TEXT,
  zip TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  consent_given BOOLEAN NOT NULL,
  consent_text TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_ip TEXT,
  user_agent TEXT,
  status public.beacon_status NOT NULL DEFAULT 'waiting',
  matched_provider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  matched_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One beacon per (lower(email), lower(city)). Re-submission upserts
-- and refreshes expires_at; per the agreed dedup rule.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_beacons_email_city_unique
  ON public.agent_beacons (lower(email), lower(city));

CREATE INDEX IF NOT EXISTS idx_agent_beacons_status_city
  ON public.agent_beacons (status, lower(city));

CREATE INDEX IF NOT EXISTS idx_agent_beacons_zip
  ON public.agent_beacons (zip)
  WHERE zip IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_beacons_expires
  ON public.agent_beacons (expires_at)
  WHERE status = 'waiting';

-- Country MUST be US for now (single-jurisdiction consent model).
DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    ADD CONSTRAINT agent_beacons_country_us_only
    CHECK (country = 'US');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Consent must be explicitly TRUE; the captured text is preserved
-- for evidence purposes (CAN-SPAM/legal record).
DO $$ BEGIN
  ALTER TABLE public.agent_beacons
    ADD CONSTRAINT agent_beacons_consent_required
    CHECK (consent_given = TRUE AND length(consent_text) > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- updated_at trigger
DO $$ BEGIN
  CREATE TRIGGER update_agent_beacons_updated_at
    BEFORE UPDATE ON public.agent_beacons
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.agent_beacons ENABLE ROW LEVEL SECURITY;

-- Service role: full access (Edge Functions, matcher).
DO $$ BEGIN
  CREATE POLICY "Service role can manage beacons"
    ON public.agent_beacons FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Admins can read all beacons (operator visibility).
DO $$ BEGIN
  CREATE POLICY "Admins can read beacons"
    ON public.agent_beacons FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NOTE: providers do NOT get direct SELECT access in PR 1.
-- PR 3 will add a security-definer RPC `get_my_matched_beacons()`
-- that returns only beacons matching the caller's service area
-- AND only when the caller has an active Pro license. That is the
-- ONLY surface through which a provider sees beacon PII.

-- ------------------------------------------------------------
-- 4. beacon_notifications: idempotency for the future matcher
-- ------------------------------------------------------------
-- PR 3 will write here when emailing an agent that an MSP has
-- activated in their city; the unique constraint guarantees we
-- never double-fire even if branding_settings is edited many times.
CREATE TABLE IF NOT EXISTS public.beacon_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  beacon_id UUID NOT NULL REFERENCES public.agent_beacons(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('first_match', 'reengagement')),
  email_send_log_id UUID REFERENCES public.email_send_log(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (beacon_id, provider_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_beacon_notifications_beacon
  ON public.beacon_notifications (beacon_id);

CREATE INDEX IF NOT EXISTS idx_beacon_notifications_provider
  ON public.beacon_notifications (provider_id);

ALTER TABLE public.beacon_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Service role can manage beacon_notifications"
    ON public.beacon_notifications FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admins can read beacon_notifications"
    ON public.beacon_notifications FOR SELECT
    USING (public.has_role(auth.uid(), 'admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 5. handle_new_user: ensure branding_settings exists for
--    self-signup providers (i.e. signups WITHOUT an invite token)
-- ------------------------------------------------------------
-- The branding row is what unlocks marketplace participation, so
-- creating it eagerly means an MSP can flip is_directory_public
-- the moment they land on /dashboard/branding.
--
-- Wrapped in EXCEPTION blocks: a failure here MUST NOT block
-- signup, since this is a SECURITY DEFINER trigger on auth.users.
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
      -- Link client to provider, propagating is_free attribute
      INSERT INTO public.client_providers (client_id, provider_id, is_free)
      VALUES (NEW.id, v_invitation.provider_id, COALESCE(v_invitation.is_free, false))
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

-- ------------------------------------------------------------
-- 6. Backfill: seed branding_settings rows for existing
--    self-signup users that don't have one yet.
-- ------------------------------------------------------------
-- A user is a "self-signup provider" candidate if they have no
-- profiles.provider_id set (i.e. were not invited as a client).
INSERT INTO public.branding_settings (provider_id)
SELECT u.id
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE COALESCE(p.provider_id, NULL) IS NULL
ON CONFLICT (provider_id) DO NOTHING;

-- ============================================================
-- End of marketplace foundation migration
-- ============================================================
