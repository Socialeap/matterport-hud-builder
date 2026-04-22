

## Merge "Ask AI" and "Ask Docs" into a single unified chat button

### Why this is the right move

Both buttons open chat panels that answer the visitor's questions about the property. The split is an internal artefact of two backend pipelines, not a meaningful user distinction:

| Surface | Source data | Engine |
|---|---|---|
| **Ask AI** | `qaDatabase` — pre-computed canonical Q&A pairs the host wrote/curated | Orama hybrid search over MiniLM embeddings (CDN) |
| **Ask docs** | Per-property doc extractions (chunks + extracted fields + canonical QAs) | Orama hybrid/BM25 over the same MiniLM pipeline |

To the end visitor, both are "ask a question about this property." Showing two near-identical chat icons in the header is confusing, wastes header real estate, and forces the visitor to guess which pipeline knows the answer. They should not have to.

### Goal

One button labelled **Ask** in the HUD header that opens a single chat panel. When the visitor sends a question, the runtime queries **both knowledge sources in parallel**, picks the highest-confidence answer, and falls back to the other source if the first has no good hit. The visitor never sees the split.

### What changes

**File to edit:** `src/lib/portal.functions.ts` (only — the merge is fully contained in the generated HTML pipeline).

#### 1. Header — collapse two buttons into one

Replace the two adjacent buttons in the `#hud-right` strip (currently `${docsQaAssets.toggleBtn}${qaToggleBtn}`) with a single `#ask-toggle` button. Show it whenever **either** `hasQA` is true **or** `docsQaAssets.enabled` is true. Use the chat-bubble icon currently used by Ask AI; label it "Ask".

#### 2. Panels — collapse two panels into one `#ask-panel`

Build a single panel using the existing CSS patterns (reuse `#qa-*` styling). Single message list, single input row, single Send button. Keep the same z-index, same `top:72px;right:16px` glass card, same accent-coloured user bubbles and dark assistant bubbles. Drop both `#qa-panel` and `#docs-qa-panel` shells from the output.

#### 3. Engine — unified `__ask` handler that fans out and merges

Combine the two existing IIFEs into one initialiser keyed off the new `#ask-*` DOM ids. The unified handler:

1. Lazily loads Orama + transformers.js once (currently both pipelines load them separately — saves a redundant ~30 MB download path).
2. On open, builds **both** indexes that apply to the active property:
   - the global `qaDatabase` Orama DB (only if `hasQA`)
   - the per-property docs DB (only if that property has extractions/canonical QAs)
3. On send, runs the query against every available source in parallel:
   - Tier 1: canonical-QA cosine over docs canonical QAs (highest precision)
   - Tier 2: hybrid Orama search over the host-curated `qaDatabase`
   - Tier 3: hybrid/BM25 Orama search over the per-property doc chunks
4. Picks the result with the highest score; if no source crosses its existing threshold, returns the existing "I couldn't find that" message.
5. Source-link rendering reuses the existing per-tier behaviour: anchor scroll for `qaDatabase` hits, plain source label for doc hits.

The thresholds, embedding pipeline, WebGPU→WASM fallback, and per-property re-indexing on tab change all carry over unchanged — they were already shared by both surfaces, just duplicated.

#### 4. Cleanup

- Delete `qaToggleBtn`, `qaPanelHtml`, `qaModuleScript`, `docsQaAssets.toggleBtn`, `docsQaAssets.panelHtml`, and the standalone `__openDocsQa` window export from the output.
- Replace with a single `askAssets = { toggleBtn, panelHtml, css, moduleScript, enabled }` builder. The `enabled` flag is `hasQA || docsQaEnabled`.
- Keep `buildDocsQaAssets`'s data-shape helpers (`__dqaCollectCanonicalQAs`, `__dqaCollectChunkDocs`, etc.) — they move into the unified module unchanged.

### Why this is safe

- Pure consolidation in one generator file. No backend, schema, auth, or React UI changes.
- Both pipelines already use the **same** Orama version, **same** MiniLM model, **same** WebGPU/WASM fallback, **same** CDN URLs — there is no model conflict to reconcile.
- The merged engine only adds branching at query time (which sources to consult); the per-source ranking math is identical to today's.
- Per-property tab-change reset logic (currently in `load(i)`) keeps working because there is now a single `__ask` state object to clear instead of two.
- Backslash-escape rules for the embedded template literal (the regex bug we already fixed) carry over by reusing the same patterns — no new regex literals introduced.
- Matterport logo remains unobstructed: still one button in the header, no bottom toolbar reintroduced.

### Verification checklist

1. Re-generate and download a presentation HTML for a property that has **only** curated Q&A pairs (no doc extractions). Confirm the **Ask** button appears in the header and answers from `qaDatabase` with anchor links working.
2. Re-generate for a property that has **only** doc extractions (no curated Q&A). Confirm **Ask** appears, answers come from doc chunks, and the source label renders.
3. Re-generate for a property that has **both**. Ask a question that only the curated DB knows → curated answer wins. Ask a question that only the docs know → docs answer wins. Confirm only one button is in the header.
4. Re-generate for a property with **neither**. Confirm no Ask button is rendered at all.
5. Switch between properties via the tabs. Confirm the message list resets and the next question re-indexes for the new property.
6. Confirm DevTools shows transformers.js loaded **once**, not twice.
7. Confirm the Matterport logo in the bottom-right is still unobstructed.

