## Update `synthesize-answer` to Gemini-first routing (no MSP_PROD_KEY)

### Goal

Refactor only `supabase/functions/synthesize-answer/index.ts` so the visitor-facing Ask AI uses **Gemini 1.5 Flash-8B as primary**, **Gemini 1.5 Flash as fallback**, and **Groq only when explicitly enabled**. The Gemini API key is read **only** from `GEMINI_PRIMARY_MODEL`. `MSP_PROD_KEY` is removed from the file entirely (code, comments, logs).

### Scope

**In scope (single file):**
- `supabase/functions/synthesize-answer/index.ts`

**Explicitly out of scope:**
- No DB migrations, no new env vars required, no rename of secrets.
- No changes to `src/lib/portal.functions.ts` (POST body `{ query, chunks }` stays identical).
- No changes to `supabase/config.toml` (function already registered with `verify_jwt = false`).
- No changes to local Ask runtime, Property Brain, or generated HTML.
- No cache, token, BYOK, or budget logic — left as TODO comments for PR-2.

### Secret + model resolution (code-level)

```ts
// Gemini API key — single source. Despite the name, this secret holds the
// API key value, not a model name.
const GEMINI_API_KEY = Deno.env.get("GEMINI_PRIMARY_MODEL");

// Model identifiers are hard-coded (not derived from secret names).
const GEMINI_PRIMARY_MODEL_NAME  = "gemini-1.5-flash-8b";
const GEMINI_FALLBACK_MODEL_NAME = "gemini-1.5-flash";
const GROQ_FALLBACK_MODEL_NAME   = "llama-3.3-70b-versatile";

// Groq is optional emergency fallback only.
const GROQ_ENABLED = Deno.env.get("ENABLE_GROQ_FALLBACK") === "true";
const GROQ_API_KEY = GROQ_ENABLED ? Deno.env.get("GROQ_API_KEY") : null;
```

`MSP_PROD_KEY` is not referenced anywhere — removed from imports, env reads, header comment, and warning logs.

### Refactor: Gemini helper takes a model parameter

Change signature from `streamGemini(query, context, apiKey, writer)` to:

```ts
streamGemini(modelName, query, context, apiKey, writer)
```

Build the URL from `modelName` (`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`). Used twice — once with `gemini-1.5-flash-8b`, once with `gemini-1.5-flash`. SSE parsing logic deduped.

### New provider chain

```text
1. Gemini Flash-8B  (primary)         — requires GEMINI_PRIMARY_MODEL
       │ fail / empty / non-2xx (and no token emitted yet)
       ▼
2. Gemini Flash     (fallback)        — requires GEMINI_PRIMARY_MODEL
       │ fail / empty / non-2xx (and no token emitted yet)
       ▼
3. Groq 3.3 70B     (emergency)       — only if ENABLE_GROQ_FALLBACK="true"
                                          AND GROQ_API_KEY present
       │ fail
       ▼
4. SSE error frame: "All providers are unavailable. Please try again later."
```

A provider is only attempted when the previous attempt **emitted zero tokens**. Once any token reaches the writer we cannot retry mid-stream — the existing `emitted` flag in `streamGroq` / `streamGemini` already enforces this and is preserved.

### Startup / request validation

Replace the current `!GROQ_API_KEY && !MSP_PROD_KEY` guard with:

- If `GEMINI_API_KEY` present → Gemini routing available (primary path).
- Else if `GROQ_ENABLED && GROQ_API_KEY` → Groq emergency path only.
- Else → `500 { error: "no_llm_keys_configured" }` (same shape as today).

Same JSON error response keys/status as before, so client-side error handling is unchanged.

### Logging (no secrets)

Tagged single-line logs at each transition:

- `[synthesize-answer] gemini_primary attempt model=gemini-1.5-flash-8b`
- `[synthesize-answer] gemini_primary ok model=gemini-1.5-flash-8b elapsed_ms=...`
- `[synthesize-answer] gemini_primary failed reason=<status|empty|exception> trying gemini_fallback`
- `[synthesize-answer] gemini_fallback attempt model=gemini-1.5-flash`
- `[synthesize-answer] gemini_fallback ok model=gemini-1.5-flash elapsed_ms=...`
- `[synthesize-answer] gemini_fallback failed reason=...`
- `[synthesize-answer] groq_emergency disabled` (when both Gemini calls failed and flag off)
- `[synthesize-answer] groq_emergency attempt model=llama-3.3-70b-versatile`
- `[synthesize-answer] groq_emergency ok model=llama-3.3-70b-versatile`
- `[synthesize-answer] all providers failed`

