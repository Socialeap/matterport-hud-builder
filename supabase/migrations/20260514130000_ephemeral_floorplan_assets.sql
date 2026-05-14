-- ============================================================
-- EPHEMERAL FLOORPLAN ASSETS
-- Interactive SVG Floor Map feature (Pro MSP Studios)
--
-- Privacy-first: clients upload raster floor plans (PNG/JPG) that
-- the `vectorize-floorplan` Edge Function converts into an SVG
-- string embedded directly in the exported standalone HTML file.
-- The original raster is held transiently for 30 days so the
-- client can re-run vectorization if needed, then auto-deleted.
--
-- The exported HTML is fully self-contained — it does NOT reference
-- the storage URL. Once the SVG is embedded, the original raster
-- is no longer required for the presentation to work.
-- ============================================================

-- 1 ─ Tracking table: each row maps a storage object to its
--     uploader and its scheduled purge time.
CREATE TABLE IF NOT EXISTS public.ephemeral_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  bucket_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  purpose TEXT NOT NULL DEFAULT 'floorplan_vectorize',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '30 days'),
  UNIQUE (bucket_id, file_path)
);

CREATE INDEX IF NOT EXISTS ephemeral_assets_user_idx
  ON public.ephemeral_assets (user_id);

CREATE INDEX IF NOT EXISTS ephemeral_assets_expires_idx
  ON public.ephemeral_assets (expires_at);

ALTER TABLE public.ephemeral_assets ENABLE ROW LEVEL SECURITY;

-- Owner-only CRUD. Service role bypasses RLS for the cleanup job
-- and the vectorize-floorplan edge function.
DO $$ BEGIN
  CREATE POLICY "Owners can view their ephemeral assets"
    ON public.ephemeral_assets FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can insert their ephemeral assets"
    ON public.ephemeral_assets FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can delete their ephemeral assets"
    ON public.ephemeral_assets FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2 ─ Storage bucket. Private (not public) — files only readable
--     by the uploader via signed URL or by the service role inside
--     the Edge Function.
INSERT INTO storage.buckets (id, name, public)
  VALUES ('temporary-floorplans', 'temporary-floorplans', false)
  ON CONFLICT (id) DO NOTHING;

-- Files are organised under `{user_id}/{timestamp}-{filename}` so
-- the first path segment is the uploader's auth.uid().
DO $$ BEGIN
  CREATE POLICY "Owners can read their floorplan uploads"
    ON storage.objects FOR SELECT
    USING (
      bucket_id = 'temporary-floorplans'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can upload their floorplan uploads"
    ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'temporary-floorplans'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Owners can delete their floorplan uploads"
    ON storage.objects FOR DELETE
    USING (
      bucket_id = 'temporary-floorplans'
      AND auth.uid()::text = (storage.foldername(name))[1]
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3 ─ Cleanup function: deletes expired ephemeral_assets rows AND
--     their backing storage objects in a single transaction. The
--     storage.objects DELETE cascades naturally; we mirror the path
--     here so we don't depend on the bucket's lifecycle rules.
CREATE OR REPLACE FUNCTION public.purge_expired_ephemeral_assets()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_deleted INTEGER := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id, bucket_id, file_path
      FROM public.ephemeral_assets
     WHERE expires_at <= now()
     LIMIT 1000
  LOOP
    -- Physically remove the file. If the object is already gone
    -- (e.g. the user manually deleted it), keep going.
    BEGIN
      DELETE FROM storage.objects
       WHERE bucket_id = rec.bucket_id
         AND name = rec.file_path;
    EXCEPTION WHEN OTHERS THEN
      -- Swallow: don't let one bad object block the whole sweep.
      RAISE NOTICE 'purge_expired_ephemeral_assets: storage delete failed for % / %: %',
        rec.bucket_id, rec.file_path, SQLERRM;
    END;

    DELETE FROM public.ephemeral_assets WHERE id = rec.id;
    v_deleted := v_deleted + 1;
  END LOOP;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_expired_ephemeral_assets() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_ephemeral_assets() TO service_role;

-- 4 ─ Daily cron: 03:45 UTC (off-peak, after the existing
--     outreach-body cleanup at 03:30).
DO $$ BEGIN
  PERFORM cron.unschedule('purge_expired_ephemeral_assets');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'purge_expired_ephemeral_assets',
  '45 3 * * *',
  $cron$ SELECT public.purge_expired_ephemeral_assets(); $cron$
);
