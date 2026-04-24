

## Expand the property-intelligence schema: permissive extraction + prose mining

### Goal

Lift the URL/PDF extraction ceiling so the Ask AI engine has a bigger, richer set of structured facts to draw from — without inventing data. Two complementary changes:

1. **Permissive Mode (LLM, first pass)**: tell the structuring LLM to emit *any* extractable fact it finds, attaching a confidence score. The server filters on confidence; high-confidence facts merge into `fields`, lower-confidence facts go into a new `candidate_fields` bucket the client can show or ignore.
2. **Prose-Miner (regex/heuristic, second pass)**: after the LLM, run a deterministic pass over the chunks to rescue canonical facts the LLM missed (e.g., "1957 rooms", "$15M renovation", "built in 1985", "47 stories"). Pure pattern matching, no extra cost.

Both passes feed into the existing `fields` blob, so the existing `buildCanonicalQAs` schema-aware generator (already shipped in Phase A) automatically produces phrasings for every new field.

---

### Architecture — where each change lives

```text
Upload (URL or PDF)
        │
        ▼
  htmlToText / pdfjs-heuristic
        │
        ▼
  ┌──────────────────────────┐
  │ Pass 1: LLM (permissive) │  ← extract-url-content + induce-schema (MSP)
  │   gpt-4o-mini            │     and groq-cleaner (PDF runtime)
  │   returns { fields:{},   │
  │     candidates:[{key,    │
  │       value,confidence}] │
  └─────────┬────────────────┘
            │
            ▼
  ┌──────────────────────────┐
  │ Pass 2: Prose-Miner      │  ← NEW shared module
  │   regex over chunks      │     supabase/functions/_shared/prose-miner.ts
  │   fills gaps in `fields` │
  └─────────┬────────────────┘
            │
            ▼
   merged `fields` + `candidate_fields`
            │
            ▼
   property_extractions row
            │
            ▼
   buildCanonicalQAs (already covers any new field name)
            │
            ▼
   Ask AI runtime (Tier 1 cosine + Tier 3 chunks)
```

---

### Change set

#### 1. New shared module: `supabase/functions/_shared/prose-miner.ts`

Pure deterministic pass-2 enricher. Exports `mineFromChunks(chunks, existingFields)` and returns a `Record<string,unknown>` of newly discovered facts (never overwrites a field already present in `existingFields`). Patterns:

| Field | Pattern (simplified) |
|---|---|
| `number_of_rooms` | `(\d{1,5})\s+(guest\s+)?rooms\b` |
| `number_of_suites` | `(\d{1,4})\s+suites\b` |
| `number_of_restaurants` | `(\d{1,3})\s+(on-?site\s+)?restaurants\b` |
| `stories` | `(\d{1,3})[-\s]?(story|stories|floors?|levels?)\b` |
| `year_built` | `built\s+in\s+(19|20)\d{2}` / `constructed\s+in\s+(19|20)\d{2}` |
| `year_renovated` | `renovated\s+(in\s+)?(19|20)\d{2}` |
| `renovation_cost` | `\$\s*[\d.]+\s*(million|m|billion|b)?\s+renovation` |
| `square_feet` | `([\d,]{3,9})\s*(sq\.?\s*ft|square\s+feet)\b` |
| `meeting_space_sqft` | `([\d,]{3,9})\s*(sq\.?\s*ft).{0,40}meeting` |
| `ballroom_capacity` | `ballroom.{0,40}(\d{2,5})\s*(people|guests)` |
| `floors` | `(\d{1,3})\s+floors?\b` |
| `bedrooms` / `bathrooms` | existing residential patterns |
| `parking_spaces` | `(\d{1,5})\s+parking\s+spaces` |
| `architect` | `designed\s+by\s+([A-Z][\w\s&.]{2,40})` (capture-stop on punctuation) |
| `developer` | `developed\s+by\s+([A-Z][\w\s&.]{2,40})` |

