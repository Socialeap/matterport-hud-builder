// extract-url-content
// ───────────────────
// Companion to extract-property-doc for URL-based property data ingestion.
// Given { vault_asset_id, property_uuid, url, saved_model_id?, template_id? }:
//  1. Auth + LUS freeze + provider/client authorisation (mirrors sibling fn).
//  2. SSRF-guarded fetch of the URL (HTTP/HTTPS only, public hosts, ≤ 2 MB).
//  3. HTML → plain text (strip script/style/noscript/comments, collapse tags).
//  4. GPT-4o-mini structures the text into canonical real-estate fields.
//  5. Chunk the cleaned text for the RAG/Ask engine.
//  6. Upsert into property_extractions and flip vault_assets.embedding_status.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  vault_asset_id: string;
  property_uuid: string;
  url: string;
  saved_model_id?: string | null;
  template_id?: string | null;
}

interface PropertyChunk {
  id: string;
  section: string;
  content: string;
}

const MAX_FETCH_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_TEXT_CHARS = 12_000;
const FETCH_TIMEOUT_MS = 10_000;
const CHUNK_TARGET_CHARS = 800;

const SYSTEM_PROMPT = `Role and Objective:
You are a real-estate Data Extractor. Given the cleaned text of a property listing page, extract a flat JSON object whose keys are drawn from the standardized list below whenever the page contains the relevant fact, and whose values are the extracted facts (numbers stay numbers, strings stay strings).

Standardized canonical keys (use these exact names whenever the concept is present):
* property_address (string)
* list_price, sale_price, purchase_price (number — strip currency symbols and commas)
* square_feet, living_area (number)
* bedrooms, bathrooms, half_baths (number)
* year_built (number)
* lot_size (string — keep original units, e.g. "0.25 acres")
* hoa_fee, property_taxes (number)
* garage, parking_spaces (string or number)
* stories (number)
* property_type (string — e.g. "Single Family", "Condo")
* listing_date, closing_date (string — ISO 8601 if possible)

If you find other clearly extractable facts (school district, heating system, roof type, etc.), add them with lowercase snake_case keys.

Strict Output Constraints:
* Output ONLY a single valid JSON object.
* Do NOT use markdown fences.
* Do NOT include conversational text.
* Begin with { and end with }.
* Omit any field you cannot confidently extract.`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── SSRF guard ─────────────────────────────────────────────────────────
function isPrivateHostname(host: string): boolean {
  const h = host.toLowerCase().trim();
  if (!h) return true;
  if (h === "localhost" || h === "ip6-localhost" || h === "ip6-loopback") return true;
  if (h.endsWith(".internal") || h.endsWith(".local") || h.endsWith(".cluster.local")) {
    return true;
  }
  // IPv6 literals come in brackets via URL.hostname stripped — handle bare too.
  if (h === "::1" || h === "[::1]") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) {
    // fc00::/7 unique-local
    if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  }
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) {
    // fe80::/10 link-local
    if (/^fe[89ab][0-9a-f]:/.test(h)) return true;
  }
  // IPv4 literal?
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast / reserved
  }
  return false;
}

function validateUrl(rawUrl: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: "invalid_protocol" };
  }
  if (u.port && u.port !== "80" && u.port !== "443") {
    return { ok: false, reason: "invalid_port" };
  }
  if (isPrivateHostname(u.hostname)) {
    return { ok: false, reason: "private_host" };
  }
  return { ok: true, url: u };
}

