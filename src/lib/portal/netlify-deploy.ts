import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side helpers to deploy a presentation .zip to the user's Netlify
 * account. We POST the zip to our own server route which proxies to
 * api.netlify.com — this avoids browser CORS failures we hit calling
 * Netlify directly (intermittent duplicate `Access-Control-Allow-Origin: *, *`
 * response headers from Netlify's edge).
 *
 * Slug rules follow Netlify's site-name constraints:
 *   - lowercase letters, digits, hyphens
 *   - 1..63 chars
 *   - cannot start or end with a hyphen
 */
export const NETLIFY_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugifyForNetlify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isValidNetlifySlug(slug: string): boolean {
  return NETLIFY_SLUG_REGEX.test(slug);
}

type ProgressFn = (label: string) => void;

interface DeployResult {
  liveUrl: string;
  adminUrl: string;
  siteName: string;
  /** True when the slug was already taken globally; we kept Netlify's auto name. */
  fellBackToAutoName: boolean;
}

/**
 * Upload the zip to our server-side proxy, which forwards it to Netlify
 * using the user's stored OAuth access token. Returns the live + admin
 * URLs and the final site name.
 *
 * The `accessToken` param is intentionally ignored — the server reads the
 * Netlify token from the database keyed to the authenticated user. The
 * signature is kept stable so callers (PublishDistributeSection) don't
 * need to change.
 */
export async function deployZipToNetlify(params: {
  blob: Blob;
  desiredSlug: string;
  /** @deprecated kept for signature compatibility; server reads token from DB */
  accessToken?: string;
  onProgress?: ProgressFn;
}): Promise<DeployResult> {
  const { blob, desiredSlug, onProgress } = params;
  const progress = onProgress ?? (() => {});

  // Attach the user's Supabase bearer so the server can resolve user_id.
  const { data: sessionData } = await supabase.auth.getSession();
  const bearer = sessionData.session?.access_token;
  if (!bearer) {
    throw new Error("You must be signed in to publish.");
  }

  const form = new FormData();
  form.append("zip", blob, "site.zip");
  form.append("desiredSlug", desiredSlug);

  progress("Uploading to Netlify…");

  const res = await fetch("/api/public/netlify-deploy", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}` },
    body: form,
  });

  progress("Finalizing deploy…");

  if (!res.ok) {
    let message = `Publish failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      const text = await safeText(res);
      if (text) message = text;
    }
    throw new Error(message);
  }

  progress("Setting your custom URL…");

  const data = (await res.json()) as DeployResult;
  return data;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
