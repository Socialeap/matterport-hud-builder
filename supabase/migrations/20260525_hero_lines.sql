-- Add hero_lines JSONB column to branding_settings.
-- Stores an array of 3 objects: [{text, color, fontFamily}, ...].
-- NULL means "use the hardcoded default headline".
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS hero_lines jsonb DEFAULT NULL;
