// synthesize-answer
// ─────────────────
// Synthesis Bridge — secure LLM proxy for the visitor-facing Ask panel.
//
// The visitor's browser sends:
//   { presentation_token, saved_model_id, property_uuid, query,
//     evidence_hints? }
//
// This function:
//   1. Verifies the presentation_token (HMAC over canonical payload)
//      and confirms the linked saved_model is paid + is_released.
//   2. Cross-checks the body's saved_model_id and confirms the
//      property_uuid is part of that presentation (no cross-tenant
//      leakage).
//   3. Reads `property_extractions` server-side and uses the
//      embedded chunks as the *trusted* evidence — visitor-supplied
//      chunks are no longer accepted as authoritative content;
//      `evidence_hints` may bias selection but cannot inject text.
//   4. Honours intelligence_health: a property whose status is
//      `failed` or null is rejected with `not_trained`.
//   5. Streams the LLM response as SSE (Gemini primary →
//      Gemini fallback → optional Groq emergency).
//
// Quotas, rate limits, BYOK routing, and the downgrade signal are
// added in subsequent commits (C8, C12, C13). This commit closes
// the trust hole: client-supplied chunks no longer pass through to
// the model verbatim.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { verifyPresentationToken } from "../_shared/presentation-token.ts";
import {
  parseIntelligenceHealth,
  hasAnyIntelligence,
} from "../_shared/intelligence-health.ts";
import {
  checkRateLimit,
  ipFromRequest,
} from "../_shared/rate-limit.ts";
import { decryptKey } from "../_shared/byok-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Model identifiers ──────────────────────────────────────────────────────
//
// Primary public synthesis runs on Gemini 2.5 Flash-Lite. Both model
// names are env-configurable so we can promote to gemini-2.5-flash
// later without redeploying the function. Defaults match the design
// Q&A: "approximately $0.10 per 1M input tokens" pricing class.

const GEMINI_PRIMARY_MODEL_NAME =
  Deno.env.get("GEMINI_PUBLIC_SYNTHESIS_MODEL") ?? "gemini-2.5-flash-lite";
const GEMINI_FALLBACK_MODEL_NAME =
  Deno.env.get("GEMINI_PUBLIC_SYNTHESIS_FALLBACK_MODEL") ??
  "gemini-2.5-flash";
const GROQ_FALLBACK_MODEL_NAME =
  Deno.env.get("GROQ_FALLBACK_MODEL") ?? "llama-3.3-70b-versatile";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// Gemini streaming endpoint (alt=sse returns SSE chunks).
