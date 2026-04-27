/**
 * Intelligence health contract — the single source of truth for whether
 * a property's AI training run produced an answer-ready intelligence
 * profile.
 *
 * This module is intentionally dependency-free (no Supabase, no zod, no
 * fetch) so it can be imported verbatim by the Deno edge functions and
 * by the browser client. The Deno mirror lives at
 * `supabase/functions/_shared/intelligence-health.ts` and must stay in
 * lockstep — `tests/intelligence-health-parity.test.ts` enforces this.
 *
 * Decision rules (per spec):
 *   - "ready" requires meaningful learned fields OR canonical Q&A AND
 *     indexed evidence.
 *   - field_count === 0 must never render success copy unless the
 *     status is explicitly labelled "context_only_degraded".
 */

export const INTELLIGENCE_HEALTH_VERSION = 1 as const;

export type IntelligenceHealthStatus =
  | "ready"
  | "degraded"
  | "failed"
  | "context_only_degraded";

export interface IntelligenceHealth {
  version: typeof INTELLIGENCE_HEALTH_VERSION;
  status: IntelligenceHealthStatus;
  field_count: number;
  canonical_qa_count: number;
  chunk_count: number;
  embedded_chunk_count: number;
  candidate_field_count: number;
  evidence_unit_count: number;
  answerability_score: number; // 0..1
  warnings: string[];
  blocking_errors: string[];
  source_asset_id: string | null;
  property_uuid: string | null;
  saved_model_id: string | null;
  updated_at: string; // ISO 8601
}

export interface IntelligenceHealthInput {
  field_count: number;
  canonical_qa_count: number;
  chunk_count: number;
  embedded_chunk_count: number;
  candidate_field_count: number;
  evidence_unit_count: number;
  warnings?: string[];
  blocking_errors?: string[];
  source_asset_id?: string | null;
  property_uuid?: string | null;
  saved_model_id?: string | null;
  /** Optional override; otherwise computed deterministically from counts. */
  answerability_score?: number;
  /** Optional override of computed status (used only for explicit failures). */
  status?: IntelligenceHealthStatus;
}

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
};

const safeInt = (n: unknown): number => {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
};

/**
 * Compute the answerability score from raw counts. Deterministic so
 * client and server agree byte-for-byte.
 *
 * Weights:
 *   - learned fields:           0.40 (saturates at 5)
 *   - canonical Q&A pairs:      0.20 (saturates at 5)
 *   - any embedded chunks:      0.20
 *   - evidence units:           0.15 (saturates at 10)
 *   - medium-confidence fields: 0.05 (saturates at 5)
 */
export function computeAnswerabilityScore(
  input: Pick<
    IntelligenceHealthInput,
    | "field_count"
    | "canonical_qa_count"
    | "embedded_chunk_count"
    | "evidence_unit_count"
    | "candidate_field_count"
  >,
): number {
  const f = Math.min(safeInt(input.field_count) / 5, 1) * 0.4;
  const q = Math.min(safeInt(input.canonical_qa_count) / 5, 1) * 0.2;
  const c = safeInt(input.embedded_chunk_count) > 0 ? 0.2 : 0;
  const e = Math.min(safeInt(input.evidence_unit_count) / 10, 1) * 0.15;
  const cand =
    Math.min(safeInt(input.candidate_field_count) / 5, 1) * 0.05;
  return clamp01(f + q + c + e + cand);
}

/**
 * Build the intelligence_health record. Status is derived from the
 * counts unless the caller explicitly overrides it (e.g. on hard
 * extraction failure).
 */
export function computeIntelligenceHealth(
  input: IntelligenceHealthInput,
  nowIso?: string,
): IntelligenceHealth {
  const field_count = safeInt(input.field_count);
  const canonical_qa_count = safeInt(input.canonical_qa_count);
  const chunk_count = safeInt(input.chunk_count);
  const embedded_chunk_count = safeInt(input.embedded_chunk_count);
  const candidate_field_count = safeInt(input.candidate_field_count);
  const evidence_unit_count = safeInt(input.evidence_unit_count);
  const warnings = (input.warnings ?? []).slice(0, 32);
  const blocking_errors = (input.blocking_errors ?? []).slice(0, 16);
  const answerability_score =
    typeof input.answerability_score === "number"
      ? clamp01(input.answerability_score)
      : computeAnswerabilityScore({
          field_count,
          canonical_qa_count,
          embedded_chunk_count,
          evidence_unit_count,
          candidate_field_count,
        });

  let status: IntelligenceHealthStatus;
  if (input.status) {
    status = input.status;
  } else if (blocking_errors.length > 0) {
    status = "failed";
  } else if (field_count === 0 && canonical_qa_count === 0) {
    // No structured intelligence at all. If we still have indexed
    // chunks the visitor can get "context-only" answers from the LLM
    // synthesis path, but the UI must never call this "trained".
    status = chunk_count > 0 ? "context_only_degraded" : "failed";
  } else if (embedded_chunk_count === 0 && chunk_count > 0) {
    // Fields exist but RAG isn't indexed yet — partial readiness.
    status = "degraded";
  } else if (answerability_score < 0.45 || warnings.length > 0) {
    status = "degraded";
  } else {
    status = "ready";
  }

  return {
    version: INTELLIGENCE_HEALTH_VERSION,
    status,
    field_count,
    canonical_qa_count,
    chunk_count,
    embedded_chunk_count,
    candidate_field_count,
    evidence_unit_count,
    answerability_score,
    warnings,
    blocking_errors,
    source_asset_id: input.source_asset_id ?? null,
    property_uuid: input.property_uuid ?? null,
    saved_model_id: input.saved_model_id ?? null,
    updated_at: nowIso ?? new Date().toISOString(),
  };
}

