REVOKE EXECUTE ON FUNCTION public.get_effective_tier(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_effective_tier(uuid) TO authenticated;