Elapsed time computed via `performance.now()` per attempt. No API keys or raw secret values logged.

### Groq update

- Bump `GROQ_MODEL` constant to `llama-3.3-70b-versatile` (current `llama-3.1-70b-versatile` is deprecated).
- Only call Groq when `GROQ_ENABLED === true`. Otherwise skip and log `groq_emergency disabled`.
- Keep the existing 3-attempt 429 backoff inside `streamGroq` unchanged.

### Input validation (preserved)

Already enforced — keep as-is:
- `query` trimmed, max 500 chars, reject empty.
- `chunks` array, max 5, each `content` capped at 2,000 chars.
- 600 max output tokens.
- Reject non-POST and non-JSON.

Add a `// TODO(PR-2): per-IP / per-token rate limit hook` comment near request entry.

### Header comment rewrite

Replace the existing top-of-file block. New version describes:
- Purpose (visitor-facing synthesis bridge).
- Provider chain: Gemini Flash-8B primary → Gemini Flash fallback → optional Groq emergency (gated by `ENABLE_GROQ_FALLBACK`).
- Gemini API key is currently sourced from `GEMINI_PRIMARY_MODEL` (note that the secret name is misleading; it stores the key value, not the model name).
- Security: keys never leave the function; strict input caps; `verify_jwt = false`.

No mention of `MSP_PROD_KEY`.

### Prompt and SSE format

- `SYSTEM_PROMPT` unchanged (grounding + concise + "I don't have that information…" fallback).
- Output SSE format unchanged: `data: {"token": "..."}\n\n` then `data: {"done": true}\n\n` or `data: {"error": "..."}\n\n`.
- Response headers unchanged: `text/event-stream`, `no-cache`, `nosniff`, CORS.

### TODO comment block for PR-2

Single comment block near the top documenting (no code stubs):
- presentation public token, source_context_hash, normalized_question_hash, property_uuid
- answer cache lookup before model call
- usage events emission
- per-presentation / per-MSP budget caps
- BYOK routing

### Verification (after deploy)

1. `npm run test:ask` — must pass (does not touch this function).
2. `npm run verify:html` — must pass (no template changes).
3. `rg "MSP_PROD_KEY" supabase/functions/synthesize-answer/index.ts` returns zero matches.
4. Curl the deployed function with `{ query: "What is the square footage?", chunks: [...] }` and confirm streaming tokens.
5. Edge function logs show `gemini_primary ok model=gemini-1.5-flash-8b`.
6. Simulate primary failure (e.g. temporarily set bad model name in code locally) → confirm `gemini_primary failed` then `gemini_fallback ok`.
7. With `ENABLE_GROQ_FALLBACK` unset and Gemini key absent → expect `no_llm_keys_configured` 500.
8. With `ENABLE_GROQ_FALLBACK=true`, `GROQ_API_KEY` set, Gemini key absent → Groq path used, log shows `groq_emergency ok model=llama-3.3-70b-versatile`.

### Risk / regression analysis

- **Wire shape unchanged:** request body, response SSE frames, headers, and HTTP status codes match today's contract. Existing generated HTML presentations in the wild keep working.
- **No client coupling:** `src/lib/portal.functions.ts` only references the URL; no body or response keys change.
- **Hard secret cutover:** Per spec, `MSP_PROD_KEY` is fully removed. Any environment that still relied on it will need `GEMINI_PRIMARY_MODEL` set — confirmed already present in the secrets list.
- **Groq deprecation:** Even though Groq is now optional, updating its model name to `llama-3.3-70b-versatile` prevents a silent failure if anyone enables the emergency flag.
- **No partial-stream regressions:** Fallback only triggers when zero tokens were emitted — same invariant as today's Groq→Gemini path, just with a third hop appended.
- **No build-time risk:** Pure edge-function refactor, no imports added, no Vite/SSR surface touched, no HTML template touched (so the recent backslash-escape bug class is not re-exposed).
