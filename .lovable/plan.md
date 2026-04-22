

## Resume URL-extraction rollout — deploy + UI status surface + regen banner

### Why this is still failing in production

Server-side hardening (JSON error envelope, balanced-brace JSON parser, `pdfjs_heuristic` template extractor, structured logs) is **already in code** but `extract-url-content` has **never been deployed** — the edge-function logs query returns "No logs found", and `property_extractions` is still empty for all 4 registered URL/PDF assets. The vault_templates CHECK constraint (`pdfjs_heuristic` | `donut` only) is what was silently killing every prior URL attempt; the current code already accommodates that constraint correctly.

So the remaining work is: **deploy → make the UI honestly show pending/failed/indexed → tell the agent to re-generate → verify end-to-end**.

### The remaining fix — three small, additive pieces

#### 1. Deploy the hardened edge functions (no code change)

Call `supabase--deploy_edge_functions` for both `extract-url-content` and `extract-property-doc`. This is the trigger that finally lets the URL flow run. After deploy, immediately re-trigger the existing failed Sleeper Magazine asset by calling the function with that `vault_asset_id` to confirm a real extraction row lands in the DB.

#### 2. UI status badges in `PropertyIntelligenceSection.tsx` — surface the truth

Right now the row only counts successful `property_extractions`, so a registered-but-not-yet-extracted URL shows "No documents attached yet" — identical to the empty state. Fix by merging the per-property `vault_assets` view with the `extractions` array.

**Edit:** `src/components/portal/PropertyIntelligenceSection.tsx`

- Add a new hook usage: query `vault_assets` filtered by `category_type='property_doc'` joined logically against this property's saved_model. Since vault_assets aren't natively tied to a property_uuid, we use a deterministic per-row guard: track the `vault_asset_id` returned by `handleUpload` in component-local state (`recentAssets: Record<modelId, AssetMeta[]>`) and union with `extractions[].vault_asset_id`. This is an additive, in-memory union — **no DB schema change, no new query layer**.
- Per-asset status logic:
  - `Indexed` (green badge) — has an `extraction` row with `chunks.length > 0`
  - `Pending` (amber, animated `Loader2`) — asset registered, `running` from the hook is true OR no extraction row yet within the last 30s
  - `Failed` (red, with **Re-index** icon button + tooltip showing `failure.stage: failure.detail`) — `failuresByAsset[asset_id]` exists in the hook (already populated)
  - **Low content warning chip** (amber outline) when the function's response `diagnostics.low_content_warning === true` — surface "Thin page text — consider uploading a PDF instead" via a tiny `<span title>`
- Replace the "No documents attached yet" copy with `"{N} document{s} attached • {indexed} indexed"` once any asset exists.
- Add a **Re-index** button on Failed rows that calls `extractFromUrl({ vault_asset_id, url })` again with the persisted URL (we already have it from `recentAssets`). For pre-existing rows loaded from DB on mount we also fetch `asset_url` so the retry has the URL.

To avoid over-engineering: in this same edit pass, add a small `useEffect` that fetches the per-property `vault_assets` once on mount (filtered by `provider_id = user.id` and matching the `recentAssets` heuristic — actually simpler: filter only by `is_active && category_type='property_doc'` for this provider, then join client-side against `extractions.vault_asset_id` to identify orphans). This way a page reload still shows "Failed" rows that pre-existed before the deploy.

#### 3. Regeneration banner in `HudBuilderSandbox.tsx`

After any successful extraction, `usePropertyExtractions.extract*` already fires a success toast. Lift that success signal to the parent so we can show a one-time sticky banner.

**Edit:** `src/components/portal/HudBuilderSandbox.tsx`

- Add local state `const [extractionDirty, setExtractionDirty] = useState(false)`.
- Pass `onExtractionSuccess={() => setExtractionDirty(true)}` down through `<PropertyIntelligenceSection />`.
- Add an `onSuccess` optional callback to `PropertyIntelligenceSection` props and wire it inside `ModelRow.handleUpload` to fire **only** when `res` is non-null (i.e., extraction actually completed).
- Render a sticky banner above the accordion when `extractionDirty && downloading === false`:

  > "Index updated — re-generate your presentation HTML for visitors to ask the new questions." [Re-generate now] [Dismiss]

  The Re-generate button calls the existing `runDownload(savedModelId)` flow if `savedModelId` is set; otherwise it nudges the user to save a model first. Dismissing only hides the banner for this session.

