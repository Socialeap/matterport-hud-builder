

## Why Ask AI is still weak — and 6 ingenious ways to fix it

### Diagnosis (verified against your live data)

I queried `property_extractions` directly. The Marriott Marquis property has **169 chunks, 23 canonical QAs, and rich fields** including `number_of_rooms`, `number_of_suites`, `number_of_restaurants`, `stories`, `year_built`, `square_feet`. The data is there. The runtime is failing to use it.

Tracing the Ask pipeline in `src/lib/portal.functions.ts` (lines 1201–1539), three structural ceilings explain the bad answers:

1. **Tier 1 (canonical QA cosine) needs 0.72 similarity.** That's a high bar for MiniLM. A visitor typing "how many rooms" must phrase the question almost identically to a canonical phrasing or it falls through. Any field the MSP added that isn't in the curated list of 24 templates (`purchase_price`, `bedrooms`, etc.) only gets the generic "What is the X?" phrasings — so Marriott's `number_of_rooms`, `number_of_suites`, `number_of_restaurants` will rarely cross 0.72 even though the answer is sitting right there.

2. **Tier 3 returns one raw chunk, verbatim.** `limit: 1`, no re-ranking, no synthesis, no answer extraction. The visitor sees a Wikipedia paragraph dumped into the chat. If the top-scoring chunk happens to be about an unrelated topic that shares keywords, that's what gets shown.

3. **The runtime is by design "zero ML at view time".** No LLM call from the rendered HUD. That's the hard architectural ceiling — the Q&A quality cannot exceed what nearest-neighbor over 384-dim MiniLM vectors can do over 169 chunks of unprocessed text.

### Six optimizations, in priority order

#### Optimization 1 — Schema-aware question expansion (build-time, biggest win)

`buildCanonicalQAs` knows the field name AND the value. Today it generates 3 generic phrasings for unknown fields. Instead, generate 8–12 phrasings derived from the field name's tokens:

- `number_of_rooms` → "how many rooms", "room count", "number of rooms", "how many guest rooms", "room total", "what's the room count"
- `number_of_restaurants` → "how many restaurants", "are there restaurants", "what restaurants are on site", "dining options"

This is pure templating, no LLM, no schema changes. Tier 1 hit rate jumps because the threshold gets crossed by natural phrasings.

#### Optimization 2 — Top-K + LLM answer synthesis at view time (biggest quality lift)

Replace `limit: 1, return raw chunk` in Tier 3 with **top-5 chunks → tiny LLM call → grounded answer**.

- Add a `synthesize-answer` server function (Lovable AI Gateway, `google/gemini-3-flash-preview`, ~$0.0001/call).
- Send: question + 5 top chunks + 5 top canonical QAs + structured `fields` blob.
- Prompt: "Answer ONLY from the provided context. If not present, say 'I don't have that.' Cite the source label."
- Cache by `(property_uuid, normalized_question)` in `localStorage` so repeat visitors don't re-pay.

This violates the "zero ML at view time" principle — but the user is already paying that cost (the model download). A 200ms gateway call is dramatically cheaper than the perceived quality gap. We can keep Tier 1 deterministic for known fields and use the LLM only as Tier 3 fallback.

#### Optimization 3 — Inject the structured `fields` blob as a "facts table" the LLM can quote

Today the rendered HUD has the `fields` object in `window.__PROPERTY_EXTRACTIONS__` but it's only used for BM25 string matching (line 1308). Instead, format it as a markdown facts table and **always** include it in the LLM context window. For Marriott, that means the answer to "how many rooms" comes from the structured field (`1957`), not a fuzzy chunk match — even when phrased weirdly.

#### Optimization 4 — Hybrid re-ranking with field-name boosting

When a query contains tokens that match a `fields` key (e.g., "rooms" → `number_of_rooms`), boost any chunk or QA tagged with that field. Cheap to implement client-side, dramatically improves recall on schema-aligned queries.

#### Optimization 5 — Drop Tier 1 threshold to 0.55 + add multi-hit fusion

0.72 is too strict for MiniLM-q8. At 0.55 we get more hits; combine tier-1 top-3 with tier-3 top-3 in a Reciprocal Rank Fusion step (10 lines of code). The synthesizer in #2 then sees both lanes' best results.

#### Optimization 6 — Optional MSP-curated overrides

In the MSP vault, let the provider attach a `q_a_pairs` JSON to a template ("If asked about X, say Y"). These get embedded with the strongest weight and always surface first. A safety valve for known weak spots — no engineering needed per property.

### Recommended sequencing

| # | Effort | Impact | Risk |
|---|---|---|---|
| 1 | Small (1 file, ~80 lines) | High | None — additive |
| 2 | Medium (new server fn + client integration) | Highest | Cost + latency tradeoff |
| 3 | Small (prompt change in #2) | High | None |
| 4 | Small | Medium | None |
| 5 | Small | Medium | Could surface weaker hits — gate on threshold |
| 6 | Medium (UI + schema column) | Medium | Adds MSP workflow surface |

**My recommendation: ship #1 + #3 + #4 + #5 first as a no-cost, no-LLM baseline upgrade.** Ship #2 second, behind a per-provider toggle so cost-sensitive MSPs can opt out. Defer #6 until #1–#5 are validated in the wild.

### What this plan does NOT do

- **No re-extraction.** The data already in `property_extractions` is sufficient — we're improving how it's consumed, not how it's gathered.
- **No model swap.** MiniLM stays. The download UX is unchanged.
- **No schema changes for #1, #3, #4, #5.** Pure code.
- **No change to the existing `extract-url-content` or `extract-property-doc` paths.**

### Files touched (per phase)

**Phase A (no LLM, ship together):**
- `src/lib/rag/canonical-questions.ts` — expand phrasing generator (#1)
- `src/lib/portal.functions.ts` — lines 1370–1540: lower threshold, fuse tier-1 + tier-3 top-K, add field-boost re-ranker (#4, #5)

**Phase B (LLM synthesizer, behind toggle):**
- `supabase/functions/synthesize-answer/index.ts` — new edge function, Lovable AI Gateway, grounded prompt
- `src/lib/portal.functions.ts` — Tier 3 calls synthesizer with top-K + fields table; localStorage cache (#2, #3)
- `branding_settings` migration — add `enable_llm_ask` boolean (default false initially, flip to true after validation)

### Verification checklist

1. Marriott Marquis: "How many rooms?" → returns 1957 (the `number_of_rooms` field), not a Wikipedia paragraph. (#1 alone should fix this.)
2. Marriott Marquis: "Tell me about the restaurants" → after Phase B, returns synthesized answer citing the relevant chunks.
3. Heritage Oak (PDF): standard residential questions still work via existing canonical templates — no regression.
4. Network panel: Phase A introduces zero new requests. Phase B adds one ~300ms gateway call per uncached question.
5. Cost check: with Phase B enabled, a property with 1000 visitor questions/month costs ~$0.10 in gateway fees.

