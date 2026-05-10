DROP FUNCTION IF EXISTS public.submit_work_order(UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, public.marketplace_specialty[], public.marketplace_specialty[], TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.submit_work_order(
  p_selected_provider_ids UUID[], p_property_type TEXT, p_size_band TEXT,
  p_available_from TIMESTAMPTZ, p_available_to TIMESTAMPTZ,
  p_essential_services public.marketplace_specialty[], p_preferable_services public.marketplace_specialty[],
  p_address_line1 TEXT, p_address_line2 TEXT, p_city TEXT, p_region TEXT, p_zip TEXT,
  p_lat NUMERIC DEFAULT NULL, p_lng NUMERIC DEFAULT NULL, p_notes TEXT DEFAULT NULL, p_source_beacon_id UUID DEFAULT NULL
) RETURNS TABLE (work_order_id UUID, invite_count INTEGER, priority_window_until TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_work_order_id UUID; v_pro_count INTEGER; v_window_until TIMESTAMPTZ;
        v_invite_count INTEGER := 0; v_provider_id UUID; v_rank INTEGER := 0; v_msp_email TEXT;
        v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_selected_provider_ids IS NULL OR array_length(p_selected_provider_ids,1) IS NULL
     OR array_length(p_selected_provider_ids,1) < 1 OR array_length(p_selected_provider_ids,1) > 10
  THEN RAISE EXCEPTION 'selected_provider_ids must be 1 to 10 entries' USING ERRCODE='22023'; END IF;
  IF p_size_band NOT IN ('under_1500','1500_3000','3000_5000','over_5000','unknown') THEN
    RAISE EXCEPTION 'invalid size_band' USING ERRCODE='22023'; END IF;
  IF p_available_to <= p_available_from THEN RAISE EXCEPTION 'available_to must be after available_from' USING ERRCODE='22023'; END IF;
  IF p_essential_services IS NOT NULL AND p_preferable_services IS NOT NULL AND p_essential_services && p_preferable_services THEN
    RAISE EXCEPTION 'a service may be essential or preferable, not both' USING ERRCODE='22023'; END IF;
  IF coalesce(length(trim(p_address_line1)),0) < 4 THEN RAISE EXCEPTION 'address_line1 is required' USING ERRCODE='22023'; END IF;
  IF coalesce(length(trim(p_city)),0) < 2 THEN RAISE EXCEPTION 'city is required' USING ERRCODE='22023'; END IF;

  INSERT INTO public.work_orders (
    agent_user_id, source_beacon_id, property_type, size_band, available_from, available_to, notes,
    essential_services, preferable_services, city, region, zip, lat, lng, address_line1, address_line2, status
  ) VALUES (
    v_uid, p_source_beacon_id, trim(p_property_type), p_size_band, p_available_from, p_available_to, p_notes,
    COALESCE(p_essential_services,'{}'::public.marketplace_specialty[]),
    COALESCE(p_preferable_services,'{}'::public.marketplace_specialty[]),
    trim(p_city), NULLIF(trim(coalesce(p_region,'')),''), NULLIF(trim(coalesce(p_zip,'')),''),
    p_lat, p_lng, trim(p_address_line1), NULLIF(trim(coalesce(p_address_line2,'')),''),'pending'
  ) RETURNING id INTO v_work_order_id;

  v_pro_count := public._count_eligible_pros_for_work_order(v_work_order_id);
  v_window_until := CASE WHEN v_pro_count >= 3 THEN now() + interval '24 hours'
                         WHEN v_pro_count >= 1 THEN now() + interval '12 hours' ELSE NULL END;
  UPDATE public.work_orders SET priority_window_until = v_window_until WHERE id = v_work_order_id;

  FOREACH v_provider_id IN ARRAY p_selected_provider_ids LOOP
    v_rank := v_rank + 1;
    IF NOT public._provider_can_receive_leads(v_provider_id) THEN CONTINUE; END IF;
    IF NOT public._is_provider_serving_work_order(v_provider_id, v_work_order_id) THEN CONTINUE; END IF;
    IF coalesce(array_length(p_essential_services,1),0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.branding_settings bs WHERE bs.provider_id = v_provider_id AND p_essential_services <@ bs.specialties)
    THEN CONTINUE; END IF;

    INSERT INTO public.work_order_invites (work_order_id, provider_id, rank_at_invite, respond_by, response_status)
    VALUES (v_work_order_id, v_provider_id, LEAST(v_rank,32767), now() + interval '3 hours', 'invited')
    ON CONFLICT (work_order_id, provider_id) DO NOTHING;
    v_invite_count := v_invite_count + 1;

    SELECT au.email INTO v_msp_email FROM auth.users au WHERE au.id = v_provider_id;
    IF v_msp_email IS NOT NULL THEN
      PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
        'template_name','work-order-msp-invite','recipient_email',v_msp_email,
        'data', jsonb_build_object(
          'workOrderId', v_work_order_id::text,'city', trim(p_city),
          'region', NULLIF(trim(coalesce(p_region,'')),''),'zip', NULLIF(trim(coalesce(p_zip,'')),''),
          'propertyType', trim(p_property_type),'sizeBand', p_size_band,
          'availableFrom', to_char(p_available_from,'YYYY-MM-DD"T"HH24:MI:SSOF'),
          'availableTo', to_char(p_available_to,'YYYY-MM-DD"T"HH24:MI:SSOF'),
          'respondBy', to_char(now() + interval '3 hours','YYYY-MM-DD"T"HH24:MI:SSOF'),
          'inviteUrl', v_dashboard_url || '/dashboard/work-orders')));
      UPDATE public.work_order_invites SET email_sent_at=now()
       WHERE work_order_id=v_work_order_id AND provider_id=v_provider_id;
    END IF;
  END LOOP;

  PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
    'template_name','work-order-agent-receipt',
    'recipient_email',(SELECT email FROM auth.users WHERE id = v_uid),
    'data', jsonb_build_object('workOrderId', v_work_order_id::text,'city', trim(p_city),
      'inviteCount', v_invite_count,
      'reviewUrl', v_dashboard_url || '/agent-dashboard/work-orders/' || v_work_order_id::text)));

  work_order_id := v_work_order_id; invite_count := v_invite_count; priority_window_until := v_window_until;
  RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_work_order(UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, public.marketplace_specialty[], public.marketplace_specialty[], TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_work_order(UUID[], TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, public.marketplace_specialty[], public.marketplace_specialty[], TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.respond_to_work_order_invite(p_invite_id UUID, p_response TEXT, p_provider_note TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_invite RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_response NOT IN ('available','not_available') THEN RAISE EXCEPTION 'response must be "available" or "not_available"' USING ERRCODE='22023'; END IF;
  SELECT id, work_order_id, provider_id, response_status, respond_by, available_score_delta_at
    INTO v_invite FROM public.work_order_invites WHERE id = p_invite_id FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'invite not found' USING ERRCODE='22023'; END IF;
  IF v_invite.provider_id <> v_uid THEN RAISE EXCEPTION 'not invited to this work order' USING ERRCODE='42501'; END IF;
  IF v_invite.response_status <> 'invited' THEN RETURN FALSE; END IF;
  IF now() > v_invite.respond_by THEN RETURN FALSE; END IF;
  UPDATE public.work_order_invites
     SET response_status = (CASE WHEN p_response='available' THEN 'available'::public.work_order_invite_status
                                  ELSE 'not_available'::public.work_order_invite_status END),
         responded_at=now(), provider_note=NULLIF(trim(coalesce(p_provider_note,'')),'')
   WHERE id = v_invite.id;
  IF p_response='available' AND v_invite.available_score_delta_at IS NULL THEN
    PERFORM public._update_responsiveness_score(v_uid, 0.10, 'contacted');
    UPDATE public.work_order_invites SET available_score_delta_at=now() WHERE id = v_invite.id;
  END IF;
  RETURN TRUE;
END; $$;
REVOKE EXECUTE ON FUNCTION public.respond_to_work_order_invite(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_work_order_invite(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_work_order_msp(p_work_order_id UUID, p_provider_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_wo RECORD; v_invite RECORD;
        v_agent_email TEXT; v_agent_name TEXT; v_agent_phone TEXT; v_msp_email TEXT;
        v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF v_wo.id IS NULL THEN RAISE EXCEPTION 'work order not found' USING ERRCODE='22023'; END IF;
  IF v_wo.agent_user_id <> v_uid THEN RAISE EXCEPTION 'not the owner of this work order' USING ERRCODE='42501'; END IF;
  IF v_wo.status <> 'pending' THEN RAISE EXCEPTION 'work order is not pending' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_invite FROM public.work_order_invites WHERE work_order_id=p_work_order_id AND provider_id=p_provider_id FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'no matching invite' USING ERRCODE='22023'; END IF;
  IF v_invite.response_status <> 'available' THEN RAISE EXCEPTION 'cannot confirm a non-available MSP' USING ERRCODE='22023'; END IF;
  UPDATE public.work_orders SET status='confirmed', confirmed_provider_id=p_provider_id, confirmed_at=now(), pii_released_at=now() WHERE id = p_work_order_id;
  UPDATE public.work_order_invites SET response_status='not_selected', responded_at=COALESCE(responded_at,now())
   WHERE work_order_id=p_work_order_id AND id <> v_invite.id AND response_status IN ('invited','available','not_available');
  PERFORM public._update_responsiveness_score(p_provider_id, 0.20, 'won');
  SELECT au.email INTO v_agent_email FROM auth.users au WHERE au.id=v_uid;
  SELECT pr.display_name, pr.phone INTO v_agent_name, v_agent_phone FROM public.profiles pr WHERE pr.user_id=v_uid;
  SELECT au.email INTO v_msp_email FROM auth.users au WHERE au.id=p_provider_id;
  IF v_msp_email IS NOT NULL THEN
    PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
      'template_name','work-order-confirmed-msp','recipient_email',v_msp_email,
      'data', jsonb_build_object('workOrderId',p_work_order_id::text,'agentName',COALESCE(v_agent_name,'Agent'),
        'agentEmail',v_agent_email,'agentPhone',v_agent_phone,
        'addressLine1',v_wo.address_line1,'addressLine2',v_wo.address_line2,
        'city',v_wo.city,'region',v_wo.region,'zip',v_wo.zip,
        'propertyType',v_wo.property_type,'sizeBand',v_wo.size_band,
        'availableFrom', to_char(v_wo.available_from,'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'availableTo', to_char(v_wo.available_to,'YYYY-MM-DD"T"HH24:MI:SSOF'),
        'dashboardUrl', v_dashboard_url || '/dashboard/work-orders')));
  END IF;
  RETURN TRUE;
END; $$;
REVOKE EXECUTE ON FUNCTION public.confirm_work_order_msp(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_work_order_msp(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_work_order(p_work_order_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_wo RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT id, agent_user_id, status INTO v_wo FROM public.work_orders WHERE id=p_work_order_id FOR UPDATE;
  IF v_wo.id IS NULL THEN RAISE EXCEPTION 'work order not found' USING ERRCODE='22023'; END IF;
  IF v_wo.agent_user_id <> v_uid THEN RAISE EXCEPTION 'not the owner of this work order' USING ERRCODE='42501'; END IF;
  IF v_wo.status <> 'pending' THEN RAISE EXCEPTION 'only pending work orders can be cancelled' USING ERRCODE='22023'; END IF;
  UPDATE public.work_orders SET status='cancelled', cancelled_at=now() WHERE id=p_work_order_id;
  UPDATE public.work_order_invites SET response_status='withdrawn', responded_at=COALESCE(responded_at,now())
   WHERE work_order_id=p_work_order_id AND response_status IN ('invited','available','not_available');
  RETURN TRUE;
END; $$;
REVOKE EXECUTE ON FUNCTION public.cancel_work_order(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_work_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_work_order_complete(p_work_order_id UUID, p_completion TEXT)
RETURNS TABLE (ok BOOLEAN, rating_token UUID) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_wo RECORD; v_rating_id UUID; v_rating_token UUID;
        v_agent_email TEXT; v_msp_brand TEXT; v_dashboard_url TEXT := 'https://3dps.transcendencemedia.com';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  IF p_completion NOT IN ('complete','incomplete') THEN RAISE EXCEPTION 'completion must be "complete" or "incomplete"' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id=p_work_order_id FOR UPDATE;
  IF v_wo.id IS NULL THEN RAISE EXCEPTION 'work order not found' USING ERRCODE='22023'; END IF;
  IF v_wo.confirmed_provider_id IS NULL OR v_wo.confirmed_provider_id <> v_uid THEN
    RAISE EXCEPTION 'only the confirmed MSP can mark this work order' USING ERRCODE='42501'; END IF;
  IF v_wo.status <> 'confirmed' THEN RAISE EXCEPTION 'work order is not in confirmed state' USING ERRCODE='22023'; END IF;
  UPDATE public.work_orders
     SET status = (CASE WHEN p_completion='complete' THEN 'completed'::public.work_order_status ELSE 'incomplete'::public.work_order_status END),
         completion = p_completion::public.work_order_completion, completion_at = now()
   WHERE id = p_work_order_id;
  IF p_completion='complete' THEN
    INSERT INTO public.work_order_ratings (work_order_id, provider_id, agent_user_id)
    VALUES (p_work_order_id, v_uid, v_wo.agent_user_id) ON CONFLICT (work_order_id) DO NOTHING
    RETURNING id, rating_token INTO v_rating_id, v_rating_token;
    IF v_rating_token IS NULL THEN
      SELECT rating_token INTO v_rating_token FROM public.work_order_ratings WHERE work_order_id=p_work_order_id;
    END IF;
    SELECT au.email INTO v_agent_email FROM auth.users au WHERE au.id=v_wo.agent_user_id;
    SELECT bs.brand_name INTO v_msp_brand FROM public.branding_settings bs WHERE bs.provider_id=v_uid;
    IF v_agent_email IS NOT NULL AND v_rating_token IS NOT NULL THEN
      PERFORM public.enqueue_email('transactional_emails', jsonb_build_object(
        'template_name','work-order-rating-request','recipient_email',v_agent_email,
        'data', jsonb_build_object('workOrderId',p_work_order_id::text,
          'mspBrandName', COALESCE(v_msp_brand,'Your 3DPS Partner'),
          'ratingUrl', v_dashboard_url || '/work-orders/rate/' || v_rating_token::text)));
      UPDATE public.work_order_ratings SET email_sent_at=now() WHERE work_order_id=p_work_order_id;
    END IF;
  END IF;
  ok := TRUE; rating_token := v_rating_token; RETURN NEXT;
END; $$;
REVOKE EXECUTE ON FUNCTION public.mark_work_order_complete(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_work_order_complete(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_work_order_rating(p_rating_token UUID, p_stars SMALLINT, p_feedback TEXT DEFAULT NULL)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rating RECORD;
BEGIN
  IF p_stars IS NULL OR p_stars < 1 OR p_stars > 5 THEN RAISE EXCEPTION 'stars must be 1..5' USING ERRCODE='22023'; END IF;
  SELECT id, provider_id, submitted_at, score_delta_applied_at INTO v_rating
    FROM public.work_order_ratings WHERE rating_token=p_rating_token FOR UPDATE;
  IF v_rating.id IS NULL THEN RETURN FALSE; END IF;
  IF v_rating.submitted_at IS NOT NULL THEN RETURN TRUE; END IF;
  UPDATE public.work_order_ratings SET stars=p_stars, feedback_text=NULLIF(trim(coalesce(p_feedback,'')),''), submitted_at=now()
   WHERE id=v_rating.id;
  IF p_stars >= 4 AND v_rating.score_delta_applied_at IS NULL THEN
    PERFORM public._update_responsiveness_score(v_rating.provider_id, 0.15, NULL);
    UPDATE public.work_order_ratings SET score_delta_applied_at=now() WHERE id=v_rating.id;
  END IF;
  RETURN TRUE;
END; $$;
REVOKE EXECUTE ON FUNCTION public.submit_work_order_rating(UUID, SMALLINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_work_order_rating(UUID, SMALLINT, TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lookup_work_order_rating_by_token(p_rating_token UUID)
RETURNS TABLE (msp_brand_name TEXT, completion_at TIMESTAMPTZ, already_submitted BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(bs.brand_name,'Your 3DPS Partner'), wo.completion_at, (r.submitted_at IS NOT NULL)
  FROM public.work_order_ratings r
  JOIN public.work_orders wo ON wo.id=r.work_order_id
  LEFT JOIN public.branding_settings bs ON bs.provider_id=r.provider_id
  WHERE r.rating_token=p_rating_token;
$$;
REVOKE EXECUTE ON FUNCTION public.lookup_work_order_rating_by_token(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_work_order_rating_by_token(UUID) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.expire_unanswered_invites()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0; v_invite RECORD;
BEGIN
  FOR v_invite IN
    SELECT id, provider_id FROM public.work_order_invites
     WHERE response_status='invited' AND respond_by < now() AND expired_penalty_applied_at IS NULL
     FOR UPDATE SKIP LOCKED LIMIT 200
  LOOP
    UPDATE public.work_order_invites SET response_status='expired', expired_penalty_applied_at=now() WHERE id=v_invite.id;
    PERFORM public._update_responsiveness_score(v_invite.provider_id, -0.50, 'expired');
    v_count := v_count + 1;
  END LOOP;
  UPDATE public.work_orders wo SET status='expired'
   WHERE wo.status='pending' AND NOT EXISTS (
     SELECT 1 FROM public.work_order_invites i
      WHERE i.work_order_id=wo.id AND i.response_status IN ('invited','available'));
  RETURN v_count;
END; $$;
REVOKE EXECUTE ON FUNCTION public.expire_unanswered_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_unanswered_invites() TO service_role;

CREATE OR REPLACE FUNCTION public.get_my_work_orders()
RETURNS TABLE (
  id UUID, created_at TIMESTAMPTZ, status public.work_order_status, city TEXT, region TEXT, zip TEXT,
  property_type TEXT, size_band TEXT, available_from TIMESTAMPTZ, available_to TIMESTAMPTZ,
  essential_services public.marketplace_specialty[], preferable_services public.marketplace_specialty[],
  invite_count INTEGER, available_count INTEGER, expired_count INTEGER,
  confirmed_provider_id UUID, confirmed_brand_name TEXT,
  completion public.work_order_completion, completion_at TIMESTAMPTZ, priority_window_until TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT wo.id, wo.created_at, wo.status, wo.city, wo.region, wo.zip, wo.property_type, wo.size_band,
    wo.available_from, wo.available_to, wo.essential_services, wo.preferable_services,
    (SELECT COUNT(*)::INTEGER FROM public.work_order_invites i WHERE i.work_order_id=wo.id),
    (SELECT COUNT(*)::INTEGER FROM public.work_order_invites i WHERE i.work_order_id=wo.id AND i.response_status='available'),
    (SELECT COUNT(*)::INTEGER FROM public.work_order_invites i WHERE i.work_order_id=wo.id AND i.response_status='expired'),
    wo.confirmed_provider_id, bs.brand_name, wo.completion, wo.completion_at, wo.priority_window_until
  FROM public.work_orders wo
  LEFT JOIN public.branding_settings bs ON bs.provider_id=wo.confirmed_provider_id
  WHERE wo.agent_user_id=v_uid ORDER BY wo.created_at DESC;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_my_work_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_work_orders() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_work_order_detail_for_agent(p_work_order_id UUID)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid(); v_wo RECORD; v_invites jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_wo FROM public.work_orders WHERE id=p_work_order_id;
  IF v_wo.id IS NULL OR v_wo.agent_user_id <> v_uid THEN RETURN NULL; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'invite_id',i.id,'provider_id',i.provider_id,'brand_name',bs.brand_name,'slug',bs.slug,'logo_url',bs.logo_url,
    'tier',bs.tier,'rank_at_invite',i.rank_at_invite,'response_status',i.response_status,
    'responded_at',i.responded_at,'respond_by',i.respond_by,'provider_note',i.provider_note,
    'directory_phone',bs.directory_phone,'directory_website_url',bs.directory_website_url,
    'directory_contact_email',bs.directory_contact_email,'standing_score',COALESCE(pr.score,1.00)
  ) ORDER BY (i.response_status='available') DESC, i.rank_at_invite NULLS LAST)
  INTO v_invites FROM public.work_order_invites i
  LEFT JOIN public.branding_settings bs ON bs.provider_id=i.provider_id
  LEFT JOIN public.provider_responsiveness pr ON pr.provider_id=i.provider_id
  WHERE i.work_order_id=p_work_order_id;
  RETURN jsonb_build_object('id',v_wo.id,'created_at',v_wo.created_at,'status',v_wo.status,
    'priority_window_until',v_wo.priority_window_until,'address_line1',v_wo.address_line1,
    'address_line2',v_wo.address_line2,'city',v_wo.city,'region',v_wo.region,'zip',v_wo.zip,
    'property_type',v_wo.property_type,'size_band',v_wo.size_band,
    'available_from',v_wo.available_from,'available_to',v_wo.available_to,'notes',v_wo.notes,
    'essential_services',v_wo.essential_services,'preferable_services',v_wo.preferable_services,
    'confirmed_provider_id',v_wo.confirmed_provider_id,'confirmed_at',v_wo.confirmed_at,
    'pii_released_at',v_wo.pii_released_at,'completion',v_wo.completion,'completion_at',v_wo.completion_at,
    'invites', COALESCE(v_invites,'[]'::jsonb));
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_work_order_detail_for_agent(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_work_order_detail_for_agent(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_work_order_invites()
RETURNS TABLE (
  invite_id UUID, work_order_id UUID, rank_at_invite SMALLINT,
  response_status public.work_order_invite_status, respond_by TIMESTAMPTZ, responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ, city TEXT, region TEXT, zip TEXT, property_type TEXT, size_band TEXT,
  available_from TIMESTAMPTZ, available_to TIMESTAMPTZ,
  essential_services public.marketplace_specialty[], preferable_services public.marketplace_specialty[],
  notes TEXT, wo_status public.work_order_status,
  agent_name TEXT, agent_email TEXT, agent_phone TEXT,
  address_line1 TEXT, address_line2 TEXT, pii_released BOOLEAN,
  completion public.work_order_completion, completion_at TIMESTAMPTZ
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  RETURN QUERY
  SELECT i.id, wo.id, i.rank_at_invite, i.response_status, i.respond_by, i.responded_at, i.created_at,
    wo.city, wo.region, wo.zip, wo.property_type, wo.size_band, wo.available_from, wo.available_to,
    wo.essential_services, wo.preferable_services, wo.notes, wo.status,
    CASE WHEN wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid THEN COALESCE(pr.display_name,'Agent') ELSE NULL END,
    CASE WHEN wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid THEN au.email ELSE NULL END,
    CASE WHEN wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid THEN pr.phone ELSE NULL END,
    CASE WHEN wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid THEN wo.address_line1 ELSE NULL END,
    CASE WHEN wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid THEN wo.address_line2 ELSE NULL END,
    (wo.pii_released_at IS NOT NULL AND wo.confirmed_provider_id=v_uid),
    wo.completion, wo.completion_at
  FROM public.work_order_invites i
  JOIN public.work_orders wo ON wo.id=i.work_order_id
  LEFT JOIN auth.users au ON au.id=wo.agent_user_id
  LEFT JOIN public.profiles pr ON pr.user_id=wo.agent_user_id
  WHERE i.provider_id=v_uid
  ORDER BY (CASE WHEN i.response_status='invited' THEN 0 WHEN i.response_status='available' THEN 1 ELSE 2 END), i.created_at DESC;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_my_work_order_invites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_work_order_invites() TO authenticated;