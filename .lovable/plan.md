

## Why "Ask AI" can't answer anything — audit + fix

### What I confirmed by inspecting the live state

| Evidence | Conclusion |
|---|---|
| `property_extractions` table is **empty** (0 rows) | Neither URL nor PDF extraction has **ever** persisted a row, despite multiple `vault_assets` being registered |
| 4 URL assets exist (Sleeper Magazine, 2× Wikipedia, 1 PDF), all with `embedding_status = NULL` | Step 8 of `extract-url-content` (the `embedding_status='pending'` flip) is never reached → the function is failing **before persistence** |
| Generated `1535_Broadway…html` does **not** contain a `__PROPERTY_EXTRACTIONS__` script tag | At HTML build time `loadExtractionsByProperty` returned `{}` for both property tabs — confirming the empty table |
| The runtime answers "There are 2 properties in this tour" | That string is from `property-qa-builder.ts` auto-generated curated `qaDatabase` — i.e. tier 2 fallback because tier 3 (docs) has zero data |

So the failure is **server-side, in `extract-url-content` (and likely also `extract-property-doc`)**, and the UI never surfaces the failure clearly because the asset insert succeeds *before* extraction is invoked.

### Root causes (multiple, compounding)

1. **`vault_templates.extractor` CHECK / domain rejects `'web_url'`.** The function inserts an auto-template with `extractor: 'web_url'`, but every existing row in the table uses `'pdfjs_heuristic'` (the column default). If the column has a check constraint or enum-like restriction inherited from earlier migrations, the insert silently fails inside `ensureUrlTemplate`, returning `null`, which short-circuits with `template_resolve_failed` (500). The browser surfaces it as a generic toast that's easy to miss.

2. **The dialog pre-selects a curated `templateId` for URL submissions too.** `openDialog` sets `templateId = templates[0].id` whenever any curated template exists. URL submissions then send that template_id to `extract-url-content`, which validates it against `provider_id` and **uses it** — but the upsert's `onConflict: vault_asset_id,template_id` is fine, so this isn't the failing leg. Still, semantically wrong: a URL of a magazine article gets stored under "Auto: Heritage Oak" because that was templates[0]. Fields end up under the wrong template, future URLs to the same domain don't dedupe under their own template, and the UI shows confusing labels.

3. **Auth header propagation.** The client calls `supabase.functions.invoke("extract-url-content", { body })`. Supabase JS auto-attaches the user JWT in the `Authorization` header — but the `Authorization` header is read inside the function for the user-scoped client (`global: { headers: { Authorization: authHeader } }`). That part is correct. **However** the function then checks `asset.category_type !== "property_doc"` — and the row's `category_type` is correctly `"property_doc"`. Verified, not the cause.

4. **No error visibility.** When the edge function returns 4xx/5xx, `supabase-js` returns an error whose body is NOT decoded by default (it returns a `FunctionsHttpError` with status only). The toast shows `"URL extraction failed: Edge Function returned a non-2xx status code"` — completely uninformative. We have no way to know whether it was the SSRF guard, the LLM call, or the insert that failed.

5. **No `__PROPERTY_EXTRACTIONS__` regeneration trigger after upload.** Even if extraction succeeded, the user must **re-generate the HTML** from the Builder for the new data to appear in the standalone tour. There's no UI message telling the agent this. They naturally assume "I uploaded → tour knows it."

6. **UI status is misleading.** The row says "No documents attached yet. Upload a datasheet to enable Ask." but `extractions.length` only reflects rows in `property_extractions` — not rows in `vault_assets`. So a successfully-registered URL whose extraction failed leaves the UI in the **exact same state as if nothing happened**. There's no "1 URL pending / failed" badge, no retry button, no error detail.

7. **`extract-url-content` only fetches static HTML.** The Sleeper Magazine page renders most copy server-side, so this would actually work — but Zillow / Redfin / Realtor.com are SPA-heavy and will yield thin text. We need to log this clearly and surface it as a UI warning.

### The fix — comprehensive, per-failure

#### A. `extract-url-content` — make every failure visible and recoverable

- **Always return JSON** (never throw `new Response` with raw status). Every failure path returns:
  ```json
  { "ok": false, "stage": "fetch|llm|persist|template", "detail": "...", "diagnostics": { "html_length": N, "text_length": N, "domain": "..." } }
  ```
- **Use `extractor: 'pdfjs_heuristic'`** (the existing default — known-good column value) for the auto-created URL template instead of `'web_url'`. The `extractor` value on the template is metadata; the actual extraction logic for URL goes in `property_extractions.extractor` which is a free-text column. This eliminates root cause #1 without a migration.
- **Set `property_extractions.extractor = 'web_url'`** unchanged — that column has no constraint and is already free-text.
- **Wrap the OpenAI call** with `extractJsonFromResponse` + `detectTruncation` (per the lovable-stack-overflow pattern) so a malformed LLM response degrades to "fields={}, chunks-only" instead of throwing.
- **Bump `max_tokens` to 4000** for `gpt-4o-mini` so a long listing page doesn't get truncated mid-JSON.
- **Log `text_length`, `chunk_count`, `field_keys.length`** so server logs make the failure point obvious.

#### B. `extract-property-doc` — same hardening