async function fetchHtmlSafe(url: string): Promise<{ html: string; finalUrl: string }> {
  const resp = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LovablePropertyBot/1.0; +https://lovable.dev)",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  // Re-validate after redirects.
  const finalCheck = validateUrl(resp.url);
  if (!finalCheck.ok) {
    throw new Error(`redirect_to_blocked_host: ${finalCheck.reason}`);
  }
  if (!resp.ok) {
    throw new Error(`http_${resp.status}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error("no_response_body");

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_FETCH_BYTES) {
        try { await reader.cancel(); } catch { /* noop */ }
        throw new Error("response_too_large");
      }
      chunks.push(value);
    }
  }

  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
  return { html: new TextDecoder("utf-8").decode(buf), finalUrl: resp.url };
}

// ── HTML → plain text ──────────────────────────────────────────────────
function htmlToText(html: string): { text: string; sections: { offset: number; heading: string }[] } {
  // Strip block-level junk first.
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  // Capture headings inline as marker tokens we can post-process.
  const sections: { offset: number; heading: string }[] = [];
  s = s.replace(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _lvl, inner) => {
    const heading = decodeEntities(stripTags(String(inner))).trim().slice(0, 120);
    if (heading) {
      return `\n\n§§HEAD§§${heading}§§HEAD§§\n\n`;
    }
    return "\n\n";
  });

  // Collapse remaining tags.
  s = s.replace(/<\/?(p|div|section|article|li|tr|br|h[4-6])\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);

  // Normalise whitespace.
  s = s.replace(/[ \t\u00A0]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  // Extract heading positions for chunk section labels.
  const out: string[] = [];
  let cursor = 0;
  const re = /§§HEAD§§(.+?)§§HEAD§§/g;
  let m: RegExpExecArray | null;
  let plainOffset = 0;
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(cursor, m.index);
    out.push(before);
    plainOffset += before.length;
    sections.push({ offset: plainOffset, heading: m[1] });
    cursor = m.index + m[0].length;
  }
  out.push(s.slice(cursor));

  return { text: out.join("").trim(), sections };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = parseInt(n, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    });
}

// ── Chunking ───────────────────────────────────────────────────────────
function buildChunks(
  text: string,
  sections: { offset: number; heading: string }[],
): PropertyChunk[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: PropertyChunk[] = [];
  let runningOffset = 0;
  let chunkIdx = 0;

  for (const para of paragraphs) {
    const heading = nearestHeading(sections, runningOffset);
    if (para.length <= CHUNK_TARGET_CHARS) {
      chunks.push({
        id: `chunk:${chunkIdx++}`,
        section: heading,
        content: para,
      });
    } else {
      // Split long paragraph on sentence boundaries.
      const sentences = para.split(/(?<=[.!?])\s+/);
      let buf = "";
      for (const sent of sentences) {
        if ((buf + " " + sent).trim().length > CHUNK_TARGET_CHARS && buf) {
          chunks.push({
            id: `chunk:${chunkIdx++}`,
            section: heading,
            content: buf.trim(),
          });
          buf = sent;
        } else {
          buf = buf ? `${buf} ${sent}` : sent;
        }
      }
      if (buf.trim()) {
        chunks.push({
          id: `chunk:${chunkIdx++}`,
          section: heading,
          content: buf.trim(),
        });
      }
    }
    runningOffset += para.length + 2;
  }
  return chunks;
}

function nearestHeading(
  sections: { offset: number; heading: string }[],
  offset: number,
): string {
  let current = "web";
  for (const s of sections) {
    if (s.offset <= offset) current = s.heading;
    else break;
  }
  return current;
}

// ── LLM structuring ────────────────────────────────────────────────────
function stripFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

/** Pull the first balanced {...} block out of a noisy LLM response. */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  const cleaned = stripFences(raw);
  // Quick path
  try {
    const v = JSON.parse(cleaned);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch { /* fall through to balanced scan */ }
  // Balanced-brace fallback (handles trailing prose / truncation pre-LAST }).
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const v = JSON.parse(cleaned.slice(start, i + 1));
          if (v && typeof v === "object" && !Array.isArray(v)) {
            return v as Record<string, unknown>;
          }
          return null;
        } catch { return null; }
      }
    }
  }
  return null;
}

async function structureFields(
  text: string,
  apiKey: string,
  domain: string,
): Promise<{ fields: Record<string, unknown>; llm_stage: string }> {
  const truncated = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: truncated },
        ],
        max_tokens: 4000,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[extract-url-content] ${domain} openai_${resp.status}: ${body.slice(0, 200)}`);
      return { fields: {}, llm_stage: `openai_${resp.status}` };
    }
    const completion = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    };
    const raw = completion.choices?.[0]?.message?.content ?? "";
    const finish = completion.choices?.[0]?.finish_reason ?? "stop";
    if (!raw.trim()) {
      return { fields: {}, llm_stage: "empty_response" };
    }
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      console.warn(
        `[extract-url-content] ${domain} json_parse_failed (finish=${finish}, len=${raw.length})`,
      );
      return { fields: {}, llm_stage: `parse_failed_${finish}` };
    }
    return { fields: parsed, llm_stage: finish === "length" ? "ok_truncated" : "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[extract-url-content] ${domain} structuring exception: ${msg}`);
    return { fields: {}, llm_stage: `exception:${msg.slice(0, 80)}` };
  }
}

