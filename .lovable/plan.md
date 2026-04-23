

## Fix the 401: stop relying on the platform JWT verifier

### Root cause (confirmed in logs + code)

Edge log: `POST | 401 | extract-url-content | execution_time_ms: 64` — three rapid 401s, all rejected at the **Supabase gateway** before our handler boots. The function's own startup line (`Listening on http://localhost:9999/`) appears, but no `[extract-url-content]` lines from the request handler ever fire. That's the signature of `verify_jwt = true` rejecting the request at the platform layer.

```text
Browser fetch (with valid user JWT)
        │
        ▼
Supabase gateway  ──[verify_jwt=true]──►  401  ❌ (ours never runs)
        │
        ▼  (only on success)
extract-url-content handler  ──[its own auth.getUser check]──►  …
```

Two compounding problems make this dead code:

1. **`extract-url-content`** has `verify_jwt = true` in `supabase/config.toml` (line 28).
2. **`extract-property-doc`** has **no config block at all** — so it inherits the platform default, which is also `verify_jwt = true`. That's why the PDF path has been silently failing all along, exactly matching the empty `property_extractions` table.

The function code already does its own auth check (`extract-url-content` lines 460–470 verify the JWT via `userClient.auth.getUser()` and return a proper structured `{ ok: false, stage: 'auth', detail: 'unauthorized_…' }` JSON envelope on failure). The gateway check is redundant *and* it strips our diagnostic envelope, leaving the client with an opaque `non-2xx status` from `supabase.functions.invoke`.

Why this only manifested now: every other internal function in the project (`create-checkout`, `payments-webhook`, `stripe-connect-*`, `handle-lead-capture`) has `verify_jwt = false` and authenticates internally. We followed a different pattern for the two extraction functions, and that pattern is what is failing.

### The fix

#### 1. `supabase/config.toml` — disable platform verify_jwt for both extraction functions

```toml
[functions.extract-property-doc]
verify_jwt = false

[functions.extract-url-content]
verify_jwt = false
```

This routes the request to our handler, which already enforces auth itself with the same JWT and returns the structured error envelope the client knows how to decode. Net security posture is unchanged: **the function still rejects unauthenticated callers** at lines 460–470 with a 401 JSON response. We only stop the gateway from short-circuiting before our diagnostics can run.

#### 2. Re-deploy both functions

After the config change, deploy `extract-property-doc` and `extract-url-content` so the new gateway setting takes effect. Without redeploy the platform-level `verify_jwt` does not flip.

#### 3. Belt-and-suspenders on the client (no behavioural change when things work)