Each match also records a `_provenance: { field: chunkId, snippet: "...50 chars..." }` entry written into a new `field_provenance` JSONB column (see DB change below) so the Ask AI synthesizer can cite the source. Provenance writing is best-effort — if the column write fails (older row, RLS), the field still lands in `fields`.

Idempotency: never overwrite a value already in `existingFields`. First pattern wins per field across chunks (chunks are walked in index order). Number cleanup strips commas, normalizes "M"/"million" → 1_000_000.

#### 2. Permissive-mode prompts

**`supabase/functions/extract-url-content/index.ts` (SYSTEM_PROMPT, lines 40–63)** — replace with a two-bucket schema:

```text
Return a JSON object with TWO top-level keys:
  "fields": <high-confidence facts, exactly as today — only emit if you are
            ≥ 90% certain the text states this fact verbatim>
  "candidates": [
    { "key": "<lowercase_snake_case>", "value": <scalar>, "confidence": 0.0-1.0,
      "evidence": "<≤120 char quote from source>" },
    ...
  ]

Use `candidates` for any extractable fact that does not warrant the high-
confidence `fields` bucket: amenities, awards, design notes, neighborhood
descriptors, brand affiliations, accessibility features, sustainability
ratings, occupancy stats, etc. Aim for 5–25 candidates per page when content
permits. Do not invent — every entry must be supported by the `evidence` quote.
```

Server-side filter:
- `confidence ≥ 0.85` AND key not in existing `fields` → promote to `fields`.
- `0.55 ≤ confidence < 0.85` → keep in `candidate_fields` (new column, see DB change).
- `< 0.55` → drop.

**`supabase/functions/_shared/groq-cleaner.ts` (`buildSystemPrompt`)** — same two-bucket structure for the PDF runtime cleaner. Already has schema-aware logic; we just add the candidates bucket and parse it.

**`supabase/functions/induce-schema/index.ts` (SYSTEM_PROMPT, lines 40–69)** — append: *"Beyond the standard keys above, you SHOULD include any other extractable concepts the document covers — add custom snake_case keys for them in `properties` so the runtime extractor knows to look for them too."* Keeps current behavior, but invites broader schemas.

#### 3. Edge-function wiring

**`extract-url-content/index.ts`**:
- Update `structureFields` to parse the new `{ fields, candidates }` shape (back-compat: if `candidates` is missing, treat the whole object as `fields`).
- After `structureFields` returns, run `mineFromChunks(chunks, fields)` and merge results into `fields` (gap-fill only).
- Persist `candidate_fields` and `field_provenance` to the new columns.

**`extract-property-doc/index.ts`** (line 232 area):
- After Groq cleaner merges, run `mineFromChunks(chunks, fields)` against the post-clean chunks.
- Persist `candidate_fields` (from groq-cleaner) and `field_provenance`.

#### 4. DB migration

Add two nullable JSONB columns to `property_extractions`:

```sql
ALTER TABLE public.property_extractions
  ADD COLUMN candidate_fields jsonb,
  ADD COLUMN field_provenance jsonb;
```

No backfill needed — both are nullable and only consumed when present. RLS policies already cover all columns (table-level). No type regeneration required for server code; client TS regenerates on next sync.

#### 5. Client surface

**`src/lib/portal.functions.ts`** — when injecting `__PROPERTY_EXTRACTIONS__`, include the new columns so:
- The Ask AI synthesizer (Phase B `synthesize-answer`, when enabled) can cite `field_provenance` snippets in answers.
- Future MSP-facing UI can review `candidate_fields` and promote/reject them. (No UI in this change — data only.)

**`src/lib/rag/canonical-questions.ts`** — no changes needed. The existing schema-aware fallback already turns any new field name (e.g. `meeting_space_sqft`, `ballroom_capacity`) into 8–12 phrasings.

#### 6. Tests