This is the smallest possible nudge that closes the loop the user explicitly hit ("I uploaded but the tour doesn't know it").

### Mental trace of trigger ripple — what could go wrong

| Trigger | Old downstream | New downstream | Risk |
|---|---|---|---|
| File-only upload (existing path) | `extract` → toast → `refresh` | Adds: `setExtractionDirty(true)` only on success | Zero — purely additive parent state |
| URL-only upload | `extractFromUrl` → toast → `refresh` | Adds: failure chip via existing `failuresByAsset` map; success: setExtractionDirty | Zero — `failuresByAsset` already populated by the hook |
| Re-index button on a failed row | n/a (button is new) | `extractFromUrl` with stored URL → identical contract | Zero — same code path as initial submit |
| HTML re-generation | `runDownload(modelId)` | Same call, just with banner CTA | Zero — no change to the function |
| Pre-existing `vault_assets` with no extraction | hidden by UI | Show as "Failed (never indexed)" with retry | Zero — read-only join, no writes |
| `usePropertyExtractions` consumed elsewhere (`PropertyDocsPanel`) | uses same hook | We're not changing the hook's public API; we already added `failuresByAsset` last turn but it's optional and unused there | Zero — additive shape |

The hook's existing return signature (`extractions, loading, running, backfilling, refresh, extract, extractFromUrl, remove, reindex`) **already includes everything UI needs** except `failuresByAsset`. We need to expose it from the hook — that's a one-line addition to the `return {}` block.

### Files touched

- **deploy** `supabase/functions/extract-url-content` and `supabase/functions/extract-property-doc` (no code change — just push)
- **edit** `src/hooks/usePropertyExtractions.ts` — expose `failuresByAsset` in the return object (single line)
- **edit** `src/components/portal/PropertyIntelligenceSection.tsx` — fetch per-provider property_doc assets on mount, render Indexed/Pending/Failed badges, add Re-index button, pipe `onSuccess` callback up
- **edit** `src/components/portal/HudBuilderSandbox.tsx` — sticky regen banner driven by `extractionDirty` state, wire `onExtractionSuccess` prop to the section
- **verify** post-deploy by re-invoking the function once for the existing Sleeper Magazine asset, then querying `property_extractions` to confirm a row lands

### What this plan deliberately does NOT do

- **No DB migration.** The CHECK constraint is fine; the function already targets it correctly.
- **No new edge function** for diagnostics. The existing `diagnostics` payload returned in the success/failure JSON is enough — we surface it via the toast detail and the badge tooltip. Skipping the originally proposed `get-extraction-status` keeps the change surface minimal.
- **No change to the Ask runtime, embedding worker, or `portal.functions.ts`.** Those layers are correct; they were just being fed by an empty table.
- **No retroactive auto-extraction** of every orphan vault_asset. We surface the orphans in the UI with a Re-index button so the user opts in, avoiding surprise OpenAI spend on assets they no longer care about.

### Verification checklist (post-deploy)

1. Deploy returns ok for both functions → call `supabase--curl_edge_functions` against `/extract-url-content` with the existing Sleeper Magazine `vault_asset_id` and the user's JWT → response is `{ ok: true, chunks_indexed: N, fields: {...}, diagnostics: { llm_stage: "ok", text_length: > 1000 } }`.
2. `SELECT * FROM property_extractions` now returns at least one row with `extractor='web_url'` and a non-empty `chunks` array.
3. Reload the Builder → the Hotel Indigo property row shows the green **Indexed** badge with `N fields · M chunks` instead of "No documents attached yet".
4. The 3 other orphan vault_assets show as **Failed (never indexed)** with a **Re-index** button. Clicking it for the Wikipedia Marriott Marquis asset succeeds within ~10s.
5. Banner appears: "Index updated — re-generate your presentation HTML…". Click **Re-generate now** → new HTML downloads → opening it confirms a `__PROPERTY_EXTRACTIONS__` script tag is present.
6. In the new HTML, switch to the Hotel Indigo tab and ask "Who designed this property?" → tier-3 chunk search returns the answer from the Sleeper article.
7. Submit a deliberately broken URL (404) → row shows **Failed** with tooltip `fetch: http_404`. Re-index after fixing the URL succeeds.
8. LUS-frozen property still blocks both file and URL paths with a clear `freeze: lus_frozen` toast.

