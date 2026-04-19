ALTER TABLE public.branding_settings
  ADD COLUMN instant_payout_fee_bps integer NOT NULL DEFAULT 150;

ALTER TABLE public.branding_settings
  ADD CONSTRAINT instant_payout_fee_bps_range CHECK (instant_payout_fee_bps BETWEEN 0 AND 1000);