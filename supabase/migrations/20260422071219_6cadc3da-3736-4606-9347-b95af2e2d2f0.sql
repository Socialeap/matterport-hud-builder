-- Drop the old STABLE version (signature changes, so DROP first)
DROP FUNCTION IF EXISTS public.resolve_studio_access(uuid);

CREATE OR REPLACE FUNCTION public.resolve_studio_access(_provider_id uuid)
RETURNS TABLE(
  linked boolean,
  invitation_status text,
  is_free boolean,
  pricing_configured boolean,
  payouts_ready boolean,
  provider_brand_name text,
  viewer_role text,
  viewer_matches_provider boolean
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
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
  v_role text := 'unknown';
  v_matches_provider boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, false, false, false, ''::text, 'unknown'::text, false;
    RETURN;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Determine viewer role (priority: admin > provider > client > unknown)
  IF public.has_role(v_user_id, 'admin'::public.app_role) THEN
    v_role := 'admin';
  ELSIF public.has_role(v_user_id, 'provider'::public.app_role) THEN
    v_role := 'provider';
  ELSIF public.has_role(v_user_id, 'client'::public.app_role) THEN
    v_role := 'client';
  ELSE
    v_role := 'unknown';
  END IF;

  v_matches_provider := (v_user_id = _provider_id);

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
  viewer_role := v_role;
  viewer_matches_provider := v_matches_provider;

  RETURN NEXT;
END;
$function$;