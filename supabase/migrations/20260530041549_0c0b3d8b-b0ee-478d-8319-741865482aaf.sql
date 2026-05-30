-- Frontiers3D Phase 3.2: Provider-comped order retail waiver (additive)
ALTER TABLE public.saved_models
  ADD COLUMN IF NOT EXISTS retail_waived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.saved_models.retail_waived IS
  'Frontiers3D Phase 3.2: the provider waived their own retail fee for this '
  'order. The mandatory platform fee is still owed by the client and is '
  'collected via the platform-direct checkout before release. Set true by '
  'grantFreePresentationDownload; never auto-reset.';