/**
 * Client-safe resolver for the publishable Supabase URL + anon key.
 *
 * Resolution order:
 *   1. Vite build-time injection (`import.meta.env.VITE_SUPABASE_*`)
 *   2. SSR / server-side `process.env.*` (VITE_ or unprefixed)
 *   3. Hardcoded publishable fallback baked in at the time of writing.
 *
 * The fallback only contains values that are explicitly designated as
 * publishable (anon) — never service-role or other private secrets. This
 * exists so that a published bundle keeps working if the publish-time
 * build environment fails to inject `.env` (which is gitignored).
 */

// Publishable, safe to ship to browsers.
const FALLBACK_SUPABASE_URL = "https://cllvwdzjgqlkdquroauz.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_qEqYhK6jktqPjA7uO-XqXQ_V6noQKUa";

function readImportMetaEnv(name: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env = (import.meta as any)?.env;
    const v = env?.[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function readProcessEnv(name: string): string | undefined {
  try {
    if (typeof process === "undefined" || !process?.env) return undefined;
    const v = process.env[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function getSupabaseUrl(): string {
  return (
    readImportMetaEnv("VITE_SUPABASE_URL") ??
    readProcessEnv("VITE_SUPABASE_URL") ??
    readProcessEnv("SUPABASE_URL") ??
    FALLBACK_SUPABASE_URL
  );
}

export function getSupabasePublishableKey(): string {
  return (
    readImportMetaEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ??
    readProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ??
    readProcessEnv("SUPABASE_PUBLISHABLE_KEY") ??
    FALLBACK_SUPABASE_PUBLISHABLE_KEY
  );
}
