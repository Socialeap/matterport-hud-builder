
CREATE TABLE public.custom_qas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL,
  saved_model_id uuid NOT NULL,
  property_uuid text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  embedding vector(384),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX custom_qas_scope_idx
  ON public.custom_qas (saved_model_id, property_uuid);
CREATE INDEX custom_qas_provider_idx
  ON public.custom_qas (provider_id);

ALTER TABLE public.custom_qas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Providers manage their custom Q&As"
  ON public.custom_qas
  FOR ALL
  USING (auth.uid() = provider_id)
  WITH CHECK (auth.uid() = provider_id);

CREATE POLICY "Bound clients can read custom Q&As"
  ON public.custom_qas
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.client_providers cp
      WHERE cp.provider_id = custom_qas.provider_id
        AND cp.client_id = auth.uid()
    )
  );

CREATE TRIGGER trg_custom_qas_updated_at
  BEFORE UPDATE ON public.custom_qas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
