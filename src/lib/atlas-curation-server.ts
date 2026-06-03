/**
 * Atlas curation enrichment (server-only).
 *
 * Resolves a place from name + address and drafts Atlas listing metadata for the
 * admin Curated Listing Assistant. Preference order:
 *   1. Google Places (legacy Text Search + Details) when GOOGLE_PLACES_API_KEY is
 *      present in the server runtime — gives place_id, exact lat/lng, formatted
 *      address, types, website, phone, and multi-match candidates.
 *   2. Free city-level geocode (Census + Nominatim) via geocodeAddress().
 *   3. Manual entry by the admin (handled in the UI / update fn).
 *
 * Server-only: reads process.env and uses geocode.server. Reached exclusively via
 * dynamic import inside server-fn handlers, so it never enters the client bundle.
 * Only the fixed Google host is fetched (no arbitrary/user URLs → no SSRF).
 */
import { geocodeAddress } from "@/server/geocode.server";
import type {
  AtlasCurationDraft,
  AtlasPlaceCandidate,
} from "./atlas-demo-data";

const PLACES_TEXT_SEARCH =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const PLACES_DETAILS = "https://maps.googleapis.com/maps/api/place/details/json";
const DETAILS_FIELDS =
  "place_id,name,formatted_address,geometry,types,website,formatted_phone_number,address_components";
const FETCH_TIMEOUT_MS = 6000;
const MAX_CANDIDATES = 5;

