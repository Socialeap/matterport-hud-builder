/**
 * Customer-facing pricing copy for the Ask AI surface and the BYOK
 * dashboard. Centralized as a module-level constant so a future tune
 * (e.g. when Gemini revises its pricing) is a single edit, not a
 * grep-and-replace across the codebase.
 *
 * Per the design Q&A, the language is approximate and explicitly
 * defers to the live pricing page rather than asserting a fixed cost.
 */

export const GEMINI_PRICING_COPY = {
  short:
    "Gemini API costs are extraordinarily low — approximately $0.10 per 1M input tokens. Output tokens are billed separately. See ai.google.dev/gemini-api/docs/pricing for current rates.",
  brief:
    "Approximately $0.10 per 1M input tokens (output billed separately).",
  reference: "https://ai.google.dev/gemini-api/docs/pricing",
} as const;

export const SYNTHESIS_MODEL_LABEL = "Gemini 2.5 Flash-Lite";
