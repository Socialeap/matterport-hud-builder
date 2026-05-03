/**
 * US Census Geocoder wrapper.
 *
 * The Census Geocoder is the cheapest viable provider — no API key,
 * no rate limit at our volume, public-API. Its weakness is that it
 * is tuned for street addresses; bare "City, State" queries often
 * return zero matches. Our marketplace inputs are typically
 * "City, State" (with optional ZIP), so the failure mode is
 * common-but-tolerated:
 *
 *   * If ZIP is provided, we pass "{city}, {state} {zip}" — Census
 *     resolves these reliably via ZIP centroid logic.
 *   * If only City+State is provided, the call may return zero
 *     matches. We return null in that case; the SQL matcher's
 *     Tier 3 (ZIP) and Tier 4 (trigram fuzzy city) fallbacks
 *     pick up the slack.
 *
 * Reference: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf
 */

const CENSUS_GEOCODER_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const CENSUS_BENCHMARK = "Public_AR_Current";

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

/**
 * Attempts to geocode a US locality. Returns null on:
 *  - invalid input (missing city/region)
 *  - network/HTTP failure
 *  - zero matches from Census
 *
 * Never throws — callers are expected to treat null as "geocode
 * unavailable" and degrade gracefully.
 */
export async function geocodeAddress(
  input: GeocodeInput,
): Promise<GeocodeResult | null> {
  const city = input.city?.trim();
  const region = input.region?.trim().toUpperCase();
  const zip = input.zip?.trim();

  if (!city || !region || !/^[A-Z]{2}$/.test(region)) {
    return null;
  }

  const oneLine =
    zip && /^\d{5}(-\d{4})?$/.test(zip)
      ? `${city}, ${region} ${zip}`
      : `${city}, ${region}`;

  const url = new URL(CENSUS_GEOCODER_URL);
  url.searchParams.set("address", oneLine);
  url.searchParams.set("benchmark", CENSUS_BENCHMARK);
  url.searchParams.set("format", "json");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as CensusResponse;
    const match = json?.result?.addressMatches?.[0];
    const x = match?.coordinates?.x;
    const y = match?.coordinates?.y;

    if (typeof x !== "number" || typeof y !== "number") return null;
    if (x < -180 || x > 180 || y < -90 || y > 90) return null;

    // Census x = longitude, y = latitude.
    return { lat: round6(y), lng: round6(x) };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
