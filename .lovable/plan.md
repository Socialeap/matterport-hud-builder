

## Stop the perpetual "Indexing…" spinner — comprehensive fix

### What's actually happening

The "Indexing…" pill in `PropertyDocsPanel` (line 216-220) is bound to the `backfilling` flag in `usePropertyExtractions` (line 37). That flag is set `true` inside the `useEffect` at line 104, and only flipped back `false` in the `finally` block at line 125 — which means it is gated on a single promise: `ensureExtractionEmbeddings([propertyUuid])`.

That promise chains through three layers, **none of which has a timeout**:

```text
useEffect (hook)
   └─► ensureExtractionEmbeddings()           ← extraction-hydrator.ts
          ├─► worker.init()                    ← downloads ~23MB model, no timeout
          ├─► worker.embedBatch(N texts)       ← N sequential embeds, no timeout
          └─► supabase.update(row)             ← per-row, no timeout
```

Failure modes that produce "spins forever":

1. **Model download stalls.** The HuggingFace CDN fetch inside the worker has no abort — if the connection hangs mid-stream, `init()` never resolves or rejects.
2. **WebGPU init hangs on certain GPUs/drivers** before the WASM fallback is reached. The worker code already has a try/catch around the `webgpu` path, but the underlying `pipeline()` call itself is what occasionally never returns.
3. **Sequential embed loop.** A 169-chunk Wikipedia article is embedded one chunk at a time; on a cold WASM backend that's ~30–60s of legit work, indistinguishable from a hang.
4. **Worker error event fires** — the client handler rejects pending *embed* promises (line 165 of `embedding-worker-client.ts`), but a worker error during `init` only notifies init listeners; if no init was in-flight, the error is swallowed and the next caller awaits a promise that will never resolve because `extractor` is `null` and `initPromise` is also `null` (only set inside `ensureInitialized`).
5. **No row-level progress signal.** Even when things are working, the user sees no advancement, so a 90s legitimate run looks identical to a wedge.

### Fix — surgical, layered, no behavioral regressions

Three layers of defense, each independently safe:

#### Layer 1 — Hard timeouts in `EmbeddingWorkerClient`

`src/lib/rag/embedding-worker-client.ts`:

- **`init()`**: race the existing init promise against a 60s timeout. On timeout, reject with `"embedding model init timed out"` and notify init listeners with an `init:error`. Do **not** terminate the worker — a slow CDN may still complete on a later attempt; just let the caller decide.
- **`embedBatch()`**: race against a per-batch timeout of `Math.max(45_000, texts.length * 1500)` ms (≥45s, scaling 1.5s per chunk). On timeout, reject the pending promise with a structured error and **delete it from `pendingEmbeds`** so a late `embed:result` is silently dropped.
- **Worker `error` handler upgrade**: when `handleError` fires, also reject any in-flight init promise (currently only embed promises are rejected). Reset `ready=false` and clear `initPromise` reference so subsequent callers can retry cleanly.

These are pure additions — happy-path callers see identical behavior.

#### Layer 2 — Make `ensureExtractionEmbeddings` resilient + observable

`src/lib/rag/extraction-hydrator.ts`:

- Add an optional `onProgress?: (msg: string) => void` to the `opts` arg.
- Emit progress at four points: `"Loading embedding model…"` (before `worker.init()`), `"Indexing row X of Y…"` (per row), `"Persisting…"` (before the update), `"Done"` (final).
- Wrap each per-row block (embed + update) in its own try/catch (already half-present); on a row-level failure, **continue to the next row** and accumulate the error in a new `stats.errors: string[]` field.
- If `worker.init()` throws (timeout or otherwise), short-circuit the loop and return stats with `stats.errors` populated. Do not retry inside the helper — the caller decides.

#### Layer 3 — Hook + UI: bounded state, retry affordance

`src/hooks/usePropertyExtractions.ts`:

- Add `backfillStatus: "idle" | "running" | "ok" | "failed"` and `backfillMessage: string | null` alongside the existing `backfilling` boolean. Keep `backfilling` for backward compatibility (computed as `status === "running"`).
- In the `useEffect` at line 104:
  - Pass `onProgress` to `ensureExtractionEmbeddings` and write the latest message into `backfillMessage`.
  - On success with no errors, set status to `"ok"` and clear after 3s.
  - On any thrown error or non-empty `stats.errors`, set status to `"failed"` and store the first error in `backfillMessage`. **The `finally` block always sets `backfilling`/status appropriately — the spinner is guaranteed to clear.**
