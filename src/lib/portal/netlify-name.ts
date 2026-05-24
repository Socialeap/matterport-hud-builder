export const NETLIFY_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isRecoverableNetlifyNameConflict(status: number, body: string): boolean {
  if (status !== 400 && status !== 409 && status !== 422) return false;

  const normalized = flattenNetlifyErrorBody(body).toLowerCase();
  if (!normalized) return false;

  const mentionsNameField =
    normalized.includes("name") ||
    normalized.includes("subdomain") ||
    normalized.includes("custom domain") ||
    normalized.includes("site name");
  const mentionsConflict =
    normalized.includes("unique") ||
    normalized.includes("taken") ||
    normalized.includes("already") ||
    normalized.includes("exist") ||
    normalized.includes("unavailable");

  return mentionsNameField && mentionsConflict;
}

export function buildFallbackNetlifySlugs(baseSlug: string, count = 5): string[] {
  const unique = randomSuffixSeed();
  return Array.from({ length: count }, (_, index) => {
    const suffix = index === 0 ? unique.slice(0, 6) : `${unique.slice(0, 4)}${index + 1}`;
    const trimmedBase = baseSlug.replace(/-+$/g, "").slice(0, Math.max(1, 62 - suffix.length));
    return `${trimmedBase}-${suffix}`.replace(/^-+|-+$/g, "").slice(0, 63);
  }).filter((slug) => NETLIFY_SLUG_REGEX.test(slug));
}

function flattenNetlifyErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";

  try {
    return collectJsonText(JSON.parse(trimmed)).join(" ");
  } catch {
    return trimmed;
  }
}

function collectJsonText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(collectJsonText);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...collectJsonText(nested)]);
  }
  return [];
}

function randomSuffixSeed(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID().replace(/-/g, "").toLowerCase();
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.toLowerCase();
}