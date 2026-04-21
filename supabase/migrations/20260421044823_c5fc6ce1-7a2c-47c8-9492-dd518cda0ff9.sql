-- 1) Update handle_new_user to UPSERT client_providers with is_free sync
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
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

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
      -- Link client to provider, propagating is_free attribute (UPSERT to heal stale rows)
      INSERT INTO public.client_providers (client_id, provider_id, is_free)
      VALUES (NEW.id, v_invitation.provider_id, COALESCE(v_invitation.is_free, false))
      ON CONFLICT (client_id, provider_id)
      DO UPDATE SET is_free = EXCLUDED.is_free;

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
  END IF;

  RETURN NEW;
END;
$function$;

-- 2) Update accept_invitation_self to UPSERT client_providers with is_free sync
CREATE OR REPLACE FUNCTION public.accept_invitation_self(_token uuid)
 RETURNS TABLE(provider_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invitation RECORD;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL THEN
    RAISE EXCEPTION 'User not found' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE token = _token
  LIMIT 1;

  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_invitation.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'Invitation is no longer pending' USING ERRCODE = 'P0001';
  END IF;
  IF v_invitation.expires_at <= now() AND v_invitation.status = 'pending' THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = 'P0001';
  END IF;
  IF lower(v_invitation.email) <> lower(v_user_email) THEN
    RAISE EXCEPTION 'Invitation email does not match the signed-in user' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.client_providers (client_id, provider_id, is_free)
  VALUES (v_user_id, v_invitation.provider_id, COALESCE(v_invitation.is_free, false))
  ON CONFLICT (client_id, provider_id)
  DO UPDATE SET is_free = EXCLUDED.is_free;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;

  UPDATE public.profiles
  SET provider_id = v_invitation.provider_id
  WHERE user_id = v_user_id;

  UPDATE public.invitations
  SET status = 'accepted', updated_at = now()
  WHERE id = v_invitation.id;

  provider_id := v_invitation.provider_id;
  RETURN NEXT;
END;
$function$;

-- 3) Ensure unique constraint on (client_id, provider_id) exists for upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_providers_client_provider_unique'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'client_providers_client_id_provider_id_key'
  ) THEN
    ALTER TABLE public.client_providers
    ADD CONSTRAINT client_providers_client_provider_unique UNIQUE (client_id, provider_id);
  END IF;
END $$;

-- 4) Allow updates so the upsert DO UPDATE clause works under RLS
DROP POLICY IF EXISTS "Users can update their own client_provider link via upsert" ON public.client_providers;
CREATE POLICY "Users can update their own client_provider link via upsert"
ON public.client_providers
FOR UPDATE
TO authenticated
USING (client_id = auth.uid())
WITH CHECK (client_id = auth.uid());

-- 5) One-time reconciliation: heal accepted invitations that have no/stale client_providers row
INSERT INTO public.client_providers (client_id, provider_id, is_free)
SELECT DISTINCT ON (au.id, i.provider_id)
  au.id, i.provider_id, COALESCE(i.is_free, false)
FROM public.invitations i
JOIN auth.users au ON lower(au.email) = lower(i.email)
WHERE i.status = 'accepted'
ORDER BY au.id, i.provider_id, i.updated_at DESC
ON CONFLICT (client_id, provider_id)
DO UPDATE SET is_free = EXCLUDED.is_free;

-- Also ensure profiles.provider_id is set
UPDATE public.profiles p
SET provider_id = sub.provider_id
FROM (
  SELECT DISTINCT ON (au.id) au.id AS user_id, i.provider_id
  FROM public.invitations i
  JOIN auth.users au ON lower(au.email) = lower(i.email)
  WHERE i.status = 'accepted'
  ORDER BY au.id, i.updated_at DESC
) sub
WHERE p.user_id = sub.user_id
  AND (p.provider_id IS NULL OR p.provider_id <> sub.provider_id);

-- Ensure client roles exist for every reconciled link
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT cp.client_id, 'client'::public.app_role
FROM public.client_providers cp
ON CONFLICT (user_id, role) DO NOTHING;

-- 6) Authoritative entitlement resolver: returns one payload for studio access
CREATE OR REPLACE FUNCTION public.resolve_studio_access(_provider_id uuid)
 RETURNS TABLE(
   linked boolean,
   invitation_status text,
   is_free boolean,
   pricing_configured boolean,
   payouts_ready boolean,
   provider_brand_name text
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_link RECORD;
  v_invitation RECORD;
  v_branding RECORD;
  v_effective_is_free boolean := false;
  v_effective_linked boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, ''::text;
    RETURN;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_link
  FROM public.client_providers
  WHERE client_id = v_user_id AND provider_id = _provider_id
  LIMIT 1;

  SELECT * INTO v_invitation
  FROM public.invitations
  WHERE provider_id = _provider_id
    AND lower(email) = lower(COALESCE(v_user_email, ''))
  ORDER BY updated_at DESC
  LIMIT 1;

  -- Auto-heal: if accepted invitation exists but link is missing or stale, fix it
  IF v_invitation.id IS NOT NULL AND v_invitation.status = 'accepted' THEN
    INSERT INTO public.client_providers (client_id, provider_id, is_free)
    VALUES (v_user_id, _provider_id, COALESCE(v_invitation.is_free, false))
    ON CONFLICT (client_id, provider_id)
    DO UPDATE SET is_free = EXCLUDED.is_free;

    -- Re-read after heal
    SELECT * INTO v_link
    FROM public.client_providers
    WHERE client_id = v_user_id AND provider_id = _provider_id
    LIMIT 1;
  END IF;

  v_effective_linked := v_link.client_id IS NOT NULL;
  v_effective_is_free := COALESCE(v_link.is_free, false);

  SELECT
    brand_name,
    use_flat_pricing,
    flat_price_per_model_cents,
    base_price_cents,
    tier3_price_cents,
    additional_model_fee_cents,
    stripe_connect_id,
    stripe_onboarding_complete
  INTO v_branding
  FROM public.branding_settings
  WHERE provider_id = _provider_id;

  linked := v_effective_linked;
  invitation_status := COALESCE(v_invitation.status::text, NULL);
  is_free := v_effective_is_free;
  pricing_configured := CASE
    WHEN v_branding.use_flat_pricing THEN COALESCE(v_branding.flat_price_per_model_cents, 0) > 0
    ELSE COALESCE(v_branding.base_price_cents, 0) > 0
  END;
  payouts_ready := COALESCE(v_branding.stripe_onboarding_complete, false)
                   AND v_branding.stripe_connect_id IS NOT NULL;
  provider_brand_name := COALESCE(v_branding.brand_name, '');

  RETURN NEXT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_studio_access(uuid) TO authenticated;