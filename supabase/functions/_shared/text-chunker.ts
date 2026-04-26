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
  let start = 0;
  let idx = 0;
  while (start < clean.length && out.length < maxChunks) {
    const end = Math.min(start + chunkChars, clean.length);
    const content = clean.slice(start, end);
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
    if (end === clean.length) break;
    start = end - overlapChars;
    idx += 1;
  }
  return out;
}
