-- Fix remaining linter warnings: pin search_path on pgmq helper functions.
-- These functions wrap pgmq.* calls, so they need pgmq + public on the path.

ALTER FUNCTION public.enqueue_email(text, jsonb)        SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint)        SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb)   SET search_path = public, pgmq;

-- Move the pgvector extension out of the public schema (linter 0014).
-- Creates a dedicated `extensions` schema and relocates the extension.
-- Existing vector columns continue to work because the type OIDs are preserved.
CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO postgres, anon, authenticated, service_role;
ALTER EXTENSION vector SET SCHEMA extensions;

-- Make the new schema discoverable so existing code referencing `vector`
-- (without schema qualification) keeps resolving.
ALTER DATABASE postgres SET search_path = "$user", public, extensions;