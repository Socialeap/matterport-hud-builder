-- =============================================================================
-- Business-window response deadline (replaces the rigid 3-hour SLA)
-- =============================================================================
-- Background:
--   Prior versions of submit_work_order(...) set work_order_invites.respond_by
--   to `now() + interval '3 hours'`. For solo MSPs on shoots, three wall-clock
--   hours is unreasonable; the marketplace handbook now describes a "next
--   business window" model:
--
--     * Mon-Thu before 2:00 PM  -> respond by same-day 5:00 PM
--     * Mon-Thu at/after 2:00 PM -> respond by next business day 12:00 PM
--     * Fri  before 2:00 PM     -> respond by Fri 5:00 PM
--     * Fri  at/after 2:00 PM   -> respond by following Mon 12:00 PM
--     * Sat / Sun                -> respond by Mon 12:00 PM
--
--   Holiday-aware deadlines are a documented future enhancement; this MVP
--   does not consult a holiday calendar.
--
-- This migration introduces compute_business_window_deadline(timestamptz, text)
-- as the single source of truth, then rewrites submit_work_order(...) to call
-- it instead of hardcoding '3 hours'. The mirror TS helper lives at
-- src/lib/marketplace/business-window.ts.
--
-- We do NOT change column types or constraints; respond_by remains
-- TIMESTAMPTZ NOT NULL on public.work_order_invites and continues to be
-- the authoritative deadline enforced by respond_to_work_order_invite() and
-- expire_unanswered_invites().
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. compute_business_window_deadline
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_business_window_deadline(
  p_at TIMESTAMPTZ DEFAULT now(),
  p_tz TEXT DEFAULT 'America/New_York'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_local TIMESTAMP;
  v_dow INT;           -- 0 = Sunday, 6 = Saturday
  v_hour INT;
  v_date DATE;
  v_deadline TIMESTAMP;
  v_days_to_add INT;
BEGIN
  -- Strip tz to do local-clock arithmetic, then re-tag at the end.
  v_local := timezone(p_tz, p_at);
  v_date  := v_local::date;
  v_hour  := EXTRACT(hour FROM v_local)::int;
  v_dow   := EXTRACT(dow  FROM v_local)::int;

  IF v_dow = 0 THEN
    -- Sunday -> Monday 12:00
    v_deadline := (v_date + 1) + TIME '12:00';
  ELSIF v_dow = 6 THEN
    -- Saturday -> Monday 12:00
    v_deadline := (v_date + 2) + TIME '12:00';
  ELSIF v_dow = 5 THEN
    -- Friday
    IF v_hour < 14 THEN
      v_deadline := v_date + TIME '17:00';
    ELSE
      v_deadline := (v_date + 3) + TIME '12:00';
    END IF;
  ELSE
    -- Mon-Thu
    IF v_hour < 14 THEN
      v_deadline := v_date + TIME '17:00';
    ELSE
      -- next business day at 12:00. dow 1..4 -> +1.
      v_days_to_add := 1;
      v_deadline := (v_date + v_days_to_add) + TIME '12:00';
    END IF;
  END IF;

  RETURN timezone(p_tz, v_deadline);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_business_window_deadline(TIMESTAMPTZ, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_business_window_deadline(TIMESTAMPTZ, TEXT)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_business_window_deadline(TIMESTAMPTZ, TEXT) IS
  'Authoritative response-deadline calculator for marketplace availability '
  'requests. Replaces the legacy now()+3h SLA. Mirrored in TS at '
  'src/lib/marketplace/business-window.ts.';

-- -----------------------------------------------------------------------------
-- 2. submit_work_order (drop & rewrite using the helper above)
-- -----------------------------------------------------------------------------
-- Signature is unchanged so client callers and supabase types stay valid.
-- The only behavior changes:
--   * respond_by is now compute_business_window_deadline(now())
--   * the MSP invite email "respondBy" field is the same deadline
--   * the email template name remains 'work-order-msp-invite' (caller-side
--     copy is updated separately; the data shape is identical)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.submit_work_order(
  UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  public.marketplace_specialty[], public.marketplace_specialty[],
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID
);
CREATE OR REPLACE FUNCTION public.submit_work_order(
  p_selected_provider_ids UUID[],
  p_property_type TEXT,
  p_size_band TEXT,
  p_available_from TIMESTAMPTZ,
  p_available_to TIMESTAMPTZ,
  p_essential_services public.marketplace_specialty[],
  p_preferable_services public.marketplace_specialty[],
  p_address_line1 TEXT,
  p_address_line2 TEXT,
  p_city TEXT,
  p_region TEXT,
  p_zip TEXT,
  p_lat NUMERIC DEFAULT NULL,
  p_lng NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_source_beacon_id UUID DEFAULT NULL
)
RETURNS TABLE (
  work_order_id UUID,
  invite_count INTEGER,
  priority_window_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_work_order_id UUID;
  v_pro_count INTEGER;
  v_window_until TIMESTAMPTZ;
  v_invite_count INTEGER := 0;
  v_provider_id UUID;
  v_rank INTEGER := 0;
  v_msp_email TEXT;
  v_respond_by TIMESTAMPTZ;
  v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_selected_provider_ids IS NULL
     OR array_length(p_selected_provider_ids, 1) IS NULL
     OR array_length(p_selected_provider_ids, 1) < 1
     OR array_length(p_selected_provider_ids, 1) > 10
  THEN
    RAISE EXCEPTION 'selected_provider_ids must be 1 to 10 entries'
      USING ERRCODE = '22023';
  END IF;

  IF p_size_band NOT IN ('under_1500', '1500_3000', '3000_5000', 'over_5000', 'unknown') THEN
    RAISE EXCEPTION 'invalid size_band' USING ERRCODE = '22023';
  END IF;

  IF p_available_to <= p_available_from THEN
    RAISE EXCEPTION 'available_to must be after available_from' USING ERRCODE = '22023';
  END IF;

  IF p_essential_services IS NOT NULL
     AND p_preferable_services IS NOT NULL
     AND p_essential_services && p_preferable_services
  THEN
    RAISE EXCEPTION 'a service may be essential or preferable, not both'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(length(trim(p_address_line1)), 0) < 4 THEN
    RAISE EXCEPTION 'address_line1 is required' USING ERRCODE = '22023';
  END IF;

  IF coalesce(length(trim(p_city)), 0) < 2 THEN
    RAISE EXCEPTION 'city is required' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.work_orders (
    agent_user_id, source_beacon_id,
    property_type, size_band, available_from, available_to, notes,
    essential_services, preferable_services,
    city, region, zip, lat, lng,
    address_line1, address_line2,
    status
  ) VALUES (
    v_uid, p_source_beacon_id,
    trim(p_property_type), p_size_band, p_available_from, p_available_to, p_notes,
    COALESCE(p_essential_services, '{}'::public.marketplace_specialty[]),
    COALESCE(p_preferable_services, '{}'::public.marketplace_specialty[]),
    trim(p_city), NULLIF(trim(coalesce(p_region, '')), ''), NULLIF(trim(coalesce(p_zip, '')), ''),
    p_lat, p_lng,
    trim(p_address_line1), NULLIF(trim(coalesce(p_address_line2, '')), ''),
    'pending'
  )
  RETURNING id INTO v_work_order_id;

  v_pro_count := public._count_eligible_pros_for_work_order(v_work_order_id);
  v_window_until := CASE
    WHEN v_pro_count >= 3 THEN now() + interval '24 hours'
    WHEN v_pro_count >= 1 THEN now() + interval '12 hours'
    ELSE NULL
  END;

  UPDATE public.work_orders
     SET priority_window_until = v_window_until
   WHERE id = v_work_order_id;

  -- Authoritative respond-by deadline (shared by all invites in this fan-out).
  v_respond_by := public.compute_business_window_deadline(now());

  FOREACH v_provider_id IN ARRAY p_selected_provider_ids LOOP
    v_rank := v_rank + 1;

    IF NOT public._provider_can_receive_leads(v_provider_id) THEN
      CONTINUE;
    END IF;

    IF NOT public._is_provider_serving_work_order(v_provider_id, v_work_order_id) THEN
      CONTINUE;
    END IF;

    IF coalesce(array_length(p_essential_services, 1), 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM public.branding_settings bs
         WHERE bs.provider_id = v_provider_id
           AND p_essential_services <@ bs.specialties
       )
    THEN
      CONTINUE;
    END IF;

    INSERT INTO public.work_order_invites (
      work_order_id, provider_id, rank_at_invite, respond_by, response_status
    ) VALUES (
      v_work_order_id, v_provider_id, LEAST(v_rank, 32767),
      v_respond_by, 'invited'
    )
    ON CONFLICT (work_order_id, provider_id) DO NOTHING;

    v_invite_count := v_invite_count + 1;

    SELECT au.email INTO v_msp_email
      FROM auth.users au
     WHERE au.id = v_provider_id;

    IF v_msp_email IS NOT NULL THEN
      PERFORM public.enqueue_email(
        'transactional_emails',
        jsonb_build_object(
          'template_name', 'work-order-msp-invite',
          'recipient_email', v_msp_email,
          'data', jsonb_build_object(
            'workOrderId',  v_work_order_id::text,
            'city',         trim(p_city),
            'region',       NULLIF(trim(coalesce(p_region, '')), ''),
            'zip',          NULLIF(trim(coalesce(p_zip, '')), ''),
            'propertyType', trim(p_property_type),
            'sizeBand',     p_size_band,
            'availableFrom', to_char(p_available_from, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
            'availableTo',   to_char(p_available_to,   'YYYY-MM-DD"T"HH24:MI:SSOF'),
            -- Authoritative business-window deadline. Email templates render
            -- this in the MSP's local time.
            'respondBy',     to_char(v_respond_by, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
            'inviteUrl',     v_dashboard_url || '/dashboard/work-orders'
          )
        )
      );

      UPDATE public.work_order_invites
         SET email_sent_at = now()
       WHERE work_order_id = v_work_order_id
         AND provider_id   = v_provider_id;
    END IF;
  END LOOP;

  PERFORM public.enqueue_email(
    'transactional_emails',
    jsonb_build_object(
      'template_name', 'work-order-agent-receipt',
      'recipient_email', (SELECT email FROM auth.users WHERE id = v_uid),
      'data', jsonb_build_object(
        'workOrderId', v_work_order_id::text,
        'city',        trim(p_city),
        'inviteCount', v_invite_count,
        'respondBy',   to_char(v_respond_by, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'reviewUrl',   v_dashboard_url || '/agent-dashboard/work-orders/' || v_work_order_id::text
      )
    )
  );

  work_order_id         := v_work_order_id;
  invite_count          := v_invite_count;
  priority_window_until := v_window_until;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_work_order(
  UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  public.marketplace_specialty[], public.marketplace_specialty[],
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_work_order(
  UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ,
  public.marketplace_specialty[], public.marketplace_specialty[],
  TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID
) TO authenticated;

-- =============================================================================
-- End of migration. respond_to_work_order_invite() and
-- expire_unanswered_invites() keep working unchanged: they read whatever
-- respond_by value is stored, regardless of how it was computed.
-- =============================================================================
