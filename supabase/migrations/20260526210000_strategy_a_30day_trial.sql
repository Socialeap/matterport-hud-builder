-- ============================================================
-- Strategy A: 30-Day Trial · First Presentation Free
--
-- 1. Add grant_reason column to admin_grants
-- 2. Self-service trial provisioning RPC
-- 3. Update purge_stale_trial_studios() to enforce 60-day
--    post-grant-expiry window (Day 90 from onboarding)
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1 ─ Extend admin_grants with grant_reason
-- ────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_grants
  ADD COLUMN IF NOT EXISTS grant_reason text;

COMMENT ON COLUMN public.admin_grants.grant_reason IS
  'Human-readable reason for this grant (e.g. trial strategy identifier).';

-- ────────────────────────────────────────────────────────────────
-- 2 ─ Self-service 30-day trial activation
--     Callable by any authenticated user. Creates a provider role
--     and a time-bound evaluation grant in a single transaction.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_trial_grant(_tier public.app_tier)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_grant_id uuid;
  v_existing_grant_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Block if the user already has paid access (license, purchase, or active admin grant).
  IF (SELECT public.provider_has_paid_access(v_user_id)) THEN
    RAISE EXCEPTION 'Already has paid access';
  END IF;

  -- If an active Strategy A trial grant already exists, update its tier and return.
  SELECT id INTO v_existing_grant_id
    FROM public.admin_grants
   WHERE provider_id = v_user_id
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())
     AND grant_reason = '30-Day Evaluation: Strategy A First Presentation Free'
   LIMIT 1;

  IF v_existing_grant_id IS NOT NULL THEN
    UPDATE public.admin_grants
       SET tier = _tier
     WHERE id = v_existing_grant_id;
    RETURN v_existing_grant_id;
  END IF;

  -- Ensure provider role exists.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = v_user_id AND role = 'provider'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'provider');
  END IF;

  -- Create 30-day evaluation grant (1 free published presentation).
  INSERT INTO public.admin_grants
    (provider_id, granted_by, tier, expires_at, grant_reason)
  VALUES (
    v_user_id,
    v_user_id,
    _tier,
    now() + INTERVAL '30 days',
    '30-Day Evaluation: Strategy A First Presentation Free'
  )
  RETURNING id INTO v_grant_id;

  RETURN v_grant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_trial_grant(public.app_tier) TO authenticated;

-- ────────────────────────────────────────────────────────────────
-- 3 ─ Updated purge function
--     Now also checks that any admin_grants.expires_at is older
--     than 60 days, so a 30-day trial grant protects data until
--     Day 90 from onboarding (30-day trial + 60-day retention).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_stale_trial_studios()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_deleted INTEGER := 0;
  v_cutoff TIMESTAMPTZ := now() - INTERVAL '60 days';
  rec RECORD;
  v_file RECORD;
BEGIN
  FOR rec IN
    SELECT bs.provider_id, bs.id AS branding_id, bs.slug,
           bs.logo_url, bs.favicon_url, bs.hero_bg_url
      FROM public.branding_settings bs
     WHERE bs.updated_at < v_cutoff
       -- No active license
       AND NOT EXISTS (
         SELECT 1 FROM public.licenses
         WHERE user_id = bs.provider_id
           AND license_status = 'active'
           AND (license_expiry IS NULL OR license_expiry > now())
       )
       -- No completed purchase
       AND NOT EXISTS (
         SELECT 1 FROM public.purchases
         WHERE user_id = bs.provider_id
           AND status = 'completed'
           AND product_id IN ('starter_tier', 'pro_tier', 'pro_upgrade')
       )
       -- No admin grant that is either active OR expired within the last 60 days
       AND NOT EXISTS (
         SELECT 1 FROM public.admin_grants
         WHERE provider_id = bs.provider_id
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > v_cutoff)
       )
     LIMIT 100
  LOOP
    -- Delete brand-assets storage objects
    BEGIN
      FOR v_file IN
        SELECT name FROM storage.objects
        WHERE bucket_id = 'brand-assets'
          AND name LIKE rec.provider_id::text || '/%'
      LOOP
        BEGIN
          DELETE FROM storage.objects
           WHERE bucket_id = 'brand-assets'
             AND name = v_file.name;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'purge_stale_trial_studios: storage delete failed for brand-assets/%: %',
            v_file.name, SQLERRM;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'purge_stale_trial_studios: brand-assets scan failed for %: %',
        rec.provider_id, SQLERRM;
    END;

    -- Delete vault-assets storage objects
    BEGIN
      FOR v_file IN
        SELECT name FROM storage.objects
        WHERE bucket_id = 'vault-assets'
          AND name LIKE rec.provider_id::text || '/%'
      LOOP
        BEGIN
          DELETE FROM storage.objects
           WHERE bucket_id = 'vault-assets'
             AND name = v_file.name;
        EXCEPTION WHEN OTHERS THEN
          RAISE NOTICE 'purge_stale_trial_studios: vault-assets delete failed for %: %',
            v_file.name, SQLERRM;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'purge_stale_trial_studios: vault-assets scan failed for %: %',
        rec.provider_id, SQLERRM;
    END;

    -- Flush studio preview tokens
    BEGIN
      DELETE FROM public.studio_preview_tokens
       WHERE provider_id = rec.provider_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'purge_stale_trial_studios: preview token cleanup failed for %: %',
        rec.provider_id, SQLERRM;
    END;

    -- Hard-delete branding configuration
    BEGIN
      DELETE FROM public.branding_settings
       WHERE id = rec.branding_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'purge_stale_trial_studios: branding delete failed for %: %',
        rec.provider_id, SQLERRM;
    END;

    v_deleted := v_deleted + 1;
  END LOOP;

  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_stale_trial_studios() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_stale_trial_studios() TO service_role;