const geminiUrl = (modelName: string, apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?key=${apiKey}&alt=sse`;

const SYSTEM_PROMPT =
  "You are a helpful real estate assistant. Answer the visitor's question using ONLY the context provided below. " +
  "Be concise (2–4 sentences). If the answer cannot be found in the context, say: " +
  '"I don\'t have that information in the provided documents." ' +
  "Do not add facts beyond what is in the context.";

// ── Types ────────────────────────────────────────────────────────────────────

interface SynthesisChunk {
  id: string;
  section: string;
  content: string;
  score: number;
}

interface EvidenceHints {
  chunk_ids?: string[];
  canonical_qa_ids?: string[];
}

interface RequestBody {
  /** Required: signed token issued at export time. */
  presentation_token?: string;
  /** Required: saved_model the visitor is asking about. */
  saved_model_id?: string;
  /** Required: which property within that presentation. */
  property_uuid?: string;
  /** Required: visitor's question. */
  query?: string;
  /** Optional: client-side bias signals; never trusted as content. */
  evidence_hints?: EvidenceHints;
}

const MAX_TRUSTED_CHUNKS = 5;
const MAX_CHUNK_CONTENT = 2_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function sseChunk(data: Record<string, unknown>): Uint8Array {
  return enc.encode(`data: ${JSON.stringify(data)}\n\n`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function buildContext(chunks: SynthesisChunk[]): string {
  return chunks
    .map((c, i) => `[${i + 1}] ${c.section}:\n${c.content}`)
    .join("\n\n");
}

// ── Provider: Gemini (alt=sse streaming) ────────────────────────────────────
//
// Returns true only if at least one token was emitted to the writer.
// The caller uses this to decide whether to attempt the next provider.
// We never retry mid-stream once any token has been written.

async function streamGemini(
  modelName: string,
  query: string,
  context: string,
  apiKey: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<boolean> {
  const prompt = `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${query}`;

  let resp: Response;
  try {
    resp = await fetch(geminiUrl(modelName, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    });
  } catch (err) {
    console.warn(`[synthesize-answer] gemini fetch error model=${modelName}:`, err);
    return false;
  }

  if (!resp.ok || !resp.body) {
    console.warn(
      `[synthesize-answer] gemini non-ok model=${modelName} status=${resp.status}`,
    );
    return false;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let emitted = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        try {
          const parsed = JSON.parse(payload) as {
            candidates?: Array<{
              content?: { parts?: Array<{ text?: string }> };
            }>;
          };
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            await writer.write(sseChunk({ token: text }));
            emitted = true;
          }
        } catch { /* ignore SSE parse errors */ }
      }
    }
  } catch (err) {
    console.warn(
      `[synthesize-answer] gemini stream read error model=${modelName}:`,
      err,
    );
    return emitted; // if we already emitted, treat as success
  }

  if (emitted) {
    await writer.write(sseChunk({ done: true }));
    return true;
  }
  return false;
}

// ── Provider: Groq (OpenAI-compatible SSE, optional emergency fallback) ─────

async function streamGroq(
  query: string,
  context: string,
  apiKey: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<boolean> {
  const userMessage = `Context:\n${context}\n\nQuestion: ${query}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2_000 * attempt);

    let resp: Response;
    try {
      resp = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GROQ_FALLBACK_MODEL_NAME,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          stream: true,
          temperature: 0.3,
          max_tokens: 600,
        }),
      });
    } catch (err) {
      console.warn(
        `[synthesize-answer] groq fetch error attempt=${attempt}:`,
        err,
      );
      continue;
    }

    if (resp.status === 429) continue; // retry with backoff
    if (!resp.ok || !resp.body) {
      console.warn(`[synthesize-answer] groq non-ok status=${resp.status}`);
      return false;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let emitted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") {
            await writer.write(sseChunk({ done: true }));
            return true;
          }
          try {
            const parsed = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              await writer.write(sseChunk({ token }));
              emitted = true;
            }
          } catch { /* ignore SSE parse errors */ }
        }
      }
    } catch (err) {
      console.warn("[synthesize-answer] groq stream read error:", err);
      return emitted;
    }

    if (emitted) {
      await writer.write(sseChunk({ done: true }));
      return true;
    }
    return false;
  }

  // All 3 attempts exhausted (rate-limited).
  return false;
}

// ── Main handler ─────────────────────────────────────────────────────────────

