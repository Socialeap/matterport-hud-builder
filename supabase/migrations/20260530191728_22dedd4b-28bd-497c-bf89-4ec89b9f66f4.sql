REVOKE EXECUTE ON FUNCTION public.process_raw_snapshot(UUID) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_unprocessed_snapshots(INT) FROM anon, authenticated;