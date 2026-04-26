/**
 * Translates raw extraction failures into the calm, user-facing copy
 * specified in the refactor brief. Never expose stack traces or HTTP
 * status codes to the user — every error gets a "what next" suggestion.
 */

import { ExtractionError } from "@/lib/extraction/client";

export function friendlyError(err: unknown): string {
  if (err instanceof ExtractionError) {
    switch (err.stage) {
      case "fetch_pdf":
      case "download":
        return "We couldn't open this document. Try a different copy.";
      case "parse_pdf":
      case "ocr":
        return "The AI had trouble reading this page. A clearer scan or text-based PDF works best.";
      case "fetch_url":
      case "ssrf":
        return "Couldn't reach that page. Check the URL and try again.";
      case "low_content":
        return "This source had very little text. A more detailed datasheet or PDF works best.";
      case "auth":
        return "Your session timed out. Refresh the page and try again.";
      case "freeze":
        return "This property is paused. Resume it before training.";
      case "embed":
        return "Indexing is finishing in the background — you can close this; status will update on the property card.";
      default:
        // Fall through to detail if we have one, else generic.
        if (err.detail) return err.detail;
        return "Something interrupted the training. Try again or use a different document.";
    }
  }

  if (err instanceof Error && err.message) {
    // Surface known patterns from non-ExtractionError throws.
    if (/timeout/i.test(err.message)) {
      return "Training took longer than expected. Indexing will continue in the background — close this and check the status badge.";
    }
    if (/network|fetch/i.test(err.message)) {
      return "Network hiccup while training. Check your connection and try again.";
    }
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
