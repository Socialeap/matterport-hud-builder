# Why Bellmore returns zero results

I traced the full path end-to-end. The **SQL matcher is correct** — calling `search_msp_directory('Bellmore','NY',NULL,40.6687,-73.5251)` directly against the database returns Socialeap with `match_reason = polygon`. Socialeap's drawn polygon does contain Bellmore (verified with `ST_Contains`).

The break is one step earlier: **the geocoder never produces a lat/lng for "Bellmore, NY"**, so the frontend sends `p_lat=null, p_lng=null` to the RPC and only the ZIP / fuzzy-city fallbacks run. Neither matches:

- Socialeap's `primary_city` is **Queens**, not Bellmore (no trigram hit).
- Bellmore's ZIP **11710** is not in Socialeap's `service_zips` array.

Result: zero matches, even though the polygon clearly covers Bellmore.

## Root cause

`src/server/geocode.server.ts` uses the **US Census onelineaddress** endpoint. Census is tuned for street addresses; bare "City, State" queries return `addressMatches: []`. I confirmed this live — Census returns nothing for "Bellmore, NY". The previous design assumed the SQL fallbacks would catch this, but they only work when the MSP's own city/ZIPs happen to overlap, which defeats the entire point of polygon-based service areas.

## Fix: add a Nominatim (OpenStreetMap) fallback

Nominatim resolves "Bellmore, NY" trivially (verified: returns 40.6602, -73.5266). It's free, no API key, and our volume — a single call per directory search — is well inside their usage policy as long as we send a proper `User-Agent` and don't hammer it.

### Changes

**1. `src/server/geocode.server.ts`** — extend `geocodeAddress()` with a two-tier strategy:

```text
Tier 1: Census onelineaddress (fast, great for ZIP + street)
        ↓ returns null
Tier 2: Nominatim structured query (city=…&state=…&country=USA)
        - Required header: User-Agent: "3DPS-MSP-Directory/1.0 (contact@…)"
        - 5s timeout, AbortController
        - Accept only results with class=place or type∈{town,city,village,hamlet,suburb}
        - Return null on any failure → SQL fallbacks still run
```

No change to the function signature, so the API route and all other callers keep working unchanged.

**2. Light in-memory cache** in `geocode.server.ts` — keep the last ~200 `{city,region,zip}` lookups for 24 h. Cuts Nominatim load to near-zero for repeated searches and keeps us well-mannered.

**3. No DB / no schema / no UI changes.** The RPC, the directory page, and `src/routes/api/geocode-directory-query.ts` are already correct — they just need the geocoder to actually return coordinates.

### Verification plan

After the change I will:
1. Hit `/api/geocode-directory-query` with `{city:"Bellmore",region:"NY"}` and confirm it returns `{lat:~40.66, lng:~-73.53}`.
2. Re-run the live `search_msp_directory` RPC with those coords (already proven to return Socialeap with `match_reason='polygon'`).
3. Walk through the `/agents` page handler to confirm the lat/lng is forwarded as `p_lat`/`p_lng` (already wired — I re-read `agents.tsx` during diagnosis).

## What I am NOT changing

- The SQL matcher (working correctly).
- `search_msp_directory` signature, RLS, or `is_directory_public` filter.
- Socialeap's `service_zips` (backfilling ZIPs from polygons is out of scope and would mask the real bug).
- The match-beacons edge function (uses its own correct path via `claim_pending_beacon_matches`).
- Any UI on `/agents` or the branding page.

## Why not a different provider

- **Google / Mapbox**: require API key + billing; overkill for one geocode per search.
- **Census Gazetteer table**: would work but requires importing ~30k rows and maintaining them — heavier than a fallback HTTP call.
- **Census alone**: already proven insufficient — this is exactly the bug.

Nominatim with Census as the first-try is the smallest, lowest-risk change that closes the gap.
