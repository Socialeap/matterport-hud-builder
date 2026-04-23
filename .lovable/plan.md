

## Remove the on-screen "Property Docs" overlay + clarify the data sparsity

### What's actually happening — two separate things

**1. The overlay you want gone is a debug/preview surface.** It lives entirely in the generated HTML, emitted by `buildPropertyDocsPanel()` in `src/lib/portal.functions.ts` (lines 446-481) and re-rendered on every tab change by `renderPropertyDocs(i)` (lines 1181-1212). It dumps the raw `fields` JSONB blob as `<dt>/<dd>` rows. It is **not** what powers the Ask AI chat — Ask AI reads the same `fields` (plus `chunks` and `canonical_qas`) directly from `window.__PROPERTY_EXTRACTIONS__`. Removing the overlay does not affect chat answers in any way.

**2. Why the overlay shows only 3 fields for the sleeper magazine page.** I queried the row directly:

| Source | Domain | Text → Fields | Chunks | Canonical QAs |
|---|---|---|---|---|
| Hotel Indigo (sleepermagazine.com) | magazine article | **3 fields** (`listing_date`, `property_type`, `property_address`) | 9 | 12 |
| Marriott Marquis (en.wikipedia.org) | structured wiki | 9 fields (`number_of_rooms`, `stories`, `year_built`, etc.) | 169 | 61 |

The `fields` blob is produced by the **`extract-url-content` edge function**, which sends the cleaned page text to GPT-4o-mini with the `SYSTEM_PROMPT` listing 18 canonical real-estate keys (lines 40-63). The LLM is instructed: *"Omit any field you cannot confidently extract."* The sleeper magazine article is editorial copy about Hotel Indigo's brand expansion — it mentions the address and that the property is a hotel, but it does **not** contain `square_feet`, `year_built`, `bedrooms`, `purchase_price`, `stories`, etc. That's why GPT only returned 3 keys. The chunks (9) and canonical QAs (12) were still produced — they're just not surfaced in the overlay.

This is a **data-source quality issue**, not a code defect. The same pipeline pulled 9 fields from Wikipedia because Wikipedia's NYC Marriott article contains structured infobox data. A magazine article will never yield a rich field table no matter what we do at the extractor — the facts simply aren't in the source text.

### Plan — surgical removal + a note for future MSP guidance

#### Single code change

**`src/lib/portal.functions.ts`**

1. **Replace `buildPropertyDocsPanel()` (lines 446-481) with a stub** that returns `""`. Keeps the function signature so nothing else breaks at type-check time, but emits no CSS, no DOM shell.
2. **Replace the runtime `renderPropertyDocs(i)` function body (lines 1181-1212) with an early-return no-op.** The single caller at line 1734 (`renderPropertyDocs(i);` inside the tab-switcher) keeps working — it just does nothing now. Leaving the call site untouched avoids any risk of breaking the surrounding tab-switch flow.
3. **Leave `loadExtractionsByProperty()`, `propertyDocsData`, and the `window.__PROPERTY_EXTRACTIONS__` injection unchanged.** Those feed the Ask AI chat (Tier 1 canonical-QA cosine, Tier 3 chunk hybrid search, and the synthesis bridge). They must stay.

That's it. One file, ~50 lines deleted/stubbed. No DB migration, no schema change, no edge-function change, no Ask AI behavioral change.

#### Ripple analysis

| Surface | Before | After | Risk |
|---|---|---|---|
| Bottom-left overlay on generated HTML | Shows 3 sparse fields | Gone entirely | Intended |
| Ask AI chat — Tier 1 canonical QAs | Reads from `__PROPERTY_EXTRACTIONS__[uuid][n].canonical_qas` | Unchanged | None |
| Ask AI chat — Tier 3 doc chunks | Reads from `__PROPERTY_EXTRACTIONS__[uuid][n].chunks` | Unchanged | None |
| Ask AI synthesis bridge | Reads chunks + fields, posts to `synthesize-answer` | Unchanged | None |
| Tab switcher (`switchProperty(i)`) | Calls `renderPropertyDocs(i)` then `updateHud(i)` | Calls a no-op then `updateHud(i)` | None |
| Property Docs panel inside the **builder** (`PropertyDocsPanel.tsx`) | MSP-facing extraction control surface | Unchanged — different file | None |
| Vault property doc list, templates, etc. | Unchanged | Unchanged | None |

#### What this plan deliberately does NOT do

- **Does not change extraction quality.** The 3-field result for the sleeper magazine page is a faithful reflection of what GPT-4o-mini could responsibly extract from that source — adding more keys would be hallucination. If you want richer field tables for editorial-style sources, that's a separate "improve URL extraction prompt + fall back to chunk-mining for canonical fields" workstream we can plan after this.
- **Does not delete the field/chunk/QA data.** All extractions stay in the database and continue to power Ask AI.
- **Does not touch the in-builder MSP-facing `PropertyDocsPanel.tsx`** — the provider still needs that to manage extractions.
- **Does not remove the `loadExtractionsByProperty` server-side fetch** — Ask AI depends on it.

### Verification checklist

1. Open the published HTML for the Hotel Indigo property — the bottom-left "Property Docs" overlay is gone. No flash on load, no leftover toggle button.
2. Switch between properties in a multi-property presentation — tab switcher still works (active tab updates, HUD updates).
3. Open Ask AI chat on the same property — "What is the property type?" still answers "Hotel"; "What's the address?" still returns the Wall Street address. (Both come from `fields`/`canonical_qas`, not the overlay.)
4. Open Ask AI chat on the Marriott Marquis property — "How many rooms?" still answers from the indexed field. No regression.
5. View page source — no `#property-docs` div, no `#pd-header`/`#pd-body`, no `.pd-extraction` CSS.
6. Builder side: open the MSP dashboard → property → the existing in-builder Property Docs control panel still renders, still allows upload/extract/reindex.

### Optional follow-up (not in this change)

If you want the URL extractor to surface more fields for editorial-style pages, the leverage point is in `supabase/functions/extract-url-content/index.ts` (`SYSTEM_PROMPT`, line 40). Two ideas worth a separate plan:
- Add a "permissive mode" that lets the LLM emit any fact it finds (with a `confidence` annotation), then filter on the client side.
- Run a second pass over the chunks to mine canonical fields the page mentions in prose (e.g., "1957 rooms", "$15 million renovation") even when no structured listing exists.

Both would benefit Ask AI and any future structured display, independent of whether we keep an overlay.

