

## URL-based property data ingestion for the Ask AI engine

### Context check (so we don't break what's there)

Two assertions in your brief don't match the code I read — calling them out so we land on the same page:

1. **"The Add Property Doc modal already captures a Source URL."** It doesn't. Neither `PropertyDocsPanel` nor `PropertyIntelligenceSection` has a URL field, and `PropertyModel` has no `sourceUrl` either. We need to **add** the field, not reuse one.
2. **"The extract-property-doc Edge Function currently fails if storage_path is missing."** Confirmed — line in the function returns `no_storage_path` (400) when `storage_path` is null. We will **not** loosen that function's contract; instead the URL flow goes through a new, dedicated function so the existing PDF/DOCX path stays bit-for-bit untouched.

The user-facing flow will remain "one upload dialog per property model," but the file picker becomes optional and a **Source URL** field is added next to it. Either branch (file or URL) produces the same shape of `property_extractions` row, so the Ask runtime, canonical-QA enrichment, embedding worker, and HTML generator need **zero** changes downstream.

### Architecture

```text
PropertyIntelligenceSection (UI)
        │
        ├── File path  ─────────────►  uploadVaultAsset → vault_assets (storage_path)
        │                                        │
        │                                        ▼
        │                            extract-property-doc  (UNCHANGED)
        │                                        │
        ▼                                        ▼
  Source URL path  ────►  vault_assets        property_extractions  ──► ensureExtractionEmbeddings
                          (storage_path = NULL,                              │
                           asset_url = the URL,                              ▼
                           mime_type = 'text/uri-list')                  Ask engine (UNCHANGED)
                                       │
                                       ▼
                          extract-url-content  (NEW edge fn)
```

Both branches converge on identical post-conditions: a `vault_assets` row + a `property_extractions` row with `fields`, `chunks`, `extractor`, `extractor_version`. The hydrator (`ensureExtractionEmbeddings`) then enriches it with chunk embeddings + `canonical_qas` exactly as today.

### Plan

#### 1. UI — add "Source URL" alongside the file picker (single dialog, two ways in)

**Edit:** `src/components/portal/PropertyIntelligenceSection.tsx`

Inside the existing per-model upload dialog, add a `Source URL` text input below the File row. Submission rules:

