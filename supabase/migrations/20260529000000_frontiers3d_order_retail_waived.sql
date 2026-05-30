-- ============================================================
-- Frontiers3D — Phase 3.2: Provider-comped order retail waiver (additive)
-- ------------------------------------------------------------
-- Closes the last no-fee download path. Today a provider can "Make Free"
-- an order (grantFreePresentationDownload), which sets the saved_model to
-- paid + released + $0 and lets the client download with NO platform fee.
--
-- Under the locked Frontiers3D rule, a provider may waive THEIR OWN retail
-- fee, but the mandatory platform fee is still owed by the client. This
-- migration adds a single per-order flag so the comp can mark the order
-- "provider retail waived" WITHOUT releasing it; the client then pays only
-- the platform fee through the existing Phase 3.1 platform-direct checkout
-- (Path F), after which the webhook releases the model.
--
-- This is the ONLY schema change in Phase 3.2. Strictly additive:
--   * saved_models.retail_waived BOOLEAN NOT NULL DEFAULT false
--
-- Out of scope (NOT touched): saved_models RLS/policies, every other
-- saved_models column, the off-platform "Mark Paid" / "Release" override
-- paths (a separate follow-up — see BACKEND_ACTIVATION_PHASE_3_2.md),
-- platform_fee_schedule / platform_fee_ledger / acquisition_source
-- (Phase 3.0), and all checkout/webhook code (wired in 3.1 / patched in 3.2).
--
-- Safety: no DROP, no DELETE, no TRUNCATE, no destructive ALTER,
-- no policy/RLS change, no secret change. Idempotent.
-- ============================================================

ALTER TABLE public.saved_models
  ADD COLUMN IF NOT EXISTS retail_waived BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.saved_models.retail_waived IS
  'Frontiers3D Phase 3.2: the provider waived their own retail fee for this '
  'order. The mandatory platform fee is still owed by the client and is '
  'collected via the platform-direct checkout before release. Set true by '
  'grantFreePresentationDownload; never auto-reset.';

-- ============================================================
-- End of Phase 3.2 schema. Code wiring (grantFreePresentationDownload,
-- create-connect-checkout, orders UI) is deployed alongside per
-- BACKEND_ACTIVATION_PHASE_3_2.md.
-- ============================================================
