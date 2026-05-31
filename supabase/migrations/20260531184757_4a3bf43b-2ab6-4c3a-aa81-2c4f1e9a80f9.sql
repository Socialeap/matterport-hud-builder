CREATE OR REPLACE FUNCTION public.get_operator_outreach_readiness()
RETURNS TABLE (
  property_id        UUID,
  business_name      TEXT,
  city               TEXT,
  region             TEXT,
  website_url        TEXT,
  email              TEXT,
  email_confidence   TEXT,
  enrichment_source  TEXT,
  beacon_id          UUID,
  beacon_status      TEXT,
  promoted           BOOLEAN,
  outreach_log_id    UUID,
  outreach_status    TEXT,
  outreach_at        TIMESTAMPTZ,
  readiness          TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'get_operator_outreach_readiness is operator (admin) only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.locality,
    p.administrative_area,
    pc.website_url,
    pc.email::text,
    (pe.signals -> 'email_enrichment' ->> 'chosen_confidence'),
    pe.enrichment_source,
    b.id,
    b.status::text,
    (b.id IS NOT NULL),
    ol.id,
    ol.status,
    ol.queued_at,
    CASE
      WHEN b.id IS NULL                 THEN 'not_promoted'
      WHEN pc.email IS NULL             THEN 'no_email'
      WHEN ol.status IS NOT NULL        THEN ol.status
      ELSE 'ready'
    END
  FROM public.doorway_candidates dc
  JOIN public.properties p ON p.id = dc.property_id
  LEFT JOIN public.property_contacts   pc ON pc.property_id = p.id
  LEFT JOIN public.property_enrichment pe ON pe.property_id = p.id
  LEFT JOIN LATERAL (
    SELECT ab.id, ab.status
      FROM public.agent_beacons ab
     WHERE ab.property_id = p.id AND ab.source = 'map_oracle'
     ORDER BY ab.created_at DESC
     LIMIT 1
  ) b ON TRUE
  LEFT JOIN LATERAL (
    SELECT mol.id, mol.status, mol.queued_at
      FROM public.map_oracle_outreach_log mol
     WHERE mol.beacon_id = b.id
     ORDER BY mol.queued_at DESC
     LIMIT 1
  ) ol ON TRUE
  ORDER BY p.name NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_operator_outreach_readiness() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_operator_outreach_readiness() TO service_role, authenticated;