New Deno test file `supabase/functions/_shared/prose-miner_test.ts` with golden cases:
- Marriott Wikipedia text → confirms `number_of_rooms=1957`, `stories=49`.
- Hotel Indigo magazine → confirms `number_of_rooms`, `architect` mined.
- Residential MLS sample → no false positives (commercial-style patterns must not fire).

---

### Ripple analysis

| Surface | Before | After | Risk |
|---|---|---|---|
| `extract-url-content` LLM call | One JSON blob = `fields` | `{ fields, candidates }`; back-compat parser | None (graceful fallback) |
| `extract-property-doc` Groq cleaner | One JSON blob = `fields` + `chunks` | Adds `candidates` to its parser | None (graceful fallback) |
| `induce-schema` (MSP template authoring) | Bias toward 18 canonical keys | Same + invitation for broader keys | Larger schemas → more `properties` entries → larger Ask-AI canonical QA set. Linear cost increase, no failure mode. |
| `property_extractions` row size | ~10–200 KB | +5–20 KB for candidates + provenance | Within JSONB norms; far under the 1 MB row soft limit |
| Ask AI runtime (Tier 1 cosine) | Embeds canonical QAs from `fields` only | Same — only promoted high-conf facts feed `fields` → QAs | None |
| Ask AI runtime (Tier 3 chunks) | Reads `chunks` | Unchanged | None |
| Phase B synthesizer (when enabled) | Sees `fields` + chunks | Optionally cites `field_provenance` snippets | Additive |
| MSP vault UI | Today: shows `fields` table | Unchanged in this PR; `candidate_fields` is server-side only | None |
| Embedding worker / hydrator | Re-embeds when chunks change | Unchanged — chunk text isn't modified by mining; only `fields`/`candidate_fields` grow | Existing "skip already-enriched" guard still holds |
| Existing Hotel Indigo / Marriott rows | Have only `fields` | A reindex picks up mined fields and candidates | Old rows keep working until reindexed |
| Costs | Same OpenAI/Groq call counts | One LLM call per document (unchanged); prose-miner is free | Net zero |

---

### Verification checklist

1. **Marriott Marquis Wikipedia** (already in DB): trigger reindex → `fields.number_of_rooms` = 1957 (already present), `fields.stories` = 49, `field_provenance.stories` exists, `candidate_fields` ≥ 5 entries (e.g. `architect`, `architectural_style`, `opened_year`).
2. **Hotel Indigo (sleeper magazine)**: trigger reindex → `fields` grows from 3 keys to 6–10 (mined: `number_of_rooms`, `architect`, `developer`, `year_built`); `candidate_fields` populated with brand/design references.
3. **Residential PDF (Heritage Oak)**: reindex → no false positives (no `number_of_suites`, no `meeting_space_sqft`); existing `bedrooms`, `bathrooms`, `square_feet` unchanged.
4. **Ask AI** on Marriott: "How many stories?" → returns "49" deterministically via Tier 1 (was previously a Tier 3 chunk dump).
5. **Ask AI** on Hotel Indigo: "Who designed it?" → returns mined `architect` value via Tier 1.
6. **Backwards compat**: a row that predates the migration (no `candidate_fields`/`field_provenance`) still loads and serves Ask AI without errors.
7. **Frozen property**: extraction still 423s — mining never runs.
8. **Edge function logs** show `[extract-*] mined=N candidates=M` so we can monitor lift per-property.

---

### What this plan deliberately does NOT do

- **No new LLM calls.** Permissive mode is one extra section in the existing prompt — same call, larger response.
- **No schema migration to `vault_templates`.** MSP-authored field schemas remain the source of truth; mining is *additive* gap-fill at extraction time.
- **No UI yet for reviewing/promoting candidates.** Server-side only in this change. A separate plan can add an MSP review surface once we see the volume of candidates real properties produce.
- **No change to chunking.** The same chunks feed Ask AI Tier 3.
- **No rollback risk.** Two new nullable columns; old rows continue to work; new code paths are wrapped in try/catch and degrade to today's behavior on any failure.

