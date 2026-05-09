## Root cause found

The request row exists in the database. Token `40449da8-cdf8-4c1b-bf31-5524f73c8a6c` maps to Shakoure Char’s Queens Village, NY service-match request, so the token itself is not invalid.

The failure is downstream: the service-match detail RPC calls `get_service_match_results()`, which depends on a missing database helper: `public._is_provider_serving_beacon(uuid, uuid)`. That helper and its geocoding support columns are referenced by the current matching functions, but they are not present in the live database. When the admin detail page calls the RPC, the result-fetching step can crash and the UI collapses into the misleading “Match not found” state.

A second related data issue is also visible: there are currently zero MSPs marked as public directory candidates (`is_directory_public = true`), so once the backend crash is fixed, the page may correctly show “No qualifying MSPs yet” unless provider directory settings are completed.

## Safest implementation plan

1. **Repair the missing backend matching dependency**
   - Add an idempotent migration that restores the geospatial support expected by service-match functions:
     - `agent_beacons.lat`, `agent_beacons.lng`, `agent_beacons.geocoded_at`, generated `agent_beacons.beacon_point`
     - `branding_settings.geocoded_at`, `branding_settings.service_polygon`, generated `branding_settings.service_center`
     - `public._is_provider_serving_beacon(provider_id, beacon_id)`
   - Use `CREATE EXTENSION IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` so existing data is preserved.
   - Keep matching logic unchanged: provider must be public, serve the visitor location, and satisfy all Essential services.

2. **Preserve privacy and access boundaries**
   - Keep the visitor match page public but PII-free.
   - Keep the admin detail RPC admin-only for visitor name, email, company, and full request context.
   - Do not widen direct table access to `agent_beacons`.

3. **Make the admin detail page report real backend errors**
   - Update `src/routes/_authenticated.admin.service-matches.$matchToken.tsx` so RPC errors display an admin-facing error state instead of pretending the token was not found.
   - Keep true `status: "not_found"` only for actual missing rows.
   - This prevents future backend regressions from being misdiagnosed as bad tokens.

4. **Make the public `/agents/match/$matchToken` page report RPC failures separately**
   - Capture errors from `get_service_match_summary` and `get_service_match_results`.
   - Show “Unable to load match” for backend/RPC failures, and keep “Match not found” only for a real not-found response.
   - Preserve the existing PII-free result rendering.

5. **Re-verify the route wiring**
   - Confirm `/admin/service-matches` renders the request table.
   - Confirm each Open button targets `/admin/service-matches/$matchToken`.
   - Confirm the admin detail “Open visitor view” button targets `/agents/match/$matchToken`.
   - Confirm both known request tokens return a real detail page or a truthful “no qualifying MSPs yet” state, not a false “not found.”

6. **Post-fix data note**
   - If the page loads but shows zero matched MSPs, the remaining blocker is provider directory setup: MSP rows need `is_directory_public = true`, service location fields, specialties, and slugs. I will not silently change provider directory visibility or specialties because that affects marketplace exposure.