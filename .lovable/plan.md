## Root cause

`supabase.functions.invoke("vectorize-floorplan", …)` fails with **"Failed to send a request to the Edge Function"** because the function returns **HTTP 404 NOT_FOUND** at the gateway. Confirmed by:

- `curl` against `/vectorize-floorplan` → `{"code":"NOT_FOUND","message":"Requested function was not found"}`
- `edge_function_logs` for `vectorize-floorplan` → no logs (it has never executed)

The source file (`supabase/functions/vectorize-floorplan/index.ts`, 450 lines) and its `[functions.vectorize-floorplan] verify_jwt = false` block in `supabase/config.toml` are present and correct. The previous storage-bucket migration ran, but the function itself was never pushed to the runtime — so the supabase-js client can't reach it and surfaces a generic transport error.

The earlier "Bucket not found" symptom masked this; now that the bucket+table exist, the upload step succeeds and exposes the missing-function failure on the next call.

## Fix (in priority order)

### 1. Deploy the edge function (primary fix — resolves the 404)

Push `vectorize-floorplan` to the runtime via `supabase--deploy_edge_functions`. After deploy, re-curl to confirm it answers (expect `401 unauthorized_no_jwt` for an unauthenticated test — that proves it's live), then retry an upload from the UI.

No code change is required for the function itself — its `serve()` handler, OPTIONS preflight, CORS headers, JWT verification, ownership check, imagescript decode/trace pipeline, SVG sanitizer, and rate limiter are already complete and consistent with the client (`InteractiveFloorMap.tsx`) contract `{ storage_path } → { ok, svg, viewBox, width, height, paths }`.

### 2. Verify the full call path after deploy

Trace end-to-end so nothing else regresses:

- Client `InteractiveFloorMap.tsx` → uploads to `temporary-floorplans/{userId}/…` (bucket exists ✓)
- Inserts `ephemeral_assets` row with `purpose: 'floorplan_vectorize'` (table+RLS exist ✓)
- Calls `supabase.functions.invoke("vectorize-floorplan", { body: { storage_path } })` (function will be deployed ✓)
- Function: JWT check → ownership prefix check → `ephemeral_assets` lookup via service-role client → storage download → imagescript decode → marching-squares trace → Douglas-Peucker simplify → sanitized SVG response
- Client writes `FloorMapData` (svg, viewBox, dims, ephemeralAssetId, storagePath) into the draft via `onChange`

I'll re-curl with a real session JWT after deploy to confirm a 200 with `ok:true` on a small test image, and check `edge_function_logs` for any `stage:` failures.

### 3. Add a defensive timeout fallback (low risk, recommended)

The supabase-js `functions.invoke` wrapper enforces a fetch timeout (~60 s). Large or noisy floor plans (close to the 2048-px clamp) can approach that on cold start because imagescript decoding is single-threaded WASM. To prevent the same generic "Failed to send" message from re-appearing on slow uploads:

- Wrap the `invoke` call with an `AbortController` set to ~55 s and a friendlier toast (`"Vectorization took too long — try a smaller or cleaner scan."`) instead of the generic transport error.
- Keep the existing orphan cleanup (`ephemeral_assets` row + storage object) on every failure branch — already implemented, just extended to the timeout branch.

This is the only client-side change. It is purely additive, scoped to the error path, and does not touch the success contract.

### 4. Out of scope (explicitly NOT doing now)

- The Stack-Overflow-style **async background pattern** (`EdgeRuntime.waitUntil` + DB polling) is **not needed** for the current pipeline — typical residential floor plans vectorize in 3–10 s well under the 60 s ceiling, and the current synchronous response shape is what the client and downstream HUD-export code consume. Switching to async would require a new `status` column on `ephemeral_assets`, a polling loop, and a second "fetch result" function — high blast radius for a problem the deploy alone resolves. We can revisit if step 3's timeout actually fires in practice.
- No schema changes, no shared-module changes, no client-contract changes.

## Verification checklist

1. `deploy_edge_functions(["vectorize-floorplan"])` succeeds.
2. `curl POST /vectorize-floorplan` (no auth) → `401 unauthorized_no_jwt` (proves it's live).
3. `edge_function_logs("vectorize-floorplan")` shows the test invocation.
4. From the UI, upload a small PNG floor plan → toast `"Floor map vectorized."` and SVG renders in the draft.
5. Confirm `ephemeral_assets` row persists and the storage object remains (purge is the cron's job).
