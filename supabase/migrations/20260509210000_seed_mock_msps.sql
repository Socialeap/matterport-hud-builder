-- =============================================================================
-- Seed mock MSP accounts for Work Order matching tests
-- =============================================================================
-- Materializes the 6 hardcoded MOCK_MSPS in src/routes/agents.tsx as fully
-- functional auth users + 2 extra Atlanta Pros (so the city has 3 Pros total
-- and the ≥3-Pros / 24h priority window branch is reachable).
--
-- Each mock MSP gets the full row chain required to pass:
--   * _provider_can_receive_leads (paid + listed + score ≥ 0.70)
--   * _is_provider_serving_work_order (4-tier geo)
--   * essential_services <@ branding_settings.specialties
--
-- Cleanup: every seeded auth.users row is tagged with
--   raw_app_meta_data->>'seed_source' = 'mock-msp-v1'
-- so a single SELECT public.cleanup_seed_msps() purges everything.
--
-- Loginable: shared password 'SeedPass!2026' on every account so a tester can
-- pick any persona via /login. Replace the v_email_domain literal below with
-- a domain the team owns (catch-all + plus-addressing) before pushing to a
-- shared environment.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email_domain TEXT := 'transcendencemedia.com';   -- swap before publishing
  v_seed_password TEXT := 'SeedPass!2026';
  v_seed_source  TEXT := 'mock-msp-v1';

  v_msp RECORD;
  v_uid UUID;
  v_email TEXT;
  v_existing_uid UUID;

  -- 8 mock MSPs: 6 originals (Atlanta, San Diego, Chicago, Austin, Denver,
  -- Boston) + 2 extra Atlanta Pros (Peachtree, Sweetwater) so Atlanta has 3
  -- Pros and the 24h window branch is reachable.
  v_seeds CONSTANT JSONB := jsonb_build_array(
    -- 1. Skyline 3D Studios — Atlanta Pro #1 (Excellent standing)
    jsonb_build_object(
      'slug',          'skyline-3d-studios',
      'brand_name',    'Skyline 3D Studios',
      'tier',          'pro',
      'standing',      1.50,
      'primary_city',  'Atlanta',
      'region',        'GA',
      'lat',           33.7490,
      'lng',           -84.3880,
      'service_radius_miles', 35,
      'service_zips',  jsonb_build_array('30303','30308','30318','30324','30327'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography',
        'scan-walkthrough-video-clips','scan-dimensional-measurements',
        'scan-same-day-turnaround','vault-sound-library','vault-portal-filters',
        'vault-interactive-widgets','vault-property-mapper','ai-lead-generation'
      )
    ),
    -- 2. Peachtree Capture Co. — Atlanta Pro #2 (Good)
    jsonb_build_object(
      'slug',          'peachtree-capture-co',
      'brand_name',    'Peachtree Capture Co.',
      'tier',          'pro',
      'standing',      1.00,
      'primary_city',  'Atlanta',
      'region',        'GA',
      'lat',           33.7701,
      'lng',           -84.3640,
      'service_radius_miles', 30,
      'service_zips',  jsonb_build_array('30303','30308','30318','30326','30342'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-walkthrough-video-clips',
        'scan-floor-plans','scan-same-day-turnaround','vault-sound-library',
        'vault-portal-filters','vault-property-mapper','ai-lead-generation'
      )
    ),
    -- 3. Sweetwater 3D Imaging — Atlanta Pro #3 (Good, low — closest to floor)
    jsonb_build_object(
      'slug',          'sweetwater-3d-imaging',
      'brand_name',    'Sweetwater 3D Imaging',
      'tier',          'pro',
      'standing',      0.85,
      'primary_city',  'Atlanta',
      'region',        'GA',
      'lat',           33.8650,
      'lng',           -84.4660,
      'service_radius_miles', 35,
      'service_zips',  jsonb_build_array('30327','30328','30338','30339','30342'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-twilight-photography','scan-floor-plans',
        'scan-dimensional-measurements','vault-portal-filters',
        'vault-interactive-widgets','vault-custom-icons','vault-property-mapper'
      )
    ),
    -- 4. Coastal Tour Co. — San Diego Starter
    jsonb_build_object(
      'slug',          'coastal-tour-co',
      'brand_name',    'Coastal Tour Co.',
      'tier',          'starter',
      'standing',      1.10,
      'primary_city',  'San Diego',
      'region',        'CA',
      'lat',           32.7157,
      'lng',           -117.1611,
      'service_radius_miles', 30,
      'service_zips',  jsonb_build_array('92101','92103','92109','92122','92130'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-walkthrough-video-clips',
        'scan-floor-plans','scan-dimensional-measurements','scan-same-day-turnaround',
        'vault-sound-library','vault-portal-filters','vault-custom-icons',
        'vault-property-mapper','ai-lead-generation'
      )
    ),
    -- 5. Lakeshore Immersive — Chicago Pro
    jsonb_build_object(
      'slug',          'lakeshore-immersive',
      'brand_name',    'Lakeshore Immersive',
      'tier',          'pro',
      'standing',      1.20,
      'primary_city',  'Chicago',
      'region',        'IL',
      'lat',           41.8781,
      'lng',           -87.6298,
      'service_radius_miles', 40,
      'service_zips',  jsonb_build_array('60601','60607','60614','60622','60654'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-twilight-photography','scan-walkthrough-video-clips',
        'scan-floor-plans','scan-dimensional-measurements','scan-same-day-turnaround',
        'vault-sound-library','vault-portal-filters','vault-interactive-widgets',
        'vault-custom-icons','vault-property-mapper'
      )
    ),
    -- 6. Lone Star Spaces — Austin Starter
    jsonb_build_object(
      'slug',          'lone-star-spaces',
      'brand_name',    'Lone Star Spaces',
      'tier',          'starter',
      'standing',      0.90,
      'primary_city',  'Austin',
      'region',        'TX',
      'lat',           30.2672,
      'lng',           -97.7431,
      'service_radius_miles', 40,
      'service_zips',  jsonb_build_array('78701','78704','78745','78751','78759'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography',
        'scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements',
        'scan-same-day-turnaround','vault-portal-filters','vault-interactive-widgets',
        'vault-custom-icons','ai-lead-generation'
      )
    ),
    -- 7. Mile High Matterworks — Denver Pro
    jsonb_build_object(
      'slug',          'mile-high-matterworks',
      'brand_name',    'Mile High Matterworks',
      'tier',          'pro',
      'standing',      1.30,
      'primary_city',  'Denver',
      'region',        'CO',
      'lat',           39.7392,
      'lng',           -104.9903,
      'service_radius_miles', 35,
      'service_zips',  jsonb_build_array('80202','80204','80206','80218','80246'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography',
        'scan-floor-plans','scan-same-day-turnaround','vault-sound-library',
        'vault-portal-filters','vault-interactive-widgets','vault-custom-icons',
        'vault-property-mapper','ai-lead-generation'
      )
    ),
    -- 8. Beacon Hill Tours — Boston Starter
    jsonb_build_object(
      'slug',          'beacon-hill-tours',
      'brand_name',    'Beacon Hill Tours',
      'tier',          'starter',
      'standing',      0.95,
      'primary_city',  'Boston',
      'region',        'MA',
      'lat',           42.3601,
      'lng',           -71.0589,
      'service_radius_miles', 30,
      'service_zips',  jsonb_build_array('02108','02115','02118','02129','02134'),
      'specialties',   jsonb_build_array(
        'scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography',
        'scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements',
        'vault-sound-library','vault-interactive-widgets','vault-custom-icons',
        'vault-property-mapper','ai-lead-generation'
      )
    )
  );
