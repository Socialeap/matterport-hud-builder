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
//   Primary  — Groq (Llama 3.1 70B), retry on 429 with exponential backoff.
//   Fallback — Gemini 1.5 Flash via MSP_PROD_KEY, used after Groq exhaustion.
//
// Security notes:
//   • GROQ_API_KEY and MSP_PROD_KEY never leave this function.
//   • Input is strictly validated (max 5 chunks, 2 000 chars each, 500 char query).
//   • verify_jwt = false (config.toml) — callers are anonymous tour visitors.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-70b-versatile";

// Gemini streaming endpoint (alt=sse returns SSE chunks).
const GEMINI_MODEL = "gemini-1.5-flash";
const GEMINI_URL_TEMPLATE = (key: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?key=${key}&alt=sse`;

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

// ── Provider: Groq (OpenAI-compatible SSE) ───────────────────────────────────

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
          model: GROQ_MODEL,
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
      console.warn(`[synthesize-answer] groq fetch error attempt=${attempt}:`, err);
      continue;
    }

    if (resp.status === 429) continue; // retry with backoff
    if (!resp.ok || !resp.body) {
      console.warn(`[synthesize-answer] groq non-ok status=${resp.status}`);
      return false;
    }

    // Pipe Groq's SSE stream, translating to our unified format.
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
      return false;
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

// ── Provider: Gemini 1.5 Flash (alt=sse streaming) ──────────────────────────

async function streamGemini(
  query: string,
  context: string,
  apiKey: string,
  writer: WritableStreamDefaultWriter<Uint8Array>,
): Promise<boolean> {
  const prompt = `${SYSTEM_PROMPT}\n\nContext:\n${context}\n\nQuestion: ${query}`;

  let resp: Response;
  try {
    resp = await fetch(GEMINI_URL_TEMPLATE(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
      }),
    });
  } catch (err) {
    console.warn("[synthesize-answer] gemini fetch error:", err);
    return false;
  }

  if (!resp.ok || !resp.body) {
    console.warn(`[synthesize-answer] gemini non-ok status=${resp.status}`);
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
        } catch { /* ignore */ }
      }
    }
  } catch (err) {
    console.warn("[synthesize-answer] gemini stream read error:", err);
    return false;
  }

  if (emitted) {
    await writer.write(sseChunk({ done: true }));
    return true;
  }
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

  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  const MSP_PROD_KEY = Deno.env.get("MSP_PROD_KEY");

  if (!GROQ_API_KEY && !MSP_PROD_KEY) {
    return new Response(
      JSON.stringify({ error: "no_llm_keys_configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  // ── Parse + validate ────────────────────────────────────────────────────────

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const query = String(body.query ?? "").slice(0, 500).trim();
  if (!query) {
    return new Response(JSON.stringify({ error: "missing_query" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rawChunks = Array.isArray(body.chunks) ? body.chunks.slice(0, 5) : [];
  if (rawChunks.length === 0) {
    return new Response(JSON.stringify({ error: "no_chunks" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const chunks: SynthesisChunk[] = rawChunks.map((c) => ({
    id: String(c.id ?? "").slice(0, 100),
    section: String(c.section ?? "").slice(0, 100),
    content: String(c.content ?? "").slice(0, 2_000),
    score: Number(c.score ?? 0),
  }));

  const context = buildContext(chunks);

  // ── Stream response ─────────────────────────────────────────────────────────

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();

  (async () => {
    try {
      let success = false;

      if (GROQ_API_KEY) {
        success = await streamGroq(query, context, GROQ_API_KEY, writer);
        if (success) {
          console.info("[synthesize-answer] groq ok");
        } else {
          console.warn("[synthesize-answer] groq exhausted, trying gemini fallback");
        }
      }

      if (!success && MSP_PROD_KEY) {
        success = await streamGemini(query, context, MSP_PROD_KEY, writer);
        if (success) {
          console.info("[synthesize-answer] gemini fallback ok");
        }
      }

      if (!success) {
        await writer.write(
          sseChunk({ error: "All providers are unavailable. Please try again later." }),
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
