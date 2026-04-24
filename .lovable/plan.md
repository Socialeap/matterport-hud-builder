

## Fix the never-ending "Preparing..." spinner + redesign the indexing status UX

### Diagnosis — what's actually happening

Both the **Property Docs** spinner (in `PropertyModelsSection > PropertyDocsPanel`) and **Property Intelligence (Ask AI)** (in `PropertyIntelligenceSection`) call the **same hook** — `usePropertyExtractions(propertyUuid)`. But each instance has **its own state**: separate `backfillStatus`, separate "already-backfilled" guard ref, separate worker.

When you import/resume a presentation, here's the actual bug chain:

1. Both panels mount for the same property at once.
2. Both call `ensureExtractionEmbeddings([propertyUuid])` simultaneously.
3. Both spawn a separate `EmbeddingWorkerClient` → 2 worker threads downloading the 23 MB Xenova model in parallel, fighting for cache slots.
4. One worker often wins, the other times out at the 60-second `INIT_TIMEOUT_MS` ceiling — but in some race conditions the `init:ready` message arrives at a worker whose listener has been GC'd, so the promise neither resolves nor rejects until the **3-minute wall-clock** fires.
5. Meanwhile, when extractions are **already enriched**, `ensureExtractionEmbeddings` short-circuits *before spawning the worker* — that's the panel that flips to "Indexed" instantly. That's why the "Property Intelligence" section shows complete while "Property Docs" is still spinning: the two hook instances are racing on different workers and getting different outcomes.
6. The duplicate refresh button (lines 238–276 of `PropertyDocsPanel.tsx` are literally pasted twice) is unrelated cosmetic bloat but signals the file needs cleanup.

Secondary UX issues:
- "Preparing…" stays visible even after the row is clearly indexed (the message lags the actual state).
- No clear single source-of-truth for "is this property's Ask AI ready?"
- The user has no idea what "indexing" even means, why it's running, or whether it's safe to proceed.
- Two parallel UIs render the same underlying status differently → guaranteed confusion.

---

### Three approaches considered

| # | Approach | UX win | Complexity | Risk |
|---|---|---|---|---|
| **A** | **Singleton worker + shared status** — one `EmbeddingWorkerClient` per page, one indexing context shared between both panels via React context. Status is computed from extraction row state, not local hook state. | Highest — eliminates the race entirely, single visual source of truth | Medium — new context provider, refactor hook into a coordinator | Low — pure consolidation of existing logic |
| **B** | Quick fix only — dedupe duplicate refresh button, add a cross-instance `Map<propertyUuid, Promise>` guard inside `ensureExtractionEmbeddings` so concurrent callers share the same in-flight job. Leave separate hook state. | Medium — fixes the spinner-hang, but the two panels still show divergent status text | Low | Low |
| **C** | Server-side indexing flag — add `indexed_at` column to `property_extractions`, drop client-side worker entirely, do embeddings in the edge function. | Highest long-term — no model downloads, no worker management, instant status check | High — major architectural shift, edge function cost increase, potential cold-start latency | High — touches the entire RAG pipeline |

**Recommendation: Approach A.** Highest UX leverage with contained scope. Approach C is the right end-state but should be its own separate plan after we validate the current pipeline's reliability. Approach B leaves the dual-status confusion, which is the core complaint.

---

### Plan — Approach A

#### 1. New `IndexingProvider` context (`src/lib/rag/indexing-context.tsx` — NEW)

A page-scoped React provider that owns:
- A single shared `EmbeddingWorkerClient` (lazy-spawned on first request, terminated on unmount).
- A `Map<propertyUuid, IndexingStatus>` where status = `"idle" | "indexing" | "ready" | "failed"` plus a human message.
- A `Map<propertyUuid, Promise<void>>` of in-flight jobs so concurrent `request(uuid)` calls dedupe to the same promise.
- A `request(uuid)` method that any component can call; returns the existing promise if one is in flight.
- A `subscribe(uuid, listener)` method for components to react to status transitions.

Wraps the builder route once (`/p/$slug/builder`). Replaces the per-hook worker plumbing.

#### 2. Refactor `usePropertyExtractions` (`src/hooks/usePropertyExtractions.ts`)

- Remove the local `backfilledRef`, `okClearTimerRef`, internal `EmbeddingWorkerClient` invocations from `ensureExtractionEmbeddings`.
- Replace the auto-backfill `useEffect` with: `const indexing = useIndexing(); useEffect(() => indexing.request(propertyUuid), [propertyUuid])`.
- Re-derive `backfillStatus`/`backfillMessage` from `indexing.statusFor(propertyUuid)` so both panel instances see identical state.
- Keep `extract()` / `extractFromUrl()` / `remove()` unchanged — they already drive the right side-effects.
- `reindex()` becomes `indexing.requestForce(propertyUuid)`.