`src/lib/extraction/client.ts` — keep using `supabase.functions.invoke` (which auto-attaches the user's JWT) but, if and only if the SDK happens to return a 401 (rare future regression), explicitly retry **once** with `fetch` + headers `Authorization: Bearer <session.access_token>` + `apikey: <publishable key>`. This matches the lovable-stack-overflow pattern and gives us a safety net if the SDK ever drops the header (e.g. during an in-flight token refresh):

- Wrap both `invokeExtraction` and `invokeUrlExtraction`.
- On `error.context?.status === 401`, fetch `supabase.auth.getSession()`, and POST manually to `${VITE_SUPABASE_URL}/functions/v1/<name>` with `Authorization` and `apikey` headers.
- If still 401, throw the existing `ExtractionError` with `stage: 'auth'`, `detail: 'no_session'`. The Re-index button in `PropertyIntelligenceSection` already surfaces that detail in its tooltip, so the agent will see "auth: no_session — please sign in again" instead of the current opaque error.

This single retry costs nothing on success and rescues the user from one specific edge case (mid-refresh token swap) without changing the happy path.

#### 4. No other code changes

- The handler-level auth check, SSRF guard, freeze enforcement, LLM step, chunking, persistence, and `embedding_status='pending'` flip are all already correct and untouched.
- The UI status badges, Re-index button, regen banner, and `failuresByAsset` plumbing already added in the prior pass remain as-is — they just start showing **green Indexed** badges instead of red Failed once the gateway stops blocking the request.
- Browser client (`src/integrations/supabase/client.ts`) is **not** edited (preconfigured file).

### Trigger trace — what changes downstream

| Trigger | Old path | New path | Risk |
|---|---|---|---|
| Builder Re-index click | invoke → gateway → 401 | invoke → gateway pass → handler auth check → handler runs | Zero — handler already has auth gate |
| New URL submission | invoke → gateway → 401 | same as above, runs to completion | Zero |
| New PDF upload | invoke → gateway → 401 (silently) | runs to completion for the first time | Positive — unblocks PDF flow that was also broken |
| Anonymous caller (e.g. spoofed request) | gateway 401 | handler 401 with structured JSON | Equivalent — still 401, just from our code |
| Frozen property | gateway 401 (never reaches freeze check!) | handler 423 with `freeze: lus_frozen` | Positive — the freeze check finally runs |
| LUS license invalid | gateway 401 | handler 403 | Positive — proper error visibility |
| Tour visitor (no session) calling these fns | gateway 401 | handler 401 | Equivalent |

Note the freeze-check row: with `verify_jwt = true`, **even frozen properties were returning a generic 401 instead of the proper 423 freeze error** — meaning the entire LUS gate was unreachable from the URL/PDF path. Disabling gateway JWT also restores that intended behavior.

### Files touched

- **edit** `supabase/config.toml` — add `[functions.extract-property-doc] verify_jwt = false`, change `extract-url-content` from `true` to `false`
- **edit** `src/lib/extraction/client.ts` — add a single 401-retry-with-explicit-headers fallback inside both `invokeExtraction` and `invokeUrlExtraction`
- **deploy** `extract-property-doc` and `extract-url-content` so the gateway picks up the new setting

### What this plan deliberately does NOT do

- **No DB migration**, no RLS change, no schema change.
- **No new edge function.** Both existing functions already do their own auth.
- **No change to `extract-property-doc`'s extraction code** beyond redeploy. Its handler already has the same auth-check pattern as `extract-url-content`.
- **No change to the UI badges, regen banner, or hook.** Those are already wired and start working the moment the gateway stops blocking.
- **No change to the client Supabase setup** (`client.ts` is preconfigured).

### Verification checklist

1. After deploy, in the Builder click **Re-index** on the Wikipedia Marriott Marquis URL → request returns 200 with `{ ok: true, chunks_indexed: N, fields: {...}, diagnostics: { llm_stage: "ok", text_length: > 5000 } }`. Edge logs show `[extract-url-content] en.wikipedia.org text_len=… fields=… chunks=… ok` and the gateway log shows `200`, not `401`.
2. `SELECT count(*) FROM property_extractions` returns ≥ 1.
3. The asset row in `PropertyIntelligenceSection` flips from **Failed** (red) to **Indexed** (green) with `N fields · M chunks`.
4. The blue regen banner appears in the Builder: *"Index updated — re-generate your presentation HTML…"*. Clicking **Re-generate now** downloads a new HTML containing a `__PROPERTY_EXTRACTIONS__` script tag.
5. Open the regenerated HTML, switch to the Marriott Marquis property tab, ask "How many guest rooms are in this hotel?" → the AI answers with the figure from the Wikipedia article (≈ 1,966 rooms) instead of "There are 2 properties in this tour".
6. Re-upload an existing PDF (e.g. Heritage Oak datasheet) → also creates a `property_extractions` row for the first time, confirming the parallel fix.
7. A frozen property's URL submission now returns a 423 with `freeze: lus_frozen` instead of a 401, and the toast reads "LUS freeze active for this property — unfreeze to continue".
8. Sign out, then attempt to call `extract-url-content` directly via curl with no `Authorization` → returns 401 with `{ ok: false, stage: 'auth', detail: 'unauthorized_no_jwt' }` — handler-level rejection is intact.

