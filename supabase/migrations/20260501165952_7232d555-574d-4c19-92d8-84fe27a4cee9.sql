-- Studio preview tokens — short-lived bearer credentials issued by the
-- dashboard so the public Studio route can render the unpaid Studio
-- inside the Branding > Studio Preview iframe.

CREATE TABLE IF NOT EXISTS public.studio_preview_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         text NOT NULL,
  provider_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS studio_preview_tokens_slug_idx
  ON public.studio_preview_tokens (slug);

CREATE INDEX IF NOT EXISTS studio_preview_tokens_expires_at_idx
  ON public.studio_preview_tokens (expires_at);

ALTER TABLE public.studio_preview_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_preview_tokens_no_select ON public.studio_preview_tokens;
DROP POLICY IF EXISTS studio_preview_tokens_no_insert ON public.studio_preview_tokens;
DROP POLICY IF EXISTS studio_preview_tokens_no_update ON public.studio_preview_tokens;
DROP POLICY IF EXISTS studio_preview_tokens_no_delete ON public.studio_preview_tokens;

CREATE POLICY studio_preview_tokens_no_select
  ON public.studio_preview_tokens FOR SELECT USING (false);
CREATE POLICY studio_preview_tokens_no_insert
  ON public.studio_preview_tokens FOR INSERT WITH CHECK (false);
CREATE POLICY studio_preview_tokens_no_update
  ON public.studio_preview_tokens FOR UPDATE USING (false);
CREATE POLICY studio_preview_tokens_no_delete
  ON public.studio_preview_tokens FOR DELETE USING (false);

CREATE OR REPLACE FUNCTION public.issue_studio_preview_token(_slug text)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_provider  uuid;
  v_token_id  uuid;
BEGIN
  IF v_uid IS NULL OR _slug IS NULL OR length(trim(_slug)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT provider_id INTO v_provider
  FROM public.branding_settings
  WHERE slug = _slug;

  IF v_provider IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_provider <> v_uid AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RETURN NULL;
  END IF;

  DELETE FROM public.studio_preview_tokens
  WHERE expires_at < now() - interval '1 day';

  INSERT INTO public.studio_preview_tokens (slug, provider_id, expires_at)
  VALUES (_slug, v_provider, now() + interval '1 hour')
  RETURNING id INTO v_token_id;

  RETURN v_token_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_studio_preview_token(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_studio_preview_token(_token uuid, _slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.studio_preview_tokens t
    JOIN public.branding_settings b
      ON b.slug = t.slug
     AND b.provider_id = t.provider_id
    WHERE t.id = _token
      AND t.slug = _slug
      AND t.expires_at > now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.verify_studio_preview_token(uuid, text)
  TO anon, authenticated;

COMMENT ON TABLE public.studio_preview_tokens IS
  'Short-lived bearer tokens authorizing the dashboard Studio Preview iframe to render an unpaid Studio. RPC-only access.';