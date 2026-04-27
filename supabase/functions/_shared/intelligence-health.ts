/**
 * Deno-side mirror of `src/lib/intelligence/health.ts`. Logic must
 * stay in lockstep — the parity test in
 * `tests/intelligence-health-parity.test.ts` enforces this.
 *
 * Why duplicated: Supabase edge functions resolve imports from
 * `supabase/functions/_shared/*` and cannot reach into `src/lib/*`.
 * The module is intentionally dependency-free so a parity test can
 * compare AST-equivalent output for matched inputs.
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
  answerability_score: number;
  warnings: string[];
  blocking_errors: string[];
  source_asset_id: string | null;
  property_uuid: string | null;
  saved_model_id: string | null;
  updated_at: string;
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
  answerability_score?: number;
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
    status = chunk_count > 0 ? "context_only_degraded" : "failed";
  } else if (embedded_chunk_count === 0 && chunk_count > 0) {
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
    typeof v.updated_at === "string"
      ? v.updated_at
      : new Date().toISOString();
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

export function isAnswerReady(health: IntelligenceHealth | null): boolean {
  return health?.status === "ready";
}

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
