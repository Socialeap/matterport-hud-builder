/**
 * Centralized helper for generating public-facing URLs.
 *
 * Rules:
 * - Default to the canonical production domain (3dps.transcendencemedia.com)
 *   for all MSP-facing studio + presentation links, regardless of where the
 *   app is currently being viewed (preview, lovable.app subdomain, etc.).
 * - Pro-tier MSPs with a verified `custom_domain` get full whitelabel — their
 *   own domain is used as the base for studio + presentation URLs.
 * - Platform-internal URLs (signup invitations, password resets, OAuth
 *   callbacks) MUST always use the canonical platform domain. Pass
 *   `{ scope: "platform" }` to enforce this.
 */

const FALLBACK_PRODUCTION_DOMAIN = "https://3dps.transcendencemedia.com";

function getCanonicalPlatformUrl(): string {
  const envUrl = (import.meta as unknown as { env?: Record<string, string | undefined> })
    .env?.VITE_PUBLIC_SITE_URL;
  if (envUrl && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, "");
  }
  return FALLBACK_PRODUCTION_DOMAIN;
}

export interface PublicUrlOptions {
  /**
   * Pro-tier MSP custom domain (e.g. "tours.acme.com"). Only honored when
   * `tier === "pro"`. Can include or omit protocol — protocol is normalized.
   */
  customDomain?: string | null;
  tier?: "starter" | "pro" | null;
  /**
   * "studio" (default) — MSP-facing studio/presentation URL. Honors custom domain on Pro.
   * "platform" — internal platform URL (signup, OAuth, password reset). Always canonical.
   */
  scope?: "studio" | "platform";
}

/**
 * Returns the base URL (no trailing slash, no path) appropriate for the given
 * options. Safe to call on the server (no `window` access).
 */
export function getPublicBaseUrl(opts: PublicUrlOptions = {}): string {
  const { customDomain, tier, scope = "studio" } = opts;
  if (scope === "studio" && tier === "pro" && customDomain && customDomain.trim().length > 0) {
    const trimmed = customDomain.trim().replace(/\/+$/, "");
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }
  return getCanonicalPlatformUrl();
}

/**
 * Build a public studio URL for a given slug. Honors Pro custom domains.
 * Examples:
 *   buildStudioUrl("acme") -> "https://3dps.transcendencemedia.com/p/acme"
 *   buildStudioUrl("acme", { tier: "pro", customDomain: "tours.acme.com" })
 *     -> "https://tours.acme.com/p/acme"
 */
export function buildStudioUrl(slug: string, opts: PublicUrlOptions = {}): string {
  return `${getPublicBaseUrl(opts)}/p/${slug}`;
}

export function buildDemoUrl(slug: string, opts: PublicUrlOptions = {}): string {
  return `${getPublicBaseUrl(opts)}/p/${slug}/demo`;
}

/**
 * Platform URL builder — always canonical, never tied to an MSP's domain.
 * Use for signup invites, OAuth callbacks, password resets.
 */
export function buildPlatformUrl(path: string): string {
  const base = getPublicBaseUrl({ scope: "platform" });
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/**
 * Build a public invitation acceptance URL. Always uses the canonical
 * platform domain so the same link works across browsers, devices, and
 * messaging apps regardless of which MSP studio sent it.
 */
export function buildInvitationUrl(token: string): string {
  return buildPlatformUrl(`/invite/${token}`);
}
