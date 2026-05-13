## What is still disconnected

The polygon matcher itself is working: when the search includes real coordinates for Bellmore/Bellerose, the database returns **Socialeap** with `match_reason = polygon`.

The remaining failure is before the database match:

1. The Directory UI lets the user type only `Bellmore` or `Bellrose/Bellerose` while the State field is optional.
2. The geocode API currently refuses to geocode city-only input without a 2-letter state, so it returns `{ lat: null, lng: null }`.
3. The Directory then calls `search_msp_directory` with only `p_city: "Bellmore"`.
4. Socialeap’s profile city is `Queens`, so the city-name fallback does not match, even though the drawn polygon covers Bellmore.
5. ZIP works only because those ZIPs were manually added, which confirms the issue is not the card visibility or public listing status.

There is one more likely issue: the published custom domain appears to still return `lat:null,lng:null` even for `Bellmore, NY`, so the latest geocoder behavior may not be active there yet or is not robust enough for published runtime.

## Safe comprehensive fix

### 1. Make geography search state-aware by default
- Change the Directory state field from “optional” to a practical default for this launch market: default `NY` when searching by city.
- If the user clears the state, show a clear prompt instead of silently falling back to weak city-name matching.
- This prevents ambiguous searches like `Bellmore` from bypassing polygon matching.

### 2. Harden the geocoder for real town searches
- Update `geocodeAddress()` so Nominatim checks more than only the first result.
- Accept valid locality/boundary results such as `boundary/census` as well as `place/town`, since Bellmore can appear as either.
- Keep strict filtering to avoid POIs/streets poisoning the search.
- Add a safe fallback using full-text query `"City, State, USA"` when structured city/state returns no valid locality.
- Keep timeout, rate limit, User-Agent, and cache behavior.

### 3. Add a backend fallback when city-only searches slip through
- Update `search_msp_directory` to allow a conservative city-only fallback against provider service coverage data, not just provider `primary_city`.
- The safest version is: city name can match only if the MSP has explicitly listed that city/ZIP-equivalent service data or the query was geocoded; otherwise do not over-broaden results.
- Prefer requiring coordinates for polygon/radius matches, because polygons cannot be tested without a point.

### 4. Improve UI feedback so this cannot fail silently again
- When a city search cannot be geocoded, show a small inline message: “Add a state to search drawn service areas.”
- If coordinates are resolved, continue showing the match chip: “Matched: Service area.”
- Keep ZIP search behavior unchanged.

### 5. Verify the complete path
After implementation, test these cases end-to-end:
- `Bellmore` with default `NY` returns Socialeap via `polygon`.
- `Bellmore, NY` / City=`Bellmore`, State=`NY` returns Socialeap via `polygon`.
- `Bellerose`, State=`NY` returns Socialeap via `polygon` if inside the drawn area.
- Misspelled `Bellrose`, State=`NY` should not falsely match a street/POI; either resolve safely or show no match with guidance.
- Existing ZIP search still returns Socialeap when ZIP is listed.

## Files/functions to change

- `src/routes/agents.tsx`
  - default/require state for city search
  - surface geocoding status to the user
  - keep coordinates wired into `search_msp_directory`

- `src/server/geocode.server.ts`
  - improve Nominatim result selection and fallback query logic

- `src/routes/api/geocode-directory-query.ts`
  - keep the route public/read-only and rate-limited, but return enough failure context for the UI to guide the user

- Database migration
  - update `search_msp_directory` only if needed after the stronger geocode path; avoid broadening matches in a way that could show MSPs outside their service area.