- **File only** → existing path (uploadVaultAsset → extract-property-doc). No change.
- **URL only** → new path (skip storage upload, register `vault_assets` with `storage_path: null`, `asset_url: <url>`, `mime_type: 'text/uri-list'`, then call the new `extract-url-content` edge fn).
- **Both** → file wins (file is the authoritative source; URL is stored on `asset_url` for reference but isn't used for extraction).
- **Neither** → submit disabled.

Validate URL client-side with `new URL(value)` and require `https:` or `http:` protocol; show inline error otherwise. Re-use the existing busy/toast/`onTemplatesChanged` machinery so accordion state, frozen badge, LUS gate, and per-model isolation behave identically.

The Label field becomes optional in URL mode and defaults to the URL hostname when blank, so the row still renders something meaningful.

#### 2. New edge function — `extract-url-content`

**Add:** `supabase/functions/extract-url-content/index.ts`
**Add:** entry in `supabase/config.toml` (no `verify_jwt = false` — this is an authenticated provider action, same as `extract-property-doc`).

Contract mirrors `extract-property-doc` so the client helper can be a thin parallel:

```ts
// request
{ vault_asset_id, property_uuid, saved_model_id?, url, template_id? }
// response
{ extraction_id, fields, chunks_indexed, embedding_status: "pending" }
```

Steps inside the handler (each step uses the same patterns the existing fn uses, including the freeze check, auth gate, and provider/client authorisation):

1. **Auth + freeze + asset ownership** — copy verbatim from `extract-property-doc` (same RLS shape, same 423 on freeze, same 403 on cross-tenant).
2. **SSRF guard for the URL** —
   - Parse with `new URL(url)`. Reject anything that isn't `http:` / `https:`.
   - Reject hostnames that resolve to or literally are: `localhost`, `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local / metadata), `::1`, `fc00::/7`, `fe80::/10`, and any host ending in `.internal`, `.local`, `.cluster.local`. Use a small allowlist regex on the literal hostname; do **not** depend on a DNS-resolution library in Deno.
   - Reject non-default ports outside 80/443.
   - Cap response size at **2 MB** (abort the read once the buffer exceeds that).
   - Send a real `User-Agent` header and a 10-second timeout via `AbortSignal.timeout(10_000)`.
3. **Fetch HTML** — `fetch(url, { redirect: 'follow' })`, follow ≤ 5 redirects (`fetch` defaults are fine), revalidate that each redirect hop still passes the SSRF allowlist by re-parsing `response.url` after the fetch and rejecting if it now points at a private host. Reject non-2xx.
4. **HTML → plain text** — strip `<script>`, `<style>`, `<noscript>`, HTML comments, then collapse tags to whitespace, decode the common entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;`). Truncate to 12,000 chars (matches `induce-schema`'s `MAX_TEXT_CHARS`). No third-party dep.
5. **AI structuring** — call OpenAI `gpt-4o-mini` with the **same canonical-key system prompt as `induce-schema`**, but ask it to extract **values** (not a schema). Body sent to the model:
   - System: a small variant of the induce-schema system prompt — same canonical key list, but instructs the model to output a JSON object whose **keys are drawn from the canonical list when applicable** and whose **values are the extracted facts** (numbers stay numbers, addresses stay strings).
   - User: the truncated page text.
   - `temperature: 0.1`, `max_tokens: 1500`, plain JSON object output, no markdown fences. Same fence-stripping + sanitiser as `induce-schema`.
   - If the LLM returns non-JSON or empty, fall back to `fields = {}` and proceed with chunks-only indexing rather than 500-ing — Ask still works on chunks.
6. **Chunking** — split the cleaned text on paragraph boundaries (double newlines), then on sentence boundaries inside any paragraph longer than 800 chars. Cap each chunk at ~800 chars. Emit `{ id: 'chunk:<n>', section: <heading-or-'web'>, content }` — the same `PropertyChunk` shape `pdfjs-heuristic` produces. Section headings are derived from the nearest preceding `<h1>`/`<h2>`/`<h3>` captured during the strip phase.
7. **Persist** — upsert `property_extractions` with `extractor: 'web_url'`, `extractor_version: '1'`, the structured `fields`, and the chunks. Use `onConflict: 'vault_asset_id,template_id'`. If the caller didn't pass a `template_id` (URL-only walk-in), insert/reuse a per-provider hidden template `Auto: <hostname>` with an empty schema (mirrors the auto-template pattern already in `PropertyIntelligenceSection`) so the unique constraint has a value.
8. **Flip embedding flag** — `vault_assets.embedding_status = 'pending'` (same as the file path), so `ensureExtractionEmbeddings` picks it up and writes chunk embeddings + `canonical_qas`.

#### 3. Client helper — `invokeUrlExtraction`

**Edit:** `src/lib/extraction/client.ts` — add a parallel `invokeUrlExtraction(req)` that calls `extract-url-content` with the same 423-aware error handling pattern as `invokeExtraction`.

**Edit:** `src/hooks/usePropertyExtractions.ts` — add an `extractFromUrl({ vault_asset_id, url, template_id?, saved_model_id? })` callback that internally awaits `invokeUrlExtraction` and then calls `ensureExtractionEmbeddings([propertyUuid])` exactly the way the existing `extract` callback does. The hook's existing one-shot lazy-backfill machinery picks up the row on next refresh — no changes there.

#### 4. Wiring the URL path in the section

**Edit:** `src/components/portal/PropertyIntelligenceSection.tsx` `handleUpload`:

```text
if (url && !file):
   1. validate URL client-side
   2. insert vault_assets {
        storage_path: null,
        asset_url: url,
        mime_type: 'text/uri-list',
        file_size_bytes: 0,
        label: label || hostname,
        is_active: true,
      }
   3. await extractFromUrl({ vault_asset_id, url, saved_model_id })
else: existing branch
```

The auto-template path (`ensureAutoTemplate`) is **only** taken in the file branch. The URL branch lets the new edge function create/reuse its own `Auto: <hostname>` template internally so we don't double-create.

#### 5. RLS / DB

No migration required. Confirmed by reading the table definitions:

- `vault_assets.storage_path` is already `Nullable: Yes`.
- `vault_assets.file_size_bytes` is already `Nullable: Yes`.
- `property_extractions` already accepts arbitrary `extractor` / `extractor_version` strings.
- `lus_freezes` enforcement is via the existing trigger `enforce_lus_freeze`, which the new function honours via its 423 short-circuit before any write.

#### 6. Make `extract-property-doc` resilient (small, scoped change)

**Edit:** `supabase/functions/extract-property-doc/index.ts` — when `storage_path` is null, return the existing `no_storage_path` error **but with a new field** `hint: "use extract-url-content for URL-based assets"`. No control-flow change. This is a one-line pure addition that gives forward-compat clarity without altering the supported behaviour.

### What this plan deliberately does NOT do

- **No changes** to `extract-property-doc`'s extraction path, the embedding worker, the canonical-QA generator, or any client-side Ask code in `portal.functions.ts`. The URL flow plugs into the existing `property_extractions` pipeline at the same join point as the PDF flow.
- **No new DB tables / no migration.** `vault_assets` already supports nullable `storage_path` / `file_size_bytes`.
- **No JS rendering** of the URL. `fetch` only retrieves server-rendered HTML — listing pages built as pure SPAs (Zillow's heavy client-side render) may yield thin text. This is acceptable as v1; a Firecrawl/playwright fallback can be added later if the user reports gaps. We log the cleaned-text length so the issue is observable.
- **No cron / no async job.** Extraction is synchronous within the edge function call, the same as the file path.

### Files touched

- **add** `supabase/functions/extract-url-content/index.ts`
- **edit** `supabase/config.toml` — register the function (default `verify_jwt = true`, which is the implicit default; no block strictly needed unless we want to be explicit)
- **edit** `supabase/functions/extract-property-doc/index.ts` — add `hint` field to the `no_storage_path` error response
- **edit** `src/lib/extraction/client.ts` — `invokeUrlExtraction`
- **edit** `src/hooks/usePropertyExtractions.ts` — `extractFromUrl` callback
- **edit** `src/components/portal/PropertyIntelligenceSection.tsx` — Source URL input, branched submit handler

### Verification checklist

1. Provider opens the Property Intelligence section, picks a property, opens the upload dialog → sees both **File** and **Source URL** inputs. Submit is disabled until at least one is provided.
2. Paste a public Zillow / Realtor.com / personal-listing URL with no file → submit succeeds. The model row shows "1 doc"; field count and chunk count match what came back from the function.
3. After a few seconds (worker pass), open the published HTML and ask the unified Ask button "What's the list price?" → returns the templated answer derived from `list_price` field.
4. URL pointing at `localhost`, `127.0.0.1`, `192.168.x.x`, `file://` is rejected client-side AND server-side with a clear toast.
5. URL of an HTTPS host that returns 404 / non-HTML returns a friendly toast, no row created.
6. Provider also uploads a regular PDF → the existing flow still runs, no new code path interferes.
7. LUS frozen property → both the file and URL paths are blocked at the freeze badge / 423.
8. LUS license inactive → entire section hides (existing behaviour preserved).
9. Re-submitting the same URL for the same property → `onConflict: vault_asset_id,template_id` upserts cleanly; no duplicate rows.
10. Switch to another property tab in the published HTML → Ask re-indexes, the new property's URL-derived chunks come up correctly.

