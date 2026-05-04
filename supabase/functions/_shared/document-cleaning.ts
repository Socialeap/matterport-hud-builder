// Phase A — Hybrid RAG document-cleaning helpers.
//
// Two responsibilities, kept deliberately small so the same primitives
// can serve the heuristic extractor today and the Gemini smart extractor
// in Phase C.
//
//   1. `cleanDocumentText` — strip boilerplate likely to pollute a
//      sliding-window chunker (page numbers, repeated headers, TOC
//      runs, signature blocks). Conservative: when in doubt, keep.
//
//   2. `classifyChunkVisibility` — heuristic public/private gate. Public
//      chunks ship in the standalone HTML and are searchable by the
//      local Orama runtime. Private chunks stay in the database for
//      builder-side use only (server-side pre-synthesis grounding,
//      audit trails). We default to `public` so legacy rows keep
//      working; we only flip to `private` when text matches a known
//      sensitivity pattern.
//
// Neither function touches the network or any model. Pure string ops.

import type { ChunkVisibility } from "./extractors/types.ts";

// Patterns that we strip outright before chunking. Order matters —
// per-line patterns run first so multi-line ones see normalized input.
const PER_LINE_DROP: RegExp[] = [
  // "Page 3 of 17" / "p. 3" / bare page numbers on otherwise empty lines
  /^\s*(page\s+)?\d+\s*(of|\/)\s*\d+\s*$/i,
  /^\s*p\.?\s*\d+\s*$/i,
  /^\s*-\s*\d+\s*-\s*$/,
  // Lines that look like TOC entries: "Section 4 ............ 12"
  /^.{1,80}\.{6,}\s*\d{1,4}\s*$/,
];

// Whole-document patterns. Run after lines are dropped.
const GLOBAL_REPLACEMENTS: Array<[RegExp, string]> = [
  // Run-on dot-leaders inside otherwise normal prose
  [/\.{6,}/g, " "],
  // Soft hyphens (U+00AD)
  [/­/g, ""],
  // Form feed / vertical tab (PDF layout artifacts)
  [/[\f\v]/g, "\n"],
  // Inline citation markers like [1], [2, 5, 7] that pollute sentence
  // splitting and confuse the LLM. Strip aggressively — they never
  // carry semantic value in property docs.
  [/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, ""],
  // Insert a hard break before an inline section header that begins
  // a new label run mid-sentence (e.g. "...downtown Chaska. Real
  // Estate & Membership Details The property is..."). Heuristic:
  // a period followed by 2-5 capitalized words and then more prose.
  [/\.\s+([A-Z][\w&]+(?:\s+[A-Z][\w&]+){1,4})\s+(?=[A-Z][a-z])/g, ".\n\n$1\n"],
];

// Patterns that, if matched within a chunk, flip its visibility to
// `private`. Keep the list short and high-precision — false positives
// here remove answers from the runtime entirely.
const PRIVATE_PATTERNS: RegExp[] = [
  // SSNs, EINs
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\bEIN[:\s]+\d{2}-\d{7}\b/i,
  // "Internal use only" / "confidential" markers
  /\b(internal\s+use\s+only|confidential|do\s+not\s+distribute)\b/i,
  // Bank routing / account number labels (very loose)
  /\b(routing|account)\s+(number|no\.?)\s*[:#]/i,
  // Owner / staff direct-line markers commonly tagged in property docs
  /\b(owner|staff|emergency)\s+(direct|cell|mobile)\b/i,
];

/** Normalize whitespace, drop boilerplate lines, collapse leader runs. */
export function cleanDocumentText(input: string): string {
  if (!input) return "";

  // Normalize newlines first.
  let text = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Remove lines that match any drop pattern.
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    let drop = false;
    for (const re of PER_LINE_DROP) {
      if (re.test(line)) { drop = true; break; }
    }
    if (!drop) kept.push(line);
  }
  text = kept.join("\n");

  // Apply global replacements.
  for (const [re, replacement] of GLOBAL_REPLACEMENTS) {
    text = text.replace(re, replacement);
  }

  // Collapse 3+ blank lines down to 2.
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/** Visibility heuristic: returns `private` if the chunk content
 *  matches any sensitivity pattern, otherwise `public`. */
export function classifyChunkVisibility(content: string): ChunkVisibility {
  if (!content) return "public";
  for (const re of PRIVATE_PATTERNS) {
    if (re.test(content)) return "private";
  }
  return "public";
}
