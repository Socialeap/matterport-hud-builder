CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email_domain TEXT := 'transcendencemedia.com';
  v_seed_password TEXT := 'SeedPass!2026';
  v_seed_source  TEXT := 'mock-msp-v1';

  v_msp RECORD;
  v_uid UUID;
  v_email TEXT;
  v_existing_uid UUID;

  v_seeds CONSTANT JSONB := jsonb_build_array(
    jsonb_build_object('slug','skyline-3d-studios','brand_name','Skyline 3D Studios','tier','pro','standing',1.50,'primary_city','Atlanta','region','GA','lat',33.7490,'lng',-84.3880,'service_radius_miles',35,'service_zips',jsonb_build_array('30303','30308','30318','30324','30327'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography','scan-walkthrough-video-clips','scan-dimensional-measurements','scan-same-day-turnaround','vault-sound-library','vault-portal-filters','vault-interactive-widgets','vault-property-mapper','ai-lead-generation')),
    jsonb_build_object('slug','peachtree-capture-co','brand_name','Peachtree Capture Co.','tier','pro','standing',1.00,'primary_city','Atlanta','region','GA','lat',33.7701,'lng',-84.3640,'service_radius_miles',30,'service_zips',jsonb_build_array('30303','30308','30318','30326','30342'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-walkthrough-video-clips','scan-floor-plans','scan-same-day-turnaround','vault-sound-library','vault-portal-filters','vault-property-mapper','ai-lead-generation')),
    jsonb_build_object('slug','sweetwater-3d-imaging','brand_name','Sweetwater 3D Imaging','tier','pro','standing',0.85,'primary_city','Atlanta','region','GA','lat',33.8650,'lng',-84.4660,'service_radius_miles',35,'service_zips',jsonb_build_array('30327','30328','30338','30339','30342'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-twilight-photography','scan-floor-plans','scan-dimensional-measurements','vault-portal-filters','vault-interactive-widgets','vault-custom-icons','vault-property-mapper')),
    jsonb_build_object('slug','coastal-tour-co','brand_name','Coastal Tour Co.','tier','starter','standing',1.10,'primary_city','San Diego','region','CA','lat',32.7157,'lng',-117.1611,'service_radius_miles',30,'service_zips',jsonb_build_array('92101','92103','92109','92122','92130'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements','scan-same-day-turnaround','vault-sound-library','vault-portal-filters','vault-custom-icons','vault-property-mapper','ai-lead-generation')),
    jsonb_build_object('slug','lakeshore-immersive','brand_name','Lakeshore Immersive','tier','pro','standing',1.20,'primary_city','Chicago','region','IL','lat',41.8781,'lng',-87.6298,'service_radius_miles',40,'service_zips',jsonb_build_array('60601','60607','60614','60622','60654'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-twilight-photography','scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements','scan-same-day-turnaround','vault-sound-library','vault-portal-filters','vault-interactive-widgets','vault-custom-icons','vault-property-mapper')),
    jsonb_build_object('slug','lone-star-spaces','brand_name','Lone Star Spaces','tier','starter','standing',0.90,'primary_city','Austin','region','TX','lat',30.2672,'lng',-97.7431,'service_radius_miles',40,'service_zips',jsonb_build_array('78701','78704','78745','78751','78759'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography','scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements','scan-same-day-turnaround','vault-portal-filters','vault-interactive-widgets','vault-custom-icons','ai-lead-generation')),
    jsonb_build_object('slug','mile-high-matterworks','brand_name','Mile High Matterworks','tier','pro','standing',1.30,'primary_city','Denver','region','CO','lat',39.7392,'lng',-104.9903,'service_radius_miles',35,'service_zips',jsonb_build_array('80202','80204','80206','80218','80246'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography','scan-floor-plans','scan-same-day-turnaround','vault-sound-library','vault-portal-filters','vault-interactive-widgets','vault-custom-icons','vault-property-mapper','ai-lead-generation')),
    jsonb_build_object('slug','beacon-hill-tours','brand_name','Beacon Hill Tours','tier','starter','standing',0.95,'primary_city','Boston','region','MA','lat',42.3601,'lng',-71.0589,'service_radius_miles',30,'service_zips',jsonb_build_array('02108','02115','02118','02129','02134'),'specialties',jsonb_build_array('scan-matterport-pro3','scan-drone-aerial','scan-twilight-photography','scan-walkthrough-video-clips','scan-floor-plans','scan-dimensional-measurements','vault-sound-library','vault-interactive-widgets','vault-custom-icons','vault-property-mapper','ai-lead-generation'))
  );
BEGIN
  FOR v_msp IN SELECT * FROM jsonb_array_elements(v_seeds)
  LOOP
    v_email := 'mock-msp+' || (v_msp.value->>'slug') || '@' || v_email_domain;

    SELECT id INTO v_existing_uid
      FROM auth.users
     WHERE email = v_email
       AND raw_app_meta_data->>'seed_source' = v_seed_source
     LIMIT 1;

    v_uid := COALESCE(v_existing_uid, gen_random_uuid());

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
      jsonb_build_object('provider','email','providers',jsonb_build_array('email'),'seed_source',v_seed_source),
      jsonb_build_object('full_name',v_msp.value->>'brand_name','seed_source',v_seed_source),
      now(), now(), false, false
    )
    ON CONFLICT (id) DO NOTHING;

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

    INSERT INTO public.profiles (user_id, display_name)
    VALUES (v_uid, v_msp.value->>'brand_name')
    ON CONFLICT (user_id) DO UPDATE
      SET display_name = EXCLUDED.display_name,
          updated_at   = now();

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_uid, 'provider'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;

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

    DELETE FROM public.licenses WHERE user_id = v_uid;

    INSERT INTO public.licenses (user_id, tier, license_status, license_expiry)
    VALUES (
      v_uid,
      (v_msp.value->>'tier')::public.app_tier,
      'active'::public.license_status,
      NULL
    );

    INSERT INTO public.provider_responsiveness (provider_id, score)
    VALUES (v_uid, (v_msp.value->>'standing')::numeric)
    ON CONFLICT (provider_id) DO UPDATE SET
      score      = EXCLUDED.score,
      updated_at = now();
  END LOOP;
END $$;

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