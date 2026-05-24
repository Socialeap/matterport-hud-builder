
-- Netlify OAuth: store per-user access tokens + short-lived state mapping
CREATE TABLE public.netlify_connections (
  user_id uuid PRIMARY KEY,
  access_token text NOT NULL,
  netlify_user_id text,
  netlify_user_email text,
  netlify_user_full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.netlify_connections ENABLE ROW LEVEL SECURITY;

-- Users can see and delete their own connection. We deliberately do NOT
-- expose access_token via the publishable key client — server fns read it
-- with the service role.
CREATE POLICY "Users can view their own netlify connection"
  ON public.netlify_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own netlify connection"
  ON public.netlify_connections FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_netlify_connections_updated_at
  BEFORE UPDATE ON public.netlify_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ephemeral OAuth state → user mapping. Cleaned up on use; 1-hour expiry.
CREATE TABLE public.netlify_oauth_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.netlify_oauth_states ENABLE ROW LEVEL SECURITY;

-- No client policies: only service role reads/writes this table.