#### 3. Single status component (`src/components/portal/IndexingStatusBadge.tsx` — NEW)

One component, three rendered states, used in both `PropertyDocsPanel` and `PropertyIntelligenceSection`:

```text
 ┌─ Indexing… (pulsing dot)        ← while running, with cancellable hint
 ├─ ✓ Ready for Ask AI             ← steady success badge
 └─ ⚠ Indexing failed [Retry]      ← with retry button + error tooltip
```

Reads `indexing.statusFor(uuid)` directly. Identical visual on both surfaces eliminates the "two different statuses" confusion immediately.

#### 4. Cleanup `PropertyDocsPanel.tsx`

- Delete the duplicated refresh button block (lines 258–276).
- Replace the inline `BackfillPill` with `<IndexingStatusBadge propertyUuid={...} />`.
- Section header copy: rename "Property Docs" → **"Property Docs (template-driven extraction)"** to clarify it's the schema-extracted view, not the Ask AI source.
- Keep upload/extraction controls intact.

#### 5. Cleanup `PropertyIntelligenceSection.tsx`

- Replace the per-asset "indexed/pending/failed" pills with the same `IndexingStatusBadge` plus a per-doc badge that ONLY reflects the row's own `chunks.length > 0`.
- Section info banner gets a one-line status header at the top: *"Ask AI is **ready** for 2 of 3 properties."* — derived from the shared context.

#### 6. Hard guarantee against stuck spinner

In the new `IndexingProvider`:
- Wrap every worker `init()`/`embedBatch()` call in `Promise.race([job, timeout(N)])`.
- On timeout: set status to `failed`, terminate and respawn the worker, log to console with a recognizable tag for the next debugging session.
- Add an explicit "force-resolve" hook that runs a final DB read of the affected row — if `chunks` are populated and `canonical_qas` is non-null, mark `ready` regardless of worker state (the work is actually done; the UI was just out of sync).

#### 7. Defensive UX touches

- Spinner text rotates: "Preparing model…" → "Embedding chunks…" → "Saving…" so a stuck phase is diagnosable from a screenshot.
- After 30s of "indexing", a tiny "Taking longer than usual?" link appears that opens a small panel: shows row state (chunks count, has embeddings, has canonical_qas) and a Retry button.
- The Re-index button is disabled (not just hidden) while another job is in flight, with a tooltip explaining why.

---

### Files touched

| File | Change |
|---|---|
| `src/lib/rag/indexing-context.tsx` | NEW — provider, shared worker, status map |
| `src/components/portal/IndexingStatusBadge.tsx` | NEW — unified badge component |
| `src/hooks/usePropertyExtractions.ts` | Strip worker management, consume context |
| `src/components/portal/PropertyDocsPanel.tsx` | Remove dup refresh button, swap pill for badge, rename label |
| `src/components/portal/PropertyIntelligenceSection.tsx` | Swap inline status for badge, add section-level summary |
| `src/routes/p.$slug.builder.tsx` | Wrap builder content in `<IndexingProvider>` |

No DB migration. No edge-function changes. No new dependencies.

---

### Verification checklist

1. Resume a presentation with both panels visible — single spinner appears in both surfaces, identical text, identical timing.
2. After enrichment completes — both surfaces flip to "Ready for Ask AI" within the same render cycle.
3. Resume a presentation whose extractions are already enriched — both surfaces show "Ready for Ask AI" within ~200ms, no model download, no spinner flash.
4. Force a worker timeout (devtools throttle to "Offline" mid-init) — status flips to "Indexing failed" within 60s with a Retry button; Retry succeeds when network is restored.
5. Click Re-index on Property Docs panel — Property Intelligence panel reflects the same "indexing" state simultaneously.
6. No duplicate buttons in `PropertyDocsPanel` header.
7. Network panel shows the Xenova model bundle downloaded **once** per session, not twice.
8. Console logs contain a `[indexing]` tag on every state transition for future debugging.

### What this plan deliberately does NOT do

- Does not move embedding to the server — that's the right call for later, separate plan.
- Does not change the Ask AI runtime behavior — chunks/canonical_qas/fields all stay where they are.
- Does not change extraction output, prose-mining, or LLM prompts (recently shipped, working as intended).
- Does not add any new database columns or migrations.

