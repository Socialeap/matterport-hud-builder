/**
 * US locality geocoder.
 *
 * Two-tier strategy:
 *   Tier 1 — US Census onelineaddress (no key, fast, great for ZIP +
 *            street). Returns nothing for bare "City, State" queries,
 *            which is the common Directory input.
 *   Tier 2 — Nominatim (OpenStreetMap) structured query. Resolves
 *            "Bellmore, NY" trivially. Free, no key, but requires a
 *            descriptive User-Agent and reasonable rate.
 *
 * Both tiers swallow errors and return null — callers degrade
 * gracefully (the SQL matcher has ZIP / fuzzy-city fallbacks).
 *
 * A small in-memory LRU cache (24h TTL) keeps Nominatim load near
 * zero for repeated Directory searches.
 */

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_UA =
  "3DPS-MSP-Directory/1.0 (admin@3dps.transcendencemedia.com)";

const ACCEPTED_OSM_TYPES = new Set([
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "neighbourhood",
  "municipality",
  "administrative",
]);

export interface GeocodeInput {
  city: string;
  region: string; // 2-letter state code
  zip?: string | null;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
}

interface CensusMatch {
  coordinates?: { x?: number; y?: number };
}
interface CensusResponse {
  result?: { addressMatches?: CensusMatch[] };
}

interface NominatimMatch {
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
}

// ---------- cache ----------
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const CACHE = new Map<string, { value: GeocodeResult | null; ts: number }>();

function cacheKey(i: GeocodeInput): string {
  return `${(i.city || "").trim().toLowerCase()}|${(i.region || "").trim().toUpperCase()}|${(i.zip || "").trim()}`;
}
function cacheGet(k: string): GeocodeResult | null | undefined {
  const hit = CACHE.get(k);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    CACHE.delete(k);
    return undefined;
  }
  // refresh LRU position
  CACHE.delete(k);
  CACHE.set(k, hit);
  return hit.value;
}
function cacheSet(k: string, value: GeocodeResult | null): void {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next().value;
    if (oldest) CACHE.delete(oldest);
  }
  CACHE.set(k, { value, ts: Date.now() });
}

// ---------- public ----------
export async function geocodeAddress(
  input: GeocodeInput,
): Promise<GeocodeResult | null> {
  const city = input.city?.trim();
  const region = input.region?.trim().toUpperCase();
  const zip = input.zip?.trim();

  // Need either (city + 2-letter region) or a ZIP.
  const haveCity = !!city && /^[A-Z]{2}$/.test(region || "");
  const haveZip = !!zip && /^\d{5}(-\d{4})?$/.test(zip);
  if (!haveCity && !haveZip) return null;

  const key = cacheKey({ city: city || "", region: region || "", zip });
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // Tier 1: Census
  const census = await tryCensus({ city, region, zip, haveCity, haveZip });
  if (census) {
    cacheSet(key, census);
    return census;
  }

  // Tier 2: Nominatim — only useful when we have a city+state
  if (haveCity) {
    const osm = await tryNominatim(city!, region!);
    if (osm) {
      cacheSet(key, osm);
      return osm;
    }
  }

  cacheSet(key, null);
  return null;
}

// ---------- providers ----------
async function tryCensus(args: {
  city?: string;
  region?: string;
  zip?: string;
  haveCity: boolean;
  haveZip: boolean;
}): Promise<GeocodeResult | null> {
  const { city, region, zip, haveCity, haveZip } = args;
  if (!haveCity && !haveZip) return null;

  const oneLine =
    haveCity && haveZip
      ? `${city}, ${region} ${zip}`
      : haveCity
        ? `${city}, ${region}`
        : `${zip}`;

  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as CensusResponse;
    const m = json?.result?.addressMatches?.[0];
    const x = m?.coordinates?.x;
    const y = m?.coordinates?.y;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (x < -180 || x > 180 || y < -90 || y > 90) return null;
    return { lat: round6(y), lng: round6(x) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function tryNominatim(
  city: string,
  region: string,
): Promise<GeocodeResult | null> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("city", city);
  url.searchParams.set("state", region);
  url.searchParams.set("country", "USA");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_UA,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as NominatimMatch[];
    const picked = pickLocality(arr);
    if (picked) return picked;
  } catch {
    // fall through to free-text fallback
  } finally {
    clearTimeout(timeout);
  }

  // Fallback: free-text "City, State, USA" query — Nominatim's
  // structured endpoint occasionally misses census-designated
  // places that the q= endpoint resolves cleanly.
  const fallback = new URL(NOMINATIM_URL);
  fallback.searchParams.set("q", `${city}, ${region}, USA`);
  fallback.searchParams.set("format", "json");
  fallback.searchParams.set("limit", "5");
  fallback.searchParams.set("addressdetails", "0");
  fallback.searchParams.set("countrycodes", "us");
  const c2 = new AbortController();
  const t2 = setTimeout(() => c2.abort(), 5_000);
  try {
    const res = await fetch(fallback.toString(), {
      headers: { Accept: "application/json", "User-Agent": NOMINATIM_UA },
      signal: c2.signal,
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as NominatimMatch[];
    return pickLocality(arr);
  } catch {
    return null;
  } finally {
    clearTimeout(t2);
  }
}

function pickLocality(arr: unknown): GeocodeResult | null {
  if (!Array.isArray(arr)) return null;
  for (const m of arr as NominatimMatch[]) {
    const cls = (m.class || "").toLowerCase();
    const typ = (m.type || "").toLowerCase();
    // Accept place/* localities and boundary/{administrative,census}.
    const okClass =
      cls === "place" ||
      (cls === "boundary" && (typ === "administrative" || typ === "census"));
    if (!okClass) continue;
    if (cls === "place" && !ACCEPTED_OSM_TYPES.has(typ)) continue;
    const lat = m.lat ? Number(m.lat) : NaN;
    const lng = m.lon ? Number(m.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    return { lat: round6(lat), lng: round6(lng) };
  }
  return null;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
