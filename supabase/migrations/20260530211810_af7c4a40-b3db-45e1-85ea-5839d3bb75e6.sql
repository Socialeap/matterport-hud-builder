REVOKE EXECUTE ON FUNCTION public._compose_hero_summary(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.compose_doorway_payload(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._compose_hero_summary(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.compose_doorway_payload(UUID) TO service_role;