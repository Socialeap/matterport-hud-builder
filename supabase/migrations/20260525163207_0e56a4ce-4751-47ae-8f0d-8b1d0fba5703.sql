
CREATE OR REPLACE FUNCTION public.admin_grant_tier(
  _provider_id uuid,
  _tier public.app_tier,
  _expires_at timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _grant_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can grant tiers';
  END IF;

  INSERT INTO public.admin_grants (provider_id, granted_by, tier, expires_at)
  VALUES (_provider_id, auth.uid(), _tier, _expires_at)
  RETURNING id INTO _grant_id;

  INSERT INTO public.licenses (user_id, tier, license_status, license_expiry)
  VALUES (_provider_id, _tier, 'active'::public.license_status, _expires_at)
  ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        license_status = 'active'::public.license_status,
        license_expiry = EXCLUDED.license_expiry,
        updated_at = now();

  INSERT INTO public.branding_settings (provider_id, tier)
  VALUES (_provider_id, _tier)
  ON CONFLICT (provider_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        updated_at = now();

  RETURN _grant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_grant(_grant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _provider uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke grants';
  END IF;

  UPDATE public.admin_grants
    SET revoked_at = now()
    WHERE id = _grant_id
    RETURNING provider_id INTO _provider;

  IF _provider IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.licenses
    SET tier = 'starter'::public.app_tier,
        license_status = 'active'::public.license_status,
        license_expiry = NULL,
        updated_at = now()
    WHERE user_id = _provider;

  UPDATE public.branding_settings
    SET tier = 'starter'::public.app_tier,
        updated_at = now()
    WHERE provider_id = _provider;
END;
$$;

-- Ensure branding_settings.provider_id is uniquely constrained so the
-- ON CONFLICT clauses above (and in the webhook) target a real index.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'branding_settings'
      AND indexname = 'branding_settings_provider_id_key'
  ) THEN
    ALTER TABLE public.branding_settings
      ADD CONSTRAINT branding_settings_provider_id_key UNIQUE (provider_id);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.admin_grant_tier(uuid, public.app_tier, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_grant(uuid) TO authenticated;