function placesKey(): string | null {
  const k = (process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  return k.length > 0 ? k : null;
}

export function placesAvailable(): boolean {
  return placesKey() !== null;
}

interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface ResolvedPlace {
  place_id: string;
  name: string;
  formatted_address: string;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  website: string | null;
  phone: string | null;
  city: string;
  region: string;
  country: string;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function pickComponent(
  components: GoogleAddressComponent[],
  type: string,
  field: "long_name" | "short_name" = "long_name",
): string {
  const c = components.find((x) => x.types.includes(type));
  return c ? c[field] : "";
}

function parseComponents(components: GoogleAddressComponent[]): {
  city: string;
  region: string;
  country: string;
} {
  const city =
    pickComponent(components, "locality") ||
    pickComponent(components, "postal_town") ||
    pickComponent(components, "sublocality") ||
    pickComponent(components, "administrative_area_level_2");
  const region = pickComponent(components, "administrative_area_level_1", "short_name");
  const country = pickComponent(components, "country", "short_name") || "US";
  return { city, region, country };
}

/**
 * Google Places Text Search. Returns up to MAX_CANDIDATES candidates and whether
 * Places was even available (no key → available:false, empty candidates).
 */
export async function resolvePlaceCandidates(
  query: string,
): Promise<{ available: boolean; candidates: AtlasPlaceCandidate[] }> {
  const key = placesKey();
  if (!key || !query.trim()) return { available: Boolean(key), candidates: [] };

  const url = `${PLACES_TEXT_SEARCH}?query=${encodeURIComponent(query.trim())}&key=${key}`;
  const data = (await fetchJson(url)) as
    | { status?: string; results?: Array<Record<string, unknown>> }
    | null;
  if (!data || (data.status !== "OK" && data.status !== "ZERO_RESULTS")) {
    return { available: true, candidates: [] };
  }
  const results = Array.isArray(data.results) ? data.results : [];
  const candidates: AtlasPlaceCandidate[] = results
    .slice(0, MAX_CANDIDATES)
    .map((r) => {
      const geometry = r.geometry as { location?: { lat?: number; lng?: number } } | undefined;
      const loc = geometry?.location;
      return {
        place_id: String(r.place_id ?? ""),
        name: String(r.name ?? ""),
        formatted_address: String(r.formatted_address ?? ""),
        latitude: typeof loc?.lat === "number" ? loc.lat : null,
        longitude: typeof loc?.lng === "number" ? loc.lng : null,
        types: Array.isArray(r.types) ? (r.types as string[]) : [],
      };
    })
    .filter((c) => c.place_id);
  return { available: true, candidates };
}

/** Google Place Details for a specific place_id → full resolved place. */
export async function fetchPlaceDetails(placeId: string): Promise<ResolvedPlace | null> {
  const key = placesKey();
  if (!key || !placeId) return null;
  const url = `${PLACES_DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=${DETAILS_FIELDS}&key=${key}`;
  const data = (await fetchJson(url)) as
    | { status?: string; result?: Record<string, unknown> }
    | null;
  if (!data || data.status !== "OK" || !data.result) return null;
  const r = data.result;
  const geometry = r.geometry as { location?: { lat?: number; lng?: number } } | undefined;
  const loc = geometry?.location;
  const components = (Array.isArray(r.address_components)
    ? r.address_components
    : []) as GoogleAddressComponent[];
  const { city, region, country } = parseComponents(components);
  return {
    place_id: String(r.place_id ?? placeId),
    name: String(r.name ?? ""),
    formatted_address: String(r.formatted_address ?? ""),
    latitude: typeof loc?.lat === "number" ? loc.lat : null,
    longitude: typeof loc?.lng === "number" ? loc.lng : null,
    types: Array.isArray(r.types) ? (r.types as string[]) : [],
    website: typeof r.website === "string" ? r.website : null,
    phone: typeof r.formatted_phone_number === "string" ? r.formatted_phone_number : null,
    city,
    region,
    country,
  };
}

/** Free city-level geocode fallback (no API key). Returns null on no match. */
export async function cityLevelGeocode(
  city: string,
  region: string,
): Promise<{ lat: number; lng: number } | null> {
  if (!city.trim() || !region.trim()) return null;
  return geocodeAddress({ city: city.trim(), region: region.trim() });
}

/** Map Google place types → an Atlas category. */
export function inferCategory(types: string[]): string {
  const t = new Set(types);
  if (t.has("restaurant") || t.has("cafe") || t.has("bar") || t.has("food") || t.has("bakery"))
    return "restaurant";
  if (t.has("lodging") || t.has("hotel")) return "hotel";
  if (t.has("art_gallery")) return "gallery";
  if (t.has("museum") || t.has("tourist_attraction") || t.has("place_of_worship") || t.has("library"))
    return "cultural";
  if (t.has("gym") || t.has("spa") || t.has("health")) return "wellness";
  if (t.has("store") || t.has("shopping_mall") || t.has("clothing_store") || t.has("furniture_store"))
    return "retail";
  if (t.has("stadium") || t.has("convention_center") || t.has("banquet_hall")) return "event_space";
  return "other";
}

/**
 * Assemble the editable Atlas draft from admin inputs + (optional) resolved place.
 * Neutral, truthful copy — never implies partnership/endorsement.
 */
export function buildDraft(args: {
  inputName: string;
  inputAddress: string;
  inputCategory: string;
  inputCity: string;
  inputRegion: string;
  inputCountry: string;
  resolved: ResolvedPlace | null;
  latitude: number | null;
  longitude: number | null;
}): AtlasCurationDraft {
  const resolved = args.resolved;
  const title = (args.inputName || resolved?.name || "").trim();
  const city = (resolved?.city || args.inputCity || "").trim();
  const region = (resolved?.region || args.inputRegion || "").trim();
  const country = (resolved?.country || args.inputCountry || "US").trim().toUpperCase().slice(0, 2) || "US";
  const address = (resolved?.formatted_address || args.inputAddress || "").trim();
  const category =
    args.inputCategory.trim() ||
    (resolved ? inferCategory(resolved.types) : "other");

  const loc = [city, region].filter(Boolean).join(", ");
  const summary = title
    ? `Curated showcase of ${title}${loc ? ` in ${loc}` : ""}. Step inside this immersive 3D space on the Frontiers3D Atlas.`
    : "";

  const tags = Array.from(
    new Set(
      ["curated", category, ...(resolved?.types ?? []).slice(0, 3)]
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 12);

  return {
    title,
    category,
    summary,
    tags,
    address,
    city,
    region,
    country,
    latitude: args.latitude,
    longitude: args.longitude,
    hero_image_url: "",
  };
}

// ── Minimal-but-real curated presentation package ────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "frontiers3d-presentation"
  );
}

export interface CuratedPackageInput {
  curationJobId: string;
  matterportId: string;
  title: string;
  summary: string;
  category: string;
  city: string;
  region: string;
  tags: string[];
  heroImageUrl: string;
}

export interface CuratedPackageResult {
  base64: string;
  filename: string;
  sizeBytes: number;
}

/**
 * Render a self-contained, default-branded Frontiers3D presentation page that
 * embeds the curated Matterport tour. Minimal but real: a single index.html with
 * inline styles and the live Matterport iframe — no build step, deployable as-is.
 */
function renderCuratedHtml(input: CuratedPackageInput): string {
  const title = escapeHtml(input.title || "Frontiers3D Showcase");
  const loc = escapeHtml([input.city, input.region].filter(Boolean).join(", "));
  const summary = escapeHtml(input.summary || "");
  const desc = summary || `${title}${loc ? ` — ${loc}` : ""}. An immersive 3D showcase on the Frontiers3D Atlas.`;
  const embedSrc = `https://my.matterport.com/show/?m=${encodeURIComponent(input.matterportId)}&play=1`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Frontiers3D</title>
<meta name="description" content="${escapeHtml(desc)}" />
<meta property="og:title" content="${title} — Frontiers3D" />
<meta property="og:description" content="${escapeHtml(desc)}" />
<style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#0a0e27;color:#fff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  body{display:flex;flex-direction:column}
  .f3d-stage{position:relative;flex:1;min-height:0}
  .f3d-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#020617}
</style>
</head>
<body>
<main class="f3d-stage">
  <iframe class="f3d-frame" src="${embedSrc}" title="${title} — 3D tour"
    allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay"
    allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
</main>
</body>
</html>`;
}


/**
 * The files that make up a curated showcase folder: index.html (branded
 * Matterport embed) + atlas-manifest.json. Shared by the downloadable zip and
 * the GitHub-repo publishing path so both produce an identical folder.
 */
export function buildShowcaseFiles(input: CuratedPackageInput): Record<string, string> {
  const manifest = {
    service: "frontiers3d-atlas",
    version: 1 as const,
    kind: "curated_showcase" as const,
    curation_job_id: input.curationJobId,
    matterport_id: input.matterportId,
    issued_at: new Date().toISOString(),
  };
  return {
    "index.html": renderCuratedHtml(input),
    "atlas-manifest.json": JSON.stringify(manifest, null, 2),
  };
}

/**
 * Build the curated package zip (flat root: index.html + atlas-manifest.json).
 * Reuses fflate (Node-compatible) + the Atlas manifest shape. Returns base64 so
 * the admin server fn can hand it straight to the browser for download — the
 * package is a few KB (the Matterport tour is embedded, not bundled).
 */
export async function buildCuratedPackageZip(
  input: CuratedPackageInput,
): Promise<CuratedPackageResult> {
  const { zipSync, strToU8 } = await import("fflate");
  const files = buildShowcaseFiles(input);
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    zipInput[path] = strToU8(content);
  }
  const zipped = zipSync(zipInput, { level: 6 });
  return {
    base64: Buffer.from(zipped).toString("base64"),
    filename: `${slugify(input.title)}-frontiers3d-${new Date().toISOString().slice(0, 10)}.zip`,
    sizeBytes: zipped.length,
  };
}
