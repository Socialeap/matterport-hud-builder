## Goals

1. Bring a typical exported `.html` from ~4 MB down to ~600 KB–1 MB without losing AI accuracy.
2. Guarantee the Ask AI input is **always typeable** once the panel opens, even if embedding/Orama init fails.

---

## Part 1 — File Size

### Root causes (measured on the uploaded export)

| Source | Bytes | Notes |
|---|---|---|
| `__PROPERTY_EXTRACTIONS__` | 4.13 MB | 92% of file |
| `__QA_DATABASE__` | 0.15 MB | |
| Runtime JS + CSS + DOM | 0.19 MB | fine |

Inside `__PROPERTY_EXTRACTIONS__`:
- **Two extraction rows for the same template** on the same property (re-train kept the old row). 863 KB + 3.47 MB.
- **491 canonical_qas total**, each with a 384-float embedding stored as JSON text (~7 KB per QA).
- The generator emits up to **10 question variants per field** (e.g., `What is the security?`, `What's the security?`, `Tell me about the security.`, `Security?`…) and gives **each variant its own copy of the same 384-float embedding**. ~70% of QA bytes is duplicate vectors of the same field.

### Fixes (in order of impact)

**A. Deduplicate extractions before injection (server-side)**
In `loadExtractionsByProperty` (`src/lib/portal.functions.ts`), when multiple rows share `(property_uuid, template_id)`, keep only the newest by `extracted_at`. Today we render all of them. This alone cuts ~50% on properties that have been re-trained.

**B. Pack embeddings as base64 Float32 instead of JSON arrays**
Add a tiny helper in the generator and a 6-line decoder in the runtime IIFE:
```js
// generator
function packEmb(v){ const b=new Uint8Array(new Float32Array(v).buffer);
  let s=""; for (let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); }
// runtime
function unpackEmb(s){ const bin=atob(s), u=new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
  return Array.from(new Float32Array(u.buffer)); }
```
Per-vector size drops from ~6.5 KB to ~2.05 KB (~3.2× smaller). All embedding consumers (`__askBuildCuratedDb`, `__dqaRebuildIndex`, query path) decode lazily on insert. Old exports keep working because we accept either shape.

**C. Collapse QA variant explosion to one embedding per `field`**
In `_collectCanonicalQAs` / `_collectCandidateQAs` (`src/lib/portal/property-brain.mjs`):
- Group QAs by `field`.
- Emit **one** record per QA with all question variants in a `questions: string[]` array (Orama can index them as a joined string), or emit lightweight variant rows that reference a shared `embedding_ref` ID. Either way only **one 384-vector per field**.
The Orama curated DB schema gains `embedding_ref:string` and we resolve to the shared vector at insert time.
This collapses ~500 variant copies down to ~50–80 unique field embeddings.

**D. Drop chunk-level embeddings from the export when curated QAs cover the field**
Chunks are only 3 per extraction here, so the win is small (<30 KB), but consistently: only keep `chunk.embedding` when the chunk has no covering canonical QA. Hybrid search still works because curated QAs feed the same vector lane.

**E. Skip dead candidate field bytes**
`candidate_fields: []` and `field_provenance: []` for some extractions — already skipped when empty; verify and short-circuit truthy checks.

**Expected combined effect:** 4.3 MB → ~700 KB on this fixture. Worst-case (ten re-trained properties) stays under ~3 MB instead of growing linearly.

### Optional (defer unless asked)
- **Quantize to int8** (one more 4× win). Higher engineering risk: requires per-vector scale/zero-point and a slightly different cosine path. Not needed if A–D land us at ~700 KB.
- **Compute embeddings entirely at runtime** (drop persisted vectors). Cuts file ~80% but adds ~3–6 s cold start while transformers.js processes ~80 strings. Worth A/B testing later but not this pass.

---

## Part 2 — Locked AI chat input

### Cause
In the generated runtime, `__dqaInit()` enables the input only after this chain:
```
import(orama) → import(transformers) → __dqaRebuildIndex() → __askBuildCuratedDb()
→ input.disabled = false
```
There is **no `try/catch/finally`** around those four awaits. Any thrown error (CDN miss, WebGPU edge case, vector-dim mismatch on insert, parse spike on the 4 MB JSON) leaves `disabled=true` forever with placeholder "Initializing AI Assistant…".

### Fix
Edit the IIFE in the generator (it lives in `src/lib/portal.functions.ts`, the script that emits `__dqaInit`). Two changes:

1. **Always enable input in a `finally` block.** Even when transformers fails, the BM25 fallback path is functional and the curated QA DB is plain-text searchable — the user must be able to type.
   ```js
   __docsQa.initPromise = (async function(){ /* loaders */ })()
     .catch(err => { console.warn("ask init partial:", err); });
   try {
     await __docsQa.initPromise;
     if (window.__ASK_HAS_DOCS__) { try { await __dqaRebuildIndex(current); } catch(e){ console.warn(e);} }
     try { await __askBuildCuratedDb(); } catch(e){ console.warn(e);}
   } finally {
     __docsQa.input.placeholder = "Ask a question about this property…";
     __docsQa.input.disabled = false;
     __docsQa.send.disabled = false;
   }
   ```

2. **Degrade gracefully in `handleAsk`** when neither index is ready: route the question through the curated `__QA_DATABASE__` via plain substring/keyword scoring and, if nothing matches, fall through to the existing inquiry-form path. No silent failure.

3. **Faster perceived readiness:** flip the placeholder to "Ask a question about this property…" and enable the input as soon as the curated DB is built (it's tiny — <150 KB), without waiting for transformers.js to finish downloading. Hybrid mode upgrades in place when the embedder later resolves.

### QA after the fix
- Open the export with WebGPU disabled in DevTools — input must enable within ~1 s.
- Block `cdn.jsdelivr.net` in DevTools network throttling — input must still enable and accept questions, falling back to BM25/curated.
- Re-export the Chaska fixture and confirm size <1 MB and chat works end-to-end.

---

## Files to change

- `src/lib/portal.functions.ts` — extraction dedupe in `loadExtractionsByProperty`; updates to the generated `__dqaInit` IIFE (try/finally, early-enable, packed-embedding decode); embedding packer helper used during HTML emit.
- `src/lib/portal/property-brain.mjs` — collapse QA variants to one shared embedding per field; emit `embedding_ref` instead of duplicate vectors.
- `src/lib/rag/canonical-questions.ts` — when generating QA variants, mark them with a shared `embedding_ref` so the generator can dedupe.
- (No DB migration, no edge function changes, no new dependencies.)

## Out of scope
- Changing the embedding model or dimension.
- Server-side RAG path / `synthesize-answer` edge function.
- Visual/UI redesign of the Ask panel.

## After merge — user action
Re-export an existing presentation (no re-train needed) to pick up the size fix and chat hardening. Re-train is only required if you also want stale duplicate extraction rows cleaned up at the DB level later.
