// synthesize-answer
// ─────────────────
// Synthesis Bridge — secure LLM proxy for the visitor-facing Ask panel.
//
// The visitor's browser retrieves 3-5 relevant document chunks from its
// local Orama index, then POSTs { query, chunks } here. This function
// prompts an LLM to synthesise a conversational answer grounded *only* in
// those chunks and streams the result back as Server-Sent Events.
//
// Provider chain (cost-shield):
//   1. Primary    — Gemini 1.5 Flash-8B (cheap, fast, sufficient for
//                   short grounded answers).
//   2. Fallback   — Gemini 1.5 Flash    (stronger escalation if 8B fails
//                   before emitting any token).
//   3. Emergency  — Groq Llama 3.3 70B  (only when ENABLE_GROQ_FALLBACK
//                   === "true" AND GROQ_API_KEY is set).
//
// Secrets:
//   • GEMINI_PRIMARY_MODEL — Gemini API key. NOTE: despite the name, this
//     secret stores the API key value, not a model identifier. Model
//     names are hard-coded constants below.
//   • GROQ_API_KEY         — optional, only consulted when Groq fallback
//     is explicitly enabled.
//
// Security:
//   • API keys never leave this function (verify_jwt = false; callers are
//     anonymous tour visitors).
//   • Strict input caps: 500-char query, 5 chunks, 2,000 chars/chunk,
//     600 max output tokens.
//
// PR-2 (future, not in this PR):
//   • Presentation public token, source_context_hash,
//     normalized_question_hash, property_uuid in request body.
//   • Answer cache lookup before model call.
//   • Usage event emission.
//   • Per-presentation / per-MSP budget caps.
//   • BYOK (bring-your-own-key) routing.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Model identifiers (hard-coded; not derived from secret names) ───────────

const GEMINI_PRIMARY_MODEL_NAME = "gemini-1.5-flash-8b";
const GEMINI_FALLBACK_MODEL_NAME = "gemini-1.5-flash";
const GROQ_FALLBACK_MODEL_NAME = "llama-3.3-70b-versatile";

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

interface RequestBody {
  query: string;
  chunks: SynthesisChunk[];
}

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve provider availability.
  // GEMINI_PRIMARY_MODEL holds the Gemini API key value (despite the
  // misleading secret name).
  const GEMINI_API_KEY = Deno.env.get("GEMINI_PRIMARY_MODEL");
  const GROQ_ENABLED = Deno.env.get("ENABLE_GROQ_FALLBACK") === "true";
  const GROQ_API_KEY = GROQ_ENABLED ? Deno.env.get("GROQ_API_KEY") : null;

  if (!GEMINI_API_KEY && !(GROQ_ENABLED && GROQ_API_KEY)) {
    return new Response(
      JSON.stringify({ error: "no_llm_keys_configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Parse + validate ────────────────────────────────────────────────────────
  // TODO(PR-2): per-IP / per-token rate limit hook here.

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const query = String(body?.query ?? "").slice(0, 500).trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "missing_query" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!Array.isArray(body?.chunks)) {
    return new Response(JSON.stringify({ error: "invalid_chunks" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawChunks = body.chunks.slice(0, 5);
  if (rawChunks.length === 0) {
    return new Response(JSON.stringify({ error: "no_chunks" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const chunks: SynthesisChunk[] = rawChunks.map((c) => ({
    id: String(c?.id ?? "").slice(0, 100),
    section: String(c?.section ?? "").slice(0, 100),
    content: String(c?.content ?? "").slice(0, 2_000),
    score: Number(c?.score ?? 0),
  }));

  const context = buildContext(chunks);

  // ── Stream response ─────────────────────────────────────────────────────────

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    try {
      let success = false;

      // 1. Gemini Flash-8B (primary)
      if (GEMINI_API_KEY) {
        const t0 = performance.now();
        console.info(
          `[synthesize-answer] gemini_primary attempt model=${GEMINI_PRIMARY_MODEL_NAME}`,
        );
        success = await streamGemini(
          GEMINI_PRIMARY_MODEL_NAME,
          query,
          context,
          GEMINI_API_KEY,
          writer,
        );
        if (success) {
          console.info(
            `[synthesize-answer] gemini_primary ok model=${GEMINI_PRIMARY_MODEL_NAME} elapsed_ms=${Math.round(performance.now() - t0)}`,
          );
        } else {
          console.warn(
            `[synthesize-answer] gemini_primary failed model=${GEMINI_PRIMARY_MODEL_NAME} trying gemini_fallback`,
          );
        }
      }

      // 2. Gemini Flash (fallback)
      if (!success && GEMINI_API_KEY) {
        const t1 = performance.now();
        console.info(
          `[synthesize-answer] gemini_fallback attempt model=${GEMINI_FALLBACK_MODEL_NAME}`,
        );
        success = await streamGemini(
          GEMINI_FALLBACK_MODEL_NAME,
          query,
          context,
          GEMINI_API_KEY,
          writer,
        );
        if (success) {
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

      if (!success) {
        console.warn("[synthesize-answer] all providers failed");
        await writer.write(
          sseChunk({
            error: "All providers are unavailable. Please try again later.",
          }),
        );
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
