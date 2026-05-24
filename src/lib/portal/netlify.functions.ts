import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CANONICAL_NETLIFY_OAUTH_ORIGIN = "https://matterport-hud-builder.lovable.app";
const CANONICAL_NETLIFY_REDIRECT_URI = `${CANONICAL_NETLIFY_OAUTH_ORIGIN}/api/public/netlify-oauth-callback`;

const ALLOWED_NETLIFY_START_ORIGINS = new Set([
  "https://matterport-hud-builder.lovable.app",
  "https://3dps.transcendencemedia.com",
]);

function readRequiredNetlifySecret(name: "NETLIFY_OAUTH_CLIENT_ID" | "NETLIFY_OAUTH_CLIENT_SECRET"): string {
  const raw = process.env[name];
  const value = raw?.trim();
  if (!value) {
    throw new Error("Netlify integration is not configured.");
  }
  if (/\s/.test(value)) {
    throw new Error("Netlify integration credentials contain invalid whitespace.");
  }
  return value;
}

/**
 * Netlify validates redirect_uri by exact string match. Use one canonical
 * callback for every allowed start origin, then postMessage back to the opener.
 */
function netlifyRedirectUri(): string {
  return CANONICAL_NETLIFY_REDIRECT_URI;
}

function normalizeAllowedStartOrigin(value: string): string {
  try {
    const url = new URL(value);
    const origin = url.origin.replace(/\/$/, "");
    if (!ALLOWED_NETLIFY_START_ORIGINS.has(origin)) {
      throw new Error("unsupported-origin");
    }
    return origin;
  } catch {
    throw new Error(
      "Netlify publishing must be started from the live site or custom domain. Preview URLs are not registered with the Netlify OAuth app.",
    );
  }
}

function requireAllowedRequestOrigin(expectedOrigin: string): void {
  const request = getRequest();
  const requestOrigin =
    request.headers.get("origin") ||
    request.headers.get("referer") ||
    new URL(request.url).origin;
  const normalizedRequestOrigin = normalizeAllowedStartOrigin(requestOrigin);
  if (normalizedRequestOrigin !== expectedOrigin) {
    throw new Error(
      "Netlify publishing must be started from the same live site origin reported by the browser.",
    );
  }
}

/**
 * Begin the Netlify OAuth dance. Inserts a short-lived state row keyed to
 * the authenticated user, returns the full Netlify authorize URL for the
 * client to open in a popup.
 */
export const startNetlifyOAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { origin: string }) => input)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const clientId = readRequiredNetlifySecret("NETLIFY_OAUTH_CLIENT_ID");

    const origin = normalizeAllowedStartOrigin(data.origin);
    requireAllowedRequestOrigin(origin);
    const redirectUri = netlifyRedirectUri();

    const state = crypto.randomUUID() + crypto.randomUUID();

    // Clean up old states for this user (keep table small).
    await supabaseAdmin
      .from("netlify_oauth_states")
      .delete()
      .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    const { error } = await supabaseAdmin
      .from("netlify_oauth_states")
      .insert({ state, user_id: userId });
    if (error) {
      console.error("[netlify-oauth] failed to persist state", error);
      throw new Error("Could not start Netlify sign-in. Try again.");
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
    return {
      authorizeUrl: `https://app.netlify.com/authorize?${params.toString()}`,
    };
  });

/**
 * Get the current user's Netlify connection summary (no token returned).
 */
export const getNetlifyConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("netlify_connections")
      .select("netlify_user_email, netlify_user_full_name, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[netlify] connection lookup failed", error);
      return { connected: false as const };
    }
    if (!data) return { connected: false as const };
    return {
      connected: true as const,
      email: data.netlify_user_email,
      fullName: data.netlify_user_full_name,
      updatedAt: data.updated_at,
    };
  });

/**
 * Return the access token for the authenticated user. Used by the client
 * to call the Netlify API directly (upload zip, rename site). Tokens are
 * NEVER sent to non-authenticated callers; RLS would also block anon reads.
 */
export const getNetlifyAccessToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .from("netlify_connections")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) {
      throw new Error("No Netlify connection. Please connect first.");
    }
    return { accessToken: data.access_token };
  });

/**
 * Remove the current user's Netlify connection.
 */
export const disconnectNetlify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    await supabaseAdmin
      .from("netlify_connections")
      .delete()
      .eq("user_id", userId);
    return { success: true };
  });