function jsonError(
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

/**
 * Normalize a bytea column from supabase-js into a Uint8Array. The
 * REST adapter sometimes returns the value as a `\\x...` hex string
 * (default Postgres bytea_output) and sometimes as a Uint8Array
 * depending on column type inference. Handle both, plus base64 as a
 * defensive third path.
 */
function bytesFromBytea(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    const s = value;
    if (s.startsWith("\\x") || s.startsWith("\\\\x")) {
      const hex = s.startsWith("\\\\x") ? s.slice(3) : s.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    // base64
    try {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      throw new Error(`bytesFromBytea: unrecognized string encoding`);
    }
  }
  throw new Error(`bytesFromBytea: unsupported value type`);
}

const TEXT_ENC = new TextEncoder();

function normaliseQuestion(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", TEXT_ENC.encode(s));
  const bytes = new Uint8Array(buf);
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function computeIdempotencyKey(args: {
  token: string;
  query: string;
  chunk_ids: string[];
}): Promise<string> {
  const sortedIds = [...args.chunk_ids].sort();
  const evidenceHash = await sha256Hex(JSON.stringify(sortedIds));
  return await sha256Hex(
    `${args.token}|${normaliseQuestion(args.query)}|${evidenceHash}`,
  );
}

interface QuotaSnapshot {
  free_used: number;
  free_limit: number;
  byok_active: boolean;
  exhausted_email_sent_at: string | null;
}

function deriveQuotaState(
  q: QuotaSnapshot,
): {
  quota_remaining: number;
  quota_state:
    | "ok"
    | "exhausted_after_this_answer"
    | "exhausted"
    | "byok_unlimited";
  downgrade_required: boolean;
} {
  if (q.byok_active) {
    return {
      quota_remaining: -1,
      quota_state: "byok_unlimited",
      downgrade_required: false,
    };
  }
  const remaining = Math.max(0, q.free_limit - q.free_used);
  if (remaining === 0) {
    return {
      quota_remaining: 0,
      quota_state: "exhausted",
      downgrade_required: true,
    };
  }
  if (remaining === 1) {
    // This will be the last paid answer — flag the runtime so it can
    // pre-render the downgrade UI immediately on the next visit.
    return {
      quota_remaining: 1,
      quota_state: "exhausted_after_this_answer",
      downgrade_required: true,
    };
  }
  return {
    quota_remaining: remaining,
    quota_state: "ok",
    downgrade_required: false,
  };
}

interface ChunkRow {
  id?: string;
  section?: string;
  content?: string;
  qualityScore?: number;
  visibility?: string;
}

/**
 * Fetch and shape the trusted evidence for one property. Reads the
 * persisted chunks (post-hydrator), filters out private-visibility
 * chunks, and returns the highest-quality K chunks. Visitor-supplied
 * `evidence_hints.chunk_ids` are used to *bias* the ordering but
 * never to inject content the server didn't load.
 */
function pickTrustedChunks(
  rows: Array<{ chunks: unknown }>,
  hints: EvidenceHints | undefined,
  k: number,
): SynthesisChunk[] {
  const all: ChunkRow[] = [];
  for (const r of rows) {
    if (Array.isArray(r.chunks)) {
      for (const c of r.chunks as ChunkRow[]) {
        if (!c || typeof c !== "object") continue;
        if (c.visibility === "private") continue;
        all.push(c);
      }
    }
  }
  const hintIds = new Set(
    (hints?.chunk_ids ?? [])
      .filter((x): x is string => typeof x === "string")
      .slice(0, k * 4),
  );
  const scored = all.map((c) => ({
    chunk: c,
    score:
      (typeof c.qualityScore === "number" ? c.qualityScore : 0.5) +
      (c.id && hintIds.has(c.id) ? 0.5 : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ chunk, score }) => ({
    id: String(chunk.id ?? "").slice(0, 100),
    section: String(chunk.section ?? "").slice(0, 100),
    content: String(chunk.content ?? "").slice(0, MAX_CHUNK_CONTENT),
    score,
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, { error: "method_not_allowed" });
  }

  // Per-IP rate limit BEFORE any auth/DB work so a flood of bad
  // requests can't burn the verifier or the model. Spec minimum is
  // 5/min/IP.
  const ip = ipFromRequest(req);
  const rl = checkRateLimit(ip, { perMinute: 5 });
  if (!rl.allowed) {
    return jsonError(
      429,
      { error: "rate_limited", retry_after_seconds: rl.retryAfterSeconds },
      { "Retry-After": String(rl.retryAfterSeconds) },
    );
  }

  // Resolve provider availability. New canonical secret name is
  // GEMINI_API_KEY; the old GEMINI_PRIMARY_MODEL is accepted for one
  // release as a fallback so deploys can rotate without downtime.
  const GEMINI_API_KEY =
    Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GEMINI_PRIMARY_MODEL");
  const GROQ_ENABLED = Deno.env.get("ENABLE_GROQ_FALLBACK") === "true";
  const GROQ_API_KEY = GROQ_ENABLED ? Deno.env.get("GROQ_API_KEY") : null;

  if (!GEMINI_API_KEY && !(GROQ_ENABLED && GROQ_API_KEY)) {
    return jsonError(500, { error: "no_llm_keys_configured" });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return jsonError(500, { error: "supabase_env_missing" });
  }
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonError(400, { error: "invalid_json" });
  }

  const presentationToken = body.presentation_token ?? null;
  const claimedSavedModelId = body.saved_model_id ?? null;
  const propertyUuid = body.property_uuid ?? null;
  const query = String(body.query ?? "").slice(0, 500).trim();

  if (!presentationToken || !claimedSavedModelId || !propertyUuid) {
    return jsonError(401, {
      error: "token_required",
      detail: "presentation_token, saved_model_id, property_uuid required",
    });
  }
  if (!query) {
    return jsonError(400, { error: "missing_query" });
  }

  // Verify the signed token AND require paid+released. The verifier
  // also cross-checks expectedSavedModelId so a token issued for
  // model A cannot be replayed against model B.
  const tokenResult = await verifyPresentationToken(
    presentationToken,
    service,
    {
      expectedSavedModelId: claimedSavedModelId,
      requireReleased: true,
    },
  );
  if (!tokenResult.ok) {
    console.warn(
      `[synthesize-answer] token reject reason=${tokenResult.reason}`,
    );
    return jsonError(401, {
      error: "token_invalid",
      reason: tokenResult.reason,
    });
  }

  // Cross-check property_uuid is actually part of this presentation
  // and capture the provider_id for BYOK lookup.
  const { data: model } = await service
    .from("saved_models")
    .select("id, properties, provider_id")
    .eq("id", tokenResult.saved_model_id)
    .maybeSingle();
  if (!model) {
    return jsonError(404, { error: "saved_model_missing" });
  }
  const props = Array.isArray(model.properties) ? model.properties : [];
  const propertyInPresentation = props.some(
    (p: unknown) =>
      p && typeof p === "object" && (p as { id?: string }).id === propertyUuid,
  );
  if (!propertyInPresentation) {
    return jsonError(403, { error: "property_not_in_presentation" });
  }

  // Resolve BYOK: if the provider has an active Gemini key, decrypt
  // it and route the model call through that key. The TM key is
  // skipped entirely on this path; the quota event is recorded with
  // outcome='byok' so the TM subsidy doesn't decrement.
  let byokKey: string | null = null;
  try {
    const { data: byokRow } = await service
      .from("provider_byok_keys")
      .select("ciphertext, iv, active")
      .eq("provider_id", model.provider_id)
      .eq("vendor", "gemini")
      .maybeSingle();
    if (byokRow && byokRow.active) {
      // ciphertext + iv are bytea columns. supabase-js returns them
      // as either Uint8Array (in Deno) or hex strings. Normalize.
      const cipherBytes = bytesFromBytea(byokRow.ciphertext);
      const ivBytes = bytesFromBytea(byokRow.iv);
      byokKey = await decryptKey(cipherBytes, ivBytes);
    }
  } catch (err) {
    console.warn(
      "[synthesize-answer] byok lookup/decrypt failed, falling back to TM:",
      err,
    );
  }
  const usingByok = !!byokKey;
  const effectiveGeminiKey = byokKey ?? GEMINI_API_KEY;
  if (!effectiveGeminiKey && !(GROQ_ENABLED && GROQ_API_KEY)) {
    return jsonError(500, { error: "no_llm_keys_resolved" });
  }

  // Pull trusted evidence + intelligence_health from the DB.
  const { data: extractions, error: extractErr } = await service
    .from("property_extractions")
    .select("id, chunks, intelligence_health")
    .eq("property_uuid", propertyUuid);
  if (extractErr || !extractions || extractions.length === 0) {
    return jsonError(404, { error: "no_evidence" });
  }

  // Reject if every extraction's health is failed/null. A degraded or
  // context_only_degraded property is still answerable (open-question
  // answers from chunks even without structured fields).
  const anyAnswerable = extractions.some((row) => {
    const h = parseIntelligenceHealth(row.intelligence_health);
    return hasAnyIntelligence(h);
  });
  if (!anyAnswerable) {
    return jsonError(409, { error: "not_trained" });
  }

  const trustedChunks = pickTrustedChunks(
    extractions,
    body.evidence_hints,
    MAX_TRUSTED_CHUNKS,
  );
  if (trustedChunks.length === 0) {
    return jsonError(409, { error: "no_chunks_available" });
  }

  const context = buildContext(trustedChunks);

  // ── Pre-flight quota check ─────────────────────────────────────────────
  // Read the counter; if exhausted (and BYOK not active), refuse the
  // model call and emit a downgrade hint. This is the runtime gate
  // that drives the lead-capture form swap in C13.
  let quota: QuotaSnapshot = {
    free_used: 0,
    free_limit: 20,
    byok_active: false,
    exhausted_email_sent_at: null,
  };
  try {
    const { data: quotaRow } = await service.rpc("read_ask_quota_counter", {
      p_saved_model_id: tokenResult.saved_model_id,
      p_property_uuid: propertyUuid,
    });
    if (Array.isArray(quotaRow) && quotaRow.length > 0) {
      const q = quotaRow[0] as QuotaSnapshot;
      quota = {
        free_used: q.free_used ?? 0,
        free_limit: q.free_limit ?? 20,
        byok_active: q.byok_active ?? false,
        exhausted_email_sent_at: q.exhausted_email_sent_at ?? null,
      };
    }
  } catch (err) {
    console.warn("[synthesize-answer] quota read failed:", err);
  }
  // Treat usingByok as authoritative even if the counter row hasn't
  // yet been seeded (e.g. a brand-new saved_model that didn't exist
  // when validate-byok ran set_provider_byok_active). Avoids a race
  // where BYOK is set up but a fresh property still hits the cap.
  const preState = deriveQuotaState({
    ...quota,
    byok_active: quota.byok_active || usingByok,
  });
  if (preState.quota_state === "exhausted") {
    return jsonError(402, {
      error: "quota_exhausted",
      quota_remaining: 0,
      quota_state: "exhausted",
      downgrade_required: true,
    });
  }

  // Compute the idempotency key BEFORE the model call so a duplicate
  // submission (visitor mash) doesn't double-count.
  const idempotencyKey = await computeIdempotencyKey({
    token: presentationToken,
    query,
    chunk_ids: trustedChunks.map((c) => c.id),
  });

  // ── Stream response ─────────────────────────────────────────────────────────

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    try {
      let success = false;
      let provider:
        | "gemini_primary"
        | "gemini_fallback"
        | "groq_emergency"
        | null = null;
      const provenance: "byok" | "tm" = usingByok ? "byok" : "tm";

      // Emit a meta event up front with the live quota snapshot.
      await writer.write(
        sseChunk({
          meta: {
            saved_model_id: tokenResult.saved_model_id,
            property_uuid: propertyUuid,
            chunks_used: trustedChunks.length,
            quota_remaining: preState.quota_remaining,
            quota_state: preState.quota_state,
            downgrade_required: preState.downgrade_required,
          },
        }),
      );

      // 1. Gemini primary — uses BYOK key if present, TM key otherwise.
      if (effectiveGeminiKey) {
        const t0 = performance.now();
        console.info(
          `[synthesize-answer] gemini_primary attempt model=${GEMINI_PRIMARY_MODEL_NAME} provenance=${provenance}`,
        );
        success = await streamGemini(
          GEMINI_PRIMARY_MODEL_NAME,
          query,
          context,
          effectiveGeminiKey,
          writer,
        );
        if (success) {
          provider = "gemini_primary";
          console.info(
            `[synthesize-answer] gemini_primary ok model=${GEMINI_PRIMARY_MODEL_NAME} elapsed_ms=${Math.round(performance.now() - t0)}`,
          );
        } else {
          console.warn(
            `[synthesize-answer] gemini_primary failed model=${GEMINI_PRIMARY_MODEL_NAME} trying gemini_fallback`,
          );
        }
      }

      // 2. Gemini fallback — same BYOK/TM resolution.
      if (!success && effectiveGeminiKey) {
        const t1 = performance.now();
        console.info(
          `[synthesize-answer] gemini_fallback attempt model=${GEMINI_FALLBACK_MODEL_NAME} provenance=${provenance}`,
        );
        success = await streamGemini(
          GEMINI_FALLBACK_MODEL_NAME,
          query,
          context,
          effectiveGeminiKey,
          writer,
        );
        if (success) {
          provider = "gemini_fallback";
          console.info(
            `[synthesize-answer] gemini_fallback ok model=${GEMINI_FALLBACK_MODEL_NAME} elapsed_ms=${Math.round(performance.now() - t1)}`,
          );
        } else {
          console.warn(
            `[synthesize-answer] gemini_fallback failed model=${GEMINI_FALLBACK_MODEL_NAME}`,
          );
        }
      }

      // 3. Groq (optional emergency fallback)
      if (!success) {
        if (GROQ_ENABLED && GROQ_API_KEY) {
          const t2 = performance.now();
          console.info(
            `[synthesize-answer] groq_emergency attempt model=${GROQ_FALLBACK_MODEL_NAME}`,
          );
          success = await streamGroq(query, context, GROQ_API_KEY, writer);
          if (success) {
            provider = "groq_emergency";
            console.info(
              `[synthesize-answer] groq_emergency ok model=${GROQ_FALLBACK_MODEL_NAME} elapsed_ms=${Math.round(performance.now() - t2)}`,
            );
          } else {
            console.warn(
              `[synthesize-answer] groq_emergency failed model=${GROQ_FALLBACK_MODEL_NAME}`,
            );
          }
        } else {
          console.info("[synthesize-answer] groq_emergency disabled");
        }
      }

      // Emit a final meta event with the resolved provider + provenance
      // so the runtime can attribute usage to the right LLM and the
      // dashboard can distinguish BYOK answers from TM-funded ones.
      if (provider) {
        await writer.write(
          sseChunk({ meta: { provider, provenance } }),
        );
      }

      if (!success) {
        console.warn("[synthesize-answer] all providers failed");
        await writer.write(
          sseChunk({
            error: "All providers are unavailable. Please try again later.",
          }),
        );
      } else {
        // Idempotent quota event. BYOK provenance means the model
        // call ran on the provider's own key — record the event for
        // observability with outcome='byok' but do NOT decrement the
        // TM subsidy. The DB function only increments free_used when
        // outcome='counted'.
        const outcome: "counted" | "byok" = usingByok ? "byok" : "counted";
        try {
          const { data: post } = await service.rpc(
            "record_ask_quota_event",
            {
              p_saved_model_id: tokenResult.saved_model_id,
              p_property_uuid: propertyUuid,
              p_idempotency_key: idempotencyKey,
              p_outcome: outcome,
              p_reason: provider ?? null,
            },
          );
          if (Array.isArray(post) && post.length > 0) {
            const fresh = post[0] as QuotaSnapshot & { was_new: boolean };
            const after = deriveQuotaState({
              free_used: fresh.free_used,
              free_limit: fresh.free_limit,
              byok_active: fresh.byok_active,
              exhausted_email_sent_at: fresh.exhausted_email_sent_at,
            });
            await writer.write(
              sseChunk({
                meta: {
                  quota_remaining: after.quota_remaining,
                  quota_state: after.quota_state,
                  downgrade_required: after.downgrade_required,
                  was_new: fresh.was_new,
                },
              }),
            );
          }
        } catch (err) {
          console.warn("[synthesize-answer] quota record failed:", err);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await writer.write(sseChunk({ error: msg }));
      } catch { /* writer already closed */ }
    } finally {
      try {
        await writer.close();
      } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
