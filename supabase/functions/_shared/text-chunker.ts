// Phase A — Sliding-window text chunker shared across extractors.
//
// Replaces the inline `chunkText` previously embedded in
// `pdfjs-heuristic.ts`. The shape is unchanged so extraction rows
// already in the database keep working; the extension is metadata
// (kind, source, qualityScore, tokenEstimate, visibility).
//
// Phase C's Gemini smart extractor will reuse this same primitive for
// fact-density-aware batching, which is why the API takes options and
// is not pdf-specific.

import { classifyChunkVisibility } from "./document-cleaning.ts";
import type {
  ChunkSource,
  ChunkVisibility,
  PropertyChunk,
} from "./extractors/types.ts";

export interface ChunkerOptions {
  /** Target chunk size in characters. Defaults to 1200 (legacy). */
  chunkChars?: number;
  /** Overlap between adjacent windows in characters. Defaults to 150 (legacy). */
  overlapChars?: number;
  /** Section label written onto every emitted chunk. Usually the
   *  template's `doc_kind` so chunks downstream can be intent-routed
   *  by the runtime. */
  section: string;
  /** Source classification — what kind of text we are chunking. */
  source?: ChunkSource;
  /** Maximum chunk count to emit. The chunker truncates rather than
   *  failing — over-long documents simply lose the tail. Caller is
   *  responsible for reporting truncation upstream. Defaults to 256
   *  which, at the default 1200 chars/window, covers ~300k chars of
   *  text — well above any reasonable property document. */
  maxChunks?: number;
}

/** Estimate token count without loading a tokenizer. ~4 chars / token
 *  is the rule of thumb for English-heavy text and is precise enough
 *  for batching decisions. */
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Quality score in [0, 1]. Cheap heuristic: reward digit density
 *  (often signals prices, dates, room counts), penalize chunks that
 *  are mostly whitespace runs or bullet list noise. Phase C will
 *  override this with the Gemini-batched fact-density scorer. */
function scoreQuality(text: string): number {
  if (!text) return 0;
  const len = text.length;
  if (len < 40) return 0.1;
  let digits = 0;
  let alpha = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) digits++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) alpha++;
  }
  if (alpha === 0) return 0.1;
  const digitRatio = digits / len;
  const alphaRatio = alpha / len;
  // Most prose lands at ~0.7 alpha; a chunk with strong fact markers
  // (digits, currency, units) scores higher.
  let score = 0.5 + Math.min(digitRatio * 2, 0.3) + (alphaRatio - 0.5) * 0.4;
  if (score < 0) score = 0;
  if (score > 1) score = 1;
  return Number(score.toFixed(3));
}

function splitEvidenceUnits(text: string): string[] {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const units: string[] = [];
  const labelRe =
    /(?:^|[.;]\s+)([A-Z][A-Za-z0-9 /&()+.'-]{2,52}):\s*([^:]{12,520}?)(?=(?:[.;]\s+[A-Z][A-Za-z0-9 /&()+.'-]{2,52}:\s)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(clean)) !== null) {
    const label = m[1].trim();
    const value = m[2].trim().replace(/[.;]\s*$/, "");
    if (label && value) units.push(`${label}: ${value}.`);
  }

  const sentences = clean.match(/[^.!?]+[.!?]?/g) ?? [];
  for (const sentence of sentences) {
    const s = sentence.replace(/^[\s:;,.\-–—)]+/, "").trim();
    if (s.length < 24) continue;
    if (s.length <= 520) {
      units.push(s);
      continue;
    }
    for (const piece of s.split(/;\s+|,\s+(?=(?:and|including|with|which|while)\b)/i)) {
      const p = piece.trim();
      if (p.length >= 24 && p.length <= 520) units.push(p);
    }
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    const u = unit.replace(/\s+/g, " ").trim();
    const key = u.toLowerCase();
    if (!u || seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out.length > 0 ? out : [clean];
}

function sentenceWindowChunks(
  text: string,
  chunkChars: number,
  overlapChars: number,
  maxChunks: number,
): string[] {
  const units = splitEvidenceUnits(text);
  const chunks: string[] = [];
  let buf = "";
  let carry = "";

  for (const unit of units) {
    const candidate = buf ? `${buf} ${unit}` : unit;
    if (candidate.length <= chunkChars) {
      buf = candidate;
      continue;
    }
    if (buf) {
      chunks.push(buf);
      if (chunks.length >= maxChunks) return chunks;
      carry = overlapChars > 0 ? buf.slice(Math.max(0, buf.length - overlapChars)) : "";
    }
    buf = carry ? `${carry} ${unit}`.trim() : unit;
    if (buf.length > chunkChars * 1.5) {
      chunks.push(buf.slice(0, chunkChars));
      if (chunks.length >= maxChunks) return chunks;
      buf = buf.slice(Math.max(0, chunkChars - overlapChars)).trim();
    }
  }

  if (buf && chunks.length < maxChunks) chunks.push(buf);
  return chunks;
}

/** Slide a window over `text` and emit `PropertyChunk`s carrying
 *  Phase A metadata. */
export function slidingWindowChunks(
  text: string,
  options: ChunkerOptions,
): PropertyChunk[] {
  const chunkChars = options.chunkChars ?? 1200;
  const overlapChars = options.overlapChars ?? 150;
  const maxChunks = options.maxChunks ?? 256;
  const section = options.section;
  const source: ChunkSource = options.source ?? "pdf";

  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const out: PropertyChunk[] = [];
  const windows = sentenceWindowChunks(
    clean,
    chunkChars,
    overlapChars,
    maxChunks,
  );
  for (let idx = 0; idx < windows.length; idx++) {
    const content = windows[idx];
    const visibility: ChunkVisibility = classifyChunkVisibility(content);
    out.push({
      id: `${section}-${idx}`,
      section,
      content,
      kind: "raw_chunk",
      source,
      qualityScore: scoreQuality(content),
      tokenEstimate: estimateTokens(content),
      visibility,
    });
  }
  return out;
}