- Add a hard wall-clock guard: a `setTimeout(_, 180_000)` started when backfill begins; if it fires before the promise settles (shouldn't happen now that Layers 1–2 exist, but belt-and-suspenders), force `status="failed"`, `backfillMessage="Indexing timed out"`. Clear the timeout in the same `finally`.
- The `reindex()` callback already exists — expose it unchanged.

`src/components/portal/PropertyDocsPanel.tsx` (lines 216-220 + 222-240):

- Replace the bare `Indexing…` pill with a stateful pill driven by `backfillStatus`:
  - `running` → spinner + `backfillMessage` (e.g. "Indexing row 2 of 5…"), with a small **Cancel** affordance that simply hides the pill (does not abort the worker — see Note below).
  - `failed` → red dot + "Indexing failed" + tooltip with `backfillMessage` + a **Retry** button that calls the existing `reindex()`.
  - `ok` → green check + "Indexed" (auto-clears after 3s).
  - `idle` → render nothing.
- The existing standalone `RefreshCw` button (line 224-240) keeps working unchanged. It now has a sibling Retry path inside the pill for the failure case.

### Trigger trace — ripple analysis

| Trigger | Today | After fix | Risk |
|---|---|---|---|
| Open property in builder, fast network | `backfilling=true` → flips false in <5s | Same, plus brief "Indexed ✓" toast for 3s | None — additive UI |
| Open property, model download stalls | Spinner forever | After 60s: status="failed", Retry button shown | None — failure now visible |
| Open property, large doc (169 chunks) | Looks hung for ~60s | "Indexing row 50 of 169…" progress text | None — same work, just observable |
| Click existing Refresh button | Calls `reindex()`, sets `backfilling=true` | Identical (reindex() unchanged) | None |
| Click new Retry inside pill | n/a | Calls same `reindex()` | None — same code path |
| Worker crashes silently | Promise hangs forever | Worker `error` handler now rejects init promise too → status="failed" | None — strict improvement |
| LUS-frozen property | Backfill effect still runs (no gate today) | Same — backfill is a read-mostly op, RLS rejects writes for non-owners gracefully | None — already handled by hydrator's try/catch |
| Provider deletes extraction mid-backfill | Update may target a deleted row | Per-row try/catch swallows it, continues | None — already handled |
| Multiple properties opened quickly | `backfilledRef.current.has()` guard prevents re-run per uuid | Unchanged | None |
| Component unmounts mid-backfill | `cancelled=true` flag prevents state writes | Unchanged | None |

**Note on Cancel:** the current `EmbeddingWorkerClient` has no per-call abort signal, and adding one would require restructuring the worker message protocol. The pill's "dismiss" affordance therefore only hides the visual indicator (sets a local `dismissed` state); the underlying worker continues. This is acceptable — it never blocks the user and the work completes in the background, updating the row when done. If a future iteration wants true cancellation we can add `cancel` messages to the worker protocol.

### Files touched

- **edit** `src/lib/rag/embedding-worker-client.ts` — add timeouts to `init()` and `embedBatch()`; upgrade `handleError` to reject in-flight init.
- **edit** `src/lib/rag/extraction-hydrator.ts` — add `onProgress` callback, per-row try/catch with accumulation, return `stats.errors`.
- **edit** `src/hooks/usePropertyExtractions.ts` — add `backfillStatus` + `backfillMessage`; wire `onProgress`; add 180s wall-clock guard. Keep `backfilling` boolean for compat.
- **edit** `src/components/portal/PropertyDocsPanel.tsx` — replace pill with stateful `running | failed | ok | idle` pill; add Retry button on failure.

### What this plan deliberately does NOT do

- **No worker protocol changes** — no new message types, no abort/cancel wiring. Strictly client-side timeout races.
- **No model swap, no quantization change, no parallel embed** — those are quality/perf work, separate from this UX bug.
- **No DB / RLS / edge-function changes.** The hydrator's read+update are unchanged.
- **No removal of the existing standalone Refresh button** — that's the explicit MSP escape hatch and remains functional.
- **No change to `extract()` / `extractFromUrl()`** — they have their own `running` flag, not `backfilling`. They were never the source of perpetual spin.

### Verification checklist

1. Open a property with one small extraction (≤10 chunks). Pill shows "Indexing row 1 of 1…" then "Indexed ✓" and disappears within 5s.
2. Throttle network to "Slow 3G" in DevTools, hard-refresh the builder. After 60s, pill turns red with "Indexing failed — embedding model init timed out". Retry button is clickable; clicking it re-runs.
3. Open the Marriott Marquis property (169 chunks). Pill cycles through "Indexing row N of 169…" — no false "hang" appearance. Completes in <2 min on a normal connection.
4. Kill the embedding worker via DevTools (Application → Workers → terminate). The next backfill attempt fails fast with "Indexing failed", not a perpetual spinner.
5. Existing standalone Refresh button still works and shows the spinner state synchronously.
6. Backfill running, then user navigates away and back: `backfilledRef` skips the second run, pill stays idle.
7. Frozen property: backfill runs read-only, hydrator's RLS-rejected updates are caught per-row, pill ends in "ok" with `rows_enriched=0`.

