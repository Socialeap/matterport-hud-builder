-- ============================================================
-- STALE PREVIEW PAYWALL (14-DAY GRACE) + DATA RECLAMATION (60-DAY)
--
-- Task 1: After a trial/license is expired/inactive for 14+ days,
--          preview tokens are no longer issued — the in-app preview
--          becomes a hard paywall.
--
-- Task 2: After 60+ days of inactivity on an unconverted trial,
--          purge all related storage objects and studio configuration
--          to reclaim space.
-- ============================================================

-- ────────────────────────────────────────────────────────────────
-- 1 ─ New RPC: provider_preview_allowed
--     Returns TRUE only if the provider has paid access OR is within
--     the 14-day grace period after expiration/inactivity.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_preview_allowed(_provider_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_paid boolean;
  v_grace_cutoff timestamptz := now() - INTERVAL '14 days';
  v_within_grace boolean := false;
BEGIN
  -- If provider has full paid access, always allowed.
  SELECT public.provider_has_paid_access(_provider_id) INTO v_has_paid;
  IF v_has_paid THEN
    RETURN TRUE;
  END IF;

  -- Check grace period: license existed but expired/went inactive within 14 days
  SELECT EXISTS (
    SELECT 1 FROM public.licenses
    WHERE user_id = _provider_id
      AND (
        -- License expired but within grace window
        (license_expiry IS NOT NULL AND license_expiry > v_grace_cutoff)
        OR
        -- License went inactive (updated_at as proxy for status change) within grace
        (license_status != 'active' AND updated_at > v_grace_cutoff)
      )
  ) INTO v_within_grace;

  IF v_within_grace THEN
    RETURN TRUE;
  END IF;

  -- Check admin grants that expired within grace period
  SELECT EXISTS (
    SELECT 1 FROM public.admin_grants
    WHERE provider_id = _provider_id
      AND (
        (expires_at IS NOT NULL AND expires_at > v_grace_cutoff)
        OR
        (revoked_at IS NOT NULL AND revoked_at > v_grace_cutoff)
      )
  ) INTO v_within_grace;

  IF v_within_grace THEN
    RETURN TRUE;
  END IF;

  -- Provider who never had any license/grant is within grace if their
  -- account (branding row) was created within 14 days.
  SELECT EXISTS (
    SELECT 1 FROM public.branding_settings
    WHERE provider_id = _provider_id
      AND created_at > v_grace_cutoff
  ) INTO v_within_grace;

  RETURN v_within_grace;
END;
$$;

GRANT EXECUTE ON FUNCTION public.provider_preview_allowed(uuid) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────
-- 2 ─ Data Reclamation: purge_stale_trial_studios()
--     Modeled after purge_expired_ephemeral_assets().
--     Targets providers with no active license/purchase/grant
--     who have been inactive for 60+ days.
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
  -- Find providers whose branding was last updated 60+ days ago,
  -- who have NO active license, NO completed purchase, and NO active grant.
  FOR rec IN
    SELECT bs.provider_id, bs.id AS branding_id, bs.slug,
           bs.logo_url, bs.favicon_url, bs.hero_bg_url
      FROM public.branding_settings bs
     WHERE bs.updated_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1 FROM public.licenses
         WHERE user_id = bs.provider_id
           AND license_status = 'active'
           AND (license_expiry IS NULL OR license_expiry > now())
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.purchases
         WHERE user_id = bs.provider_id
           AND status = 'completed'
           AND product_id IN ('starter_tier', 'pro_tier', 'pro_upgrade')
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.admin_grants
         WHERE provider_id = bs.provider_id
           AND revoked_at IS NULL
           AND (expires_at IS NULL OR expires_at > now())
       )
     LIMIT 100
  LOOP
    -- Delete all storage objects under this provider's folder in brand-assets.
    -- Files are stored as {provider_id}/filename in the brand-assets bucket.
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

    -- Delete any vault-assets for this provider
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

    -- Clear expired studio preview tokens for this provider
    BEGIN
      DELETE FROM public.studio_preview_tokens
       WHERE provider_id = rec.provider_id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'purge_stale_trial_studios: preview token cleanup failed for %: %',
        rec.provider_id, SQLERRM;
    END;

    -- Hard-delete the branding configuration row
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

-- 3 ─ Daily cron: 03:50 UTC (off-peak, after ephemeral purge at 03:45).
DO $$ BEGIN
  PERFORM cron.unschedule('purge_stale_trial_studios');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge_stale_trial_studios',
  '50 3 * * *',
  $cron$ SELECT public.purge_stale_trial_studios(); $cron$
);