// ── Auto-template helper ───────────────────────────────────────────────
async function ensureUrlTemplate(
  serviceClient: ReturnType<typeof createClient>,
  providerId: string,
  hostname: string,
): Promise<string | null> {
  const label = `Auto: ${hostname}`;

  const { data: existing } = await serviceClient
    .from("vault_templates")
    .select("id")
    .eq("provider_id", providerId)
    .eq("label", label)
    .eq("is_active", true)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  // NOTE: vault_templates.extractor has a CHECK constraint allowing only
  // 'pdfjs_heuristic' or 'donut'. We use 'pdfjs_heuristic' here as the
  // template-row metadata; the actual URL extraction logic is selected by
  // the calling edge function and recorded in property_extractions.extractor.
  const { data: inserted, error } = await serviceClient
    .from("vault_templates")
    .insert({
      provider_id: providerId,
      label,
      doc_kind: "web_url",
      field_schema: { type: "object", properties: {}, required: [] },
      extractor: "pdfjs_heuristic",
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    console.error("[extract-url-content] template insert failed:", error);
    return null;
  }
  return inserted.id as string;
}

// ── Handler ────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const userId = userData.user.id;

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!body.vault_asset_id || !body.property_uuid || !body.url) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }

  // ── 1. Freeze check ──────────────────────────────────────────────────
  const { data: freeze } = await serviceClient
    .from("lus_freezes")
    .select("property_uuid")
    .eq("property_uuid", body.property_uuid)
    .maybeSingle();
  if (freeze) {
    return jsonResponse(
      { error: "lus_frozen", property_uuid: body.property_uuid },
      423,
    );
  }

  // ── 2. Asset ownership / authorisation ───────────────────────────────
  const { data: asset, error: assetErr } = await serviceClient
    .from("vault_assets")
    .select("id, provider_id, category_type")
    .eq("id", body.vault_asset_id)
    .single();
  if (assetErr || !asset) {
    return jsonResponse({ error: "asset_not_found" }, 404);
  }

  let authorised = asset.provider_id === userId;
  if (!authorised) {
    const { data: link } = await serviceClient
      .from("client_providers")
      .select("id")
      .eq("provider_id", asset.provider_id)
      .eq("client_id", userId)
      .maybeSingle();
    authorised = !!link;
  }
  if (!authorised) return jsonResponse({ error: "forbidden" }, 403);

  if (asset.category_type !== "property_doc") {
    return jsonResponse({ error: "wrong_category" }, 400);
  }

  // ── 3. Validate URL (SSRF guard) ─────────────────────────────────────
  const urlCheck = validateUrl(body.url);
  if (!urlCheck.ok) {
    return jsonResponse({ error: "invalid_url", reason: urlCheck.reason }, 400);
  }

  // ── 4. Fetch HTML ────────────────────────────────────────────────────
  let html: string;
  try {
    const result = await fetchHtmlSafe(urlCheck.url.toString());
    html = result.html;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "fetch_failed", detail: msg }, 502);
  }

  // ── 5. HTML → text + chunks ──────────────────────────────────────────
  const { text, sections } = htmlToText(html);
  console.info(
    `[extract-url-content] ${urlCheck.url.hostname}: text_len=${text.length}`,
  );
  if (!text || text.length < 40) {
    return jsonResponse(
      { error: "thin_content", text_length: text.length },
      422,
    );
  }
  const chunks = buildChunks(text, sections);

  // ── 6. Resolve template_id (or create per-host auto-template) ────────
  let activeTemplateId: string | null = body.template_id ?? null;
  if (activeTemplateId) {
    const { data: tpl } = await serviceClient
      .from("vault_templates")
      .select("id")
      .eq("id", activeTemplateId)
      .eq("provider_id", asset.provider_id)
      .maybeSingle();
    if (!tpl) activeTemplateId = null;
  }
  if (!activeTemplateId) {
    activeTemplateId = await ensureUrlTemplate(
      serviceClient,
      asset.provider_id,
      urlCheck.url.hostname,
    );
  }
  if (!activeTemplateId) {
    return jsonResponse({ error: "template_resolve_failed" }, 500);
  }

  // ── 7. Structure fields with the LLM (best-effort) ───────────────────
  const fields = OPENAI_API_KEY
    ? await structureFields(text, OPENAI_API_KEY)
    : {};

  // ── 8. Persist ───────────────────────────────────────────────────────
  const { data: upserted, error: upErr } = await serviceClient
    .from("property_extractions")
    .upsert(
      {
        vault_asset_id: body.vault_asset_id,
        template_id: activeTemplateId,
        saved_model_id: body.saved_model_id ?? null,
        property_uuid: body.property_uuid,
        fields,
        chunks,
        extractor: "web_url",
        extractor_version: "1",
      },
      { onConflict: "vault_asset_id,template_id" },
    )
    .select("id")
    .single();
  if (upErr || !upserted) {
    return jsonResponse(
      { error: "persist_failed", detail: upErr?.message ?? "unknown" },
      500,
    );
  }

  await serviceClient
    .from("vault_assets")
    .update({ embedding_status: "pending" })
    .eq("id", body.vault_asset_id);

  return jsonResponse({
    extraction_id: upserted.id,
    fields,
    chunks_indexed: chunks.length,
    embedding_status: "pending" as const,
  });
});