The PDF path is also failing (Heritage Oak has zero rows). Mirror the same JSON-error contract and the same `extractJsonFromResponse` + truncation guard around its LLM call. Likely root cause is the same template-extractor field rejection or LLM JSON parse blow-up.

#### C. Client — surface every failure

- **`invokeUrlExtraction` / `invokeExtraction`** decode the error body via `error.context.json()` (Supabase JS exposes the raw `Response` on `error.context`) and rethrow with `stage` + `detail`. The toast becomes `"URL extraction failed at LLM step: max_tokens"` instead of an opaque non-2xx message.
- **`PropertyIntelligenceSection`** stops pre-filling `templateId = templates[0].id` for URL submissions. URL mode always sends `template_id: null` so the function creates / reuses its own per-host auto template. File mode keeps the curated picker.

#### D. UI status — make pending / failed states explicit

- Add a per-asset status badge to `ModelRow`: it now lists *vault_assets* (URLs + files), not just successful extractions. Each row shows: 
  - `Indexed` (green) — has an extraction with chunks > 0
  - `Pending` (amber, animated) — asset row exists, no extraction yet (in-flight)
  - `Failed` (red, with retry button + last error tooltip) — asset row exists, no extraction, last attempt errored
- Add a **"Re-index"** button on Failed rows that calls `extractFromUrl` again with the persisted last URL.
- Replace "No documents attached yet" with **the count of vault_assets** so the agent sees their URL is registered even before extraction completes.

#### E. Builder — trigger regeneration banner

After a successful extraction, show a sticky banner: *"Index updated — re-generate your presentation HTML for visitors to see the new answers."* with a one-click "Re-generate" button calling the existing `generatePresentation` server fn. This closes the loop the user clearly hit.

#### F. Diagnostic surfacing — short-term observability

Add a small expandable `<details>` on the row labelled "Why isn't this working?" that, when clicked, fetches the latest edge-function log line for that vault_asset_id from a new tiny `get-extraction-status` server fn. This is read-only and only reads the function's own logs — purely informational.

### What I will NOT do

- **No DB migration.** All fixes are within the Edge Functions and React UI. The empty `property_extractions` is a *symptom* — fixing the writers will populate it.
- **No JS-rendered URL fetching** (Zillow SPA). That is a separate, much larger Phase 2. We will log when text is suspiciously short (<200 chars) and surface the warning so the user knows to either upload the doc or paste a non-SPA URL.
- **No change to the Ask runtime** in `portal.functions.ts`. Tier 1/2/3 logic is correct — it just has nothing to search. Once `property_extractions` rows exist and the agent re-generates, answers flow.

### Files to touch

- **edit** `supabase/functions/extract-url-content/index.ts` — JSON-error contract, `extractor: 'pdfjs_heuristic'` for the template insert, robust JSON extraction with truncation detection, larger `max_tokens`, structured logs
- **edit** `supabase/functions/extract-property-doc/index.ts` — mirror the JSON-error contract + LLM hardening
- **edit** `src/lib/extraction/client.ts` — decode `error.context.json()` and rethrow with stage + detail
- **edit** `src/hooks/usePropertyExtractions.ts` — store last error per vault_asset_id, expose `extractionsByAsset` map
- **edit** `src/components/portal/PropertyIntelligenceSection.tsx` — drop pre-filled `templateId` in URL mode, render Indexed/Pending/Failed badges from a merged (assets ∪ extractions) view, add Re-index button
- **edit** `src/components/portal/HudBuilderSandbox.tsx` — sticky "Re-generate presentation" banner after a successful extraction event
- **add** `supabase/functions/get-extraction-status/index.ts` — read-only diagnostic helper for the "Why isn't this working?" affordance
- **edit** `supabase/config.toml` — register the new function

### Verification checklist

1. Submit `https://www.sleepermagazine.com/stories/projects/hotel-indigo-expands-new-york-portfolio/` for the Hotel Indigo property. The row immediately shows `Pending`. Within ~10s it flips to `Indexed: N fields · M chunks`. A row exists in `property_extractions` with `extractor='web_url'` and a non-empty `chunks` array.
2. Submit a deliberately broken URL (e.g. a 404). Row flips to `Failed` with a tooltip showing `stage: fetch, detail: http_404`. Re-index button works after replacing the URL.
3. Submit a Zillow URL that returns thin SPA HTML. Row flips to `Indexed` but a warning chip says "Low text content — consider uploading a PDF". Some chunks indexed.
4. Re-upload the existing Heritage Oak PDF. Row creates a `property_extractions` row this time (PDF path was also broken; this verifies the parallel hardening worked).
5. After extraction succeeds, the banner says "Re-generate your presentation HTML". Click it → download the new HTML → confirm `__PROPERTY_EXTRACTIONS__` is now in the file → open it → ask "Who designed this property?" → tier 3 doc-chunks search returns the Hotel Indigo designer.
6. Switch property tabs in the published HTML. Ask re-indexes for the new property's chunks. Cross-property questions don't bleed.
7. Server logs for `extract-url-content` show structured lines: `[extract-url-content] sleepermagazine.com text_len=18432 fields=12 chunks=27 ok` and on failure: `[extract-url-content] zillow.com stage=llm detail=truncated text_len=8410`.