/**
 * Type guard / parser for values read from the database. Returns null
 * if the value isn't a recognizable IntelligenceHealth record. Callers
 * that need a guaranteed value should compute a fresh "failed" record
 * instead of trusting a malformed one.
 */
export function parseIntelligenceHealth(
  value: unknown,
): IntelligenceHealth | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (
    v.status !== "ready" &&
    v.status !== "degraded" &&
    v.status !== "failed" &&
    v.status !== "context_only_degraded"
  ) {
    return null;
  }
  const num = (k: string): number => safeInt(v[k]);
  const strOrNull = (k: string): string | null =>
    typeof v[k] === "string" ? (v[k] as string) : null;
  const arr = (k: string): string[] =>
    Array.isArray(v[k])
      ? (v[k] as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  const score =
    typeof v.answerability_score === "number"
      ? clamp01(v.answerability_score as number)
      : 0;
  const updated_at =
    typeof v.updated_at === "string" ? v.updated_at : new Date().toISOString();
  return {
    version: INTELLIGENCE_HEALTH_VERSION,
    status: v.status as IntelligenceHealthStatus,
    field_count: num("field_count"),
    canonical_qa_count: num("canonical_qa_count"),
    chunk_count: num("chunk_count"),
    embedded_chunk_count: num("embedded_chunk_count"),
    candidate_field_count: num("candidate_field_count"),
    evidence_unit_count: num("evidence_unit_count"),
    answerability_score: score,
    warnings: arr("warnings"),
    blocking_errors: arr("blocking_errors"),
    source_asset_id: strOrNull("source_asset_id"),
    property_uuid: strOrNull("property_uuid"),
    saved_model_id: strOrNull("saved_model_id"),
    updated_at,
  };
}

/** True when the status permits showing "trained / ready" UI copy. */
export function isAnswerReady(health: IntelligenceHealth | null): boolean {
  return health?.status === "ready";
}

/** True when the property has at least one usable answer surface. */
export function hasAnyIntelligence(
  health: IntelligenceHealth | null,
): boolean {
  if (!health) return false;
  return (
    health.status === "ready" ||
    health.status === "degraded" ||
    health.status === "context_only_degraded"
  );
}

/**
 * Map an IntelligenceHealth into UI-facing copy. Centralized so the
 * wizard, the property intelligence section, and the export warning
 * banner all speak with one voice.
 */
export interface IntelligenceHealthCopy {
  tone: "success" | "warning" | "error";
  heading: string;
  detail: string;
  /** What the user should do next, if anything. */
  nextAction: string | null;
}

export function describeIntelligenceHealth(
  health: IntelligenceHealth | null,
  propertyName: string,
): IntelligenceHealthCopy {
  if (!health) {
    return {
      tone: "error",
      heading: "Training did not complete",
      detail: "We could not record an intelligence profile for this property.",
      nextAction: "Try retraining with a different document or URL.",
    };
  }
  switch (health.status) {
    case "ready":
      return {
        tone: "success",
        heading: `Your AI is now familiar with ${propertyName}.`,
        detail: `It learned ${health.field_count} fact${
          health.field_count === 1 ? "" : "s"
        } and indexed ${health.embedded_chunk_count} context chunk${
          health.embedded_chunk_count === 1 ? "" : "s"
        } for instant Q&A on your published tour.`,
        nextAction: null,
      };
    case "context_only_degraded":
      return {
        tone: "warning",
        heading: `${propertyName} is searchable but not yet trained.`,
        detail: `We indexed ${health.chunk_count} text chunk${
          health.chunk_count === 1 ? "" : "s"
        } from your source, but no structured facts were extracted. Visitors can still ask open questions, but the AI cannot answer specific facts (price, square footage, room counts) deterministically.`,
        nextAction:
          "Add a property doc that contains structured details, or expand your map fields.",
      };
    case "degraded":
      return {
        tone: "warning",
        heading: `${propertyName} is partially trained.`,
        detail: `It learned ${health.field_count} fact${
          health.field_count === 1 ? "" : "s"
        } but ${
          health.warnings[0] ?? "indexing is incomplete or evidence is thin"
        }.`,
        nextAction:
          "Review the warnings below; add a richer source to improve answer quality.",
      };
    case "failed":
    default:
      return {
        tone: "error",
        heading: `Training did not complete for ${propertyName}.`,
        detail:
          health.blocking_errors[0] ??
          "We could not extract any facts or context from your source.",
        nextAction: "Try a different document or URL, or contact support.",
      };
  }
}