BEGIN
  FOR v_msp IN SELECT * FROM jsonb_array_elements(v_seeds)
  LOOP
    v_email := 'mock-msp+' || (v_msp.value->>'slug') || '@' || v_email_domain;

    -- Idempotency: if a previous run already inserted this seed user, reuse
    -- their UUID; otherwise mint a new one.
    SELECT id INTO v_existing_uid
      FROM auth.users
     WHERE email = v_email
       AND raw_app_meta_data->>'seed_source' = v_seed_source
     LIMIT 1;

    v_uid := COALESCE(v_existing_uid, gen_random_uuid());

    -- 1. auth.users — direct INSERT bypasses signup; email_confirmed_at must
    --    be non-null for sign-in. encrypted_password uses pgcrypto bcrypt.
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token,
      email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_uid,
      'authenticated',
      'authenticated',
      v_email,
      crypt(v_seed_password, gen_salt('bf')),
      now(),
      '', '', '', '',
      jsonb_build_object(
        'provider',     'email',
        'providers',    jsonb_build_array('email'),
        'seed_source',  v_seed_source
      ),
      jsonb_build_object(
        'full_name',    v_msp.value->>'brand_name',
        'seed_source',  v_seed_source
      ),
      now(), now(), false, false
    )
    ON CONFLICT (id) DO NOTHING;

    -- 2. auth.identities — required so signInWithPassword succeeds. Direct
    --    auth.users INSERT alone returns "Invalid login credentials".
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(),
      v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email),
      'email',
      v_uid::text,
      now(), now(), now()
    )
    ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 3. profiles — handle_new_user trigger will have already inserted on
    --    the auth.users INSERT, but we UPDATE to ensure display_name is set.
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (v_uid, v_msp.value->>'brand_name')
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          updated_at   = now();

    -- 4. user_roles — handle_new_user only assigns 'client' on invite-token
    --    signup. Add 'provider' explicitly.
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'provider'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- 5. branding_settings — full marketplace listing
    INSERT INTO public.branding_settings (
      provider_id, brand_name, slug, tier,
      is_directory_public, country, primary_city, region,
      latitude, longitude, service_radius_miles, service_zips,
      specialties, directory_contact_email, directory_phone,
      directory_website_url
    ) VALUES (
      v_uid,
      v_msp.value->>'brand_name',
      v_msp.value->>'slug',
      (v_msp.value->>'tier')::public.app_tier,
      TRUE,
      'US',
      v_msp.value->>'primary_city',
      v_msp.value->>'region',
      (v_msp.value->>'lat')::numeric,
      (v_msp.value->>'lng')::numeric,
      (v_msp.value->>'service_radius_miles')::integer,
      ARRAY(SELECT jsonb_array_elements_text(v_msp.value->'service_zips'))::text[],
      ARRAY(SELECT jsonb_array_elements_text(v_msp.value->'specialties'))::public.marketplace_specialty[],
      v_email,
      '+1-555-' || lpad((floor(random() * 9000 + 1000))::text, 4, '0'),
      'https://' || (v_msp.value->>'slug') || '.example.com'
    )
    ON CONFLICT (provider_id) DO UPDATE SET
      brand_name              = EXCLUDED.brand_name,
      slug                    = EXCLUDED.slug,
      tier                    = EXCLUDED.tier,
      is_directory_public     = EXCLUDED.is_directory_public,
      country                 = EXCLUDED.country,
      primary_city            = EXCLUDED.primary_city,
      region                  = EXCLUDED.region,
      latitude                = EXCLUDED.latitude,
      longitude               = EXCLUDED.longitude,
      service_radius_miles    = EXCLUDED.service_radius_miles,
      service_zips            = EXCLUDED.service_zips,
      specialties             = EXCLUDED.specialties,
      directory_contact_email = EXCLUDED.directory_contact_email,
      directory_website_url   = EXCLUDED.directory_website_url,
      updated_at              = now();

    -- 6. licenses — provider_has_paid_access requires active + non-expired.
    --    No UNIQUE on user_id, so we delete-then-insert. Safe for seeds since
    --    legitimate licenses are only created by the Stripe webhook flow.
    DELETE FROM public.licenses
     WHERE user_id = v_uid;

    INSERT INTO public.licenses (user_id, tier, license_status, license_expiry)
    VALUES (
      v_uid,
      (v_msp.value->>'tier')::public.app_tier,
      'active'::public.license_status,
      NULL
    );

    -- 7. provider_responsiveness — score spread drives Top-5 ranking.
    INSERT INTO public.provider_responsiveness (provider_id, score)
    VALUES (v_uid, (v_msp.value->>'standing')::numeric)
    ON CONFLICT (provider_id) DO UPDATE SET
      score      = EXCLUDED.score,
      updated_at = now();
  END LOOP;

  -- Visibility: surface the resulting row count in supabase db push output
  -- so the operator can confirm at a glance that all 8 mock MSPs landed and
  -- that the seed didn't silently abort halfway through.
  RAISE NOTICE 'seed_mock_msps: % auth.users tagged seed_source=mock-msp-v1', (
    SELECT count(*) FROM auth.users
     WHERE raw_app_meta_data->>'seed_source' = 'mock-msp-v1'
  );
  RAISE NOTICE 'seed_mock_msps: % public-directory branding_settings rows', (
    SELECT count(*) FROM public.branding_settings bs
     WHERE bs.is_directory_public = TRUE
       AND bs.provider_id IN (
         SELECT id FROM auth.users
          WHERE raw_app_meta_data->>'seed_source' = 'mock-msp-v1'
       )
  );
END $$;

-- =============================================================================
-- cleanup_seed_msps() — explicit teardown helper (service_role only)
-- =============================================================================
-- Deletes every seed user tagged with seed_source = 'mock-msp-v1'. The
-- ON DELETE CASCADE chain on auth.users propagates through profiles,
-- user_roles, branding_settings, licenses, provider_responsiveness, and
-- any work_order_invites already in flight.
CREATE OR REPLACE FUNCTION public.cleanup_seed_msps()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH deleted AS (
    DELETE FROM auth.users
     WHERE raw_app_meta_data->>'seed_source' = 'mock-msp-v1'
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM deleted;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_seed_msps() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.cleanup_seed_msps() TO service_role;

-- =============================================================================
-- End of seed_mock_msps migration
-- =============================================================================
