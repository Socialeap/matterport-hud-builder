/**
 * Translates raw extraction failures into the calm, user-facing copy
 * specified in the refactor brief. Never expose stack traces or HTTP
 * status codes to the user — every error gets a "what next" suggestion.
 */

import { ExtractionError } from "@/lib/extraction/client";
import { InduceSchemaError } from "@/lib/extraction/induce";
import type { ExtractionFailure } from "@/hooks/usePropertyExtractions";

/**
 * Translate a structured `ExtractionFailure` (recorded by the hook when
 * `extract()` returns null) into user-facing copy. This is the primary
 * path for "Training stopped during extraction" — using the actual
 * server stage gives users an actionable hint instead of a dead-end.
 */
export function failureToCopy(f: ExtractionFailure): string {
  // 404s from extract-property-doc come back with stage="template" or "asset".
  if (f.status === 404 && (f.stage === "template" || f.stage === "asset")) {
    return "We couldn't connect your document to the chosen profile. Try selecting the profile again, or pick a different document.";
  }
  switch (f.stage) {
    case "fetch_pdf":
    case "download":
      return "We couldn't open the uploaded file. Try uploading it again.";
    case "parse_pdf":
    case "ocr":
    case "extraction":
      return "This document couldn't be read automatically. Try a text-based PDF (not a scanned image).";
    case "fetch_url":
    case "ssrf":
      return "Couldn't reach that page. Check the URL and try again.";
    case "low_content":
      return "This source had very little text. A more detailed datasheet or PDF works best.";
    case "auth":
      return "Your session timed out. Refresh the page and try again.";
    case "freeze":
      return "This property is paused. Resume it before training.";
    case "groq":
    case "embed":
      return "The AI was busy. Please try again in a moment.";
    case "template":
    case "asset":
      return "We couldn't connect your document to the chosen profile. Try selecting the profile again.";
    default:
      return "Training stopped before it could finish. Try again or use a different document.";
  }
}

export function friendlyError(err: unknown): string {
  if (err instanceof ExtractionError) {
    return failureToCopy({
      stage: err.stage,
      detail: err.detail,
      status: err.status,
      at: Date.now(),
    });
  }

  if (err instanceof InduceSchemaError) {
    if (err.kind === "empty_pdf_text") {
      return "We couldn't read text from this PDF — it looks image-only. Try a text-based PDF for best results.";
    }
    return "We couldn't analyze the document fields. Try a different document, or proceed with the standard profile.";
  }

  if (err instanceof Error && err.message) {
    if (/timeout/i.test(err.message)) {
      return "Training took longer than expected. Indexing will continue in the background — close this and check the status badge.";
    }
    if (/network|fetch/i.test(err.message)) {
      return "Network hiccup while training. Check your connection and try again.";
    }
    // Surface concise auth/profile messages directly (e.g. "Couldn't save the Coworking profile.").
    if (err.message.length < 200) return err.message;
  }

  return "Something interrupted the training. Try again or use a different document.";
}

/**
 * Humanizes a snake_case field key into a guess-question, e.g.
 *   "list_price"            → "What's the list price?"
 *   "total_rooms"           → "What's the total rooms?"  → cleaned below.
 *   "pet_policy"            → "What's the pet policy?"
 *
 * Best-effort heuristic — Step 4 uses these as suggested icebreakers.
 */
export function fieldToQuestion(key: string): string {
  const phrase = key
    .replace(/_/g, " ")
    .replace(/\bpct\b/gi, "percentage")
    .replace(/\bsqft\b/gi, "square footage")
    .replace(/\bsq ft\b/gi, "square footage")
    .replace(/\bbr\b/gi, "bedroom")
    .replace(/\bba\b/gi, "bathroom")
    .toLowerCase();

  // Boolean-ish keys → yes/no question.
  if (/^(has|is|allow|include|enable)/.test(phrase) || /\b(included|allowed|available)\b/.test(phrase)) {
    return `Is ${phrase}?`.replace(/\s+\?$/, "?");
  }

  // Count-ish keys.
  if (/\b(count|number|total)\b/.test(phrase)) {
    return `How many ${phrase.replace(/\b(count|number of|total)\b/gi, "").trim()}?`.replace(/\s+/g, " ");
  }

  return `What's the ${phrase}?`;
}
