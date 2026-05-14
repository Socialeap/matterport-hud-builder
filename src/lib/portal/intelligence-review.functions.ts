/**
 * Phase 1 — Intelligence Review server functions.
 *
 * Candidate fields are produced by the Groq cleaner during extraction
 * but were not confident enough for auto-promotion into `fields`.
 * Providers review them here: approve (with optional edit) moves the
 * value into `fields` and drops it from `candidate_fields`; discard
 * just drops it. All writes go through the authenticated supabase
 * client so RLS scopes them to the owning provider.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PROPERTY_UUID = z.string().min(1).max(128);

const ListInput = z.object({
  propertyUuid: PROPERTY_UUID,
});

const ReviewInput = z.object({
  extractionId: z.string().uuid(),
  index: z.number().int().min(0),
  key: z.string().min(1).max(200),
  action: z.enum(["approve", "discard"]),
  // Optional edited value used when action === "approve". Free-form;
  // the underlying field is JSONB so we accept any JSON-safe primitive
  // or container.
  value: z.unknown().optional(),
});

export interface CandidateField {
  key: string;
  value: unknown;
  confidence: number;
  evidence?: string;
}

export interface CandidateExtractionRow {
  extractionId: string;
  vault_asset_id: string;
  template_id: string;
  template_label: string;
  extracted_at: string;
  candidates: CandidateField[];
}

function coerceCandidates(raw: unknown): CandidateField[] {
  if (!Array.isArray(raw)) return [];
  const out: CandidateField[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    if (typeof obj.key !== "string" || obj.key.length === 0) continue;
    out.push({
      key: obj.key,
      value: obj.value,
      confidence:
        typeof obj.confidence === "number" ? obj.confidence : 0,
      evidence:
        typeof obj.evidence === "string" ? obj.evidence : undefined,
    });
  }
  return out;
}

export const listIntelligenceCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("property_extractions")
      .select(
        "id, vault_asset_id, template_id, extracted_at, candidate_fields",
      )
      .eq("property_uuid", data.propertyUuid)
      .order("extracted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const templateIds = Array.from(
      new Set((rows ?? []).map((r) => String(r.template_id))),
    );
    const labelByTemplate: Record<string, string> = {};
    if (templateIds.length > 0) {
      const { data: templates } = await supabase
        .from("vault_templates")
        .select("id, label, doc_kind")
        .in("id", templateIds);
      for (const t of templates ?? []) {
        labelByTemplate[String(t.id)] =
          String(t.label ?? "") || String(t.doc_kind ?? "Document");
      }
    }

    const out: CandidateExtractionRow[] = [];
    for (const row of rows ?? []) {
      const candidates = coerceCandidates(
        (row as { candidate_fields?: unknown }).candidate_fields,
      );
      if (candidates.length === 0) continue;
      out.push({
        extractionId: String(row.id),
        vault_asset_id: String(row.vault_asset_id),
        template_id: String(row.template_id),
        template_label: labelByTemplate[String(row.template_id)] || "Document",
        extracted_at: String(row.extracted_at ?? ""),
        candidates,
      });
    }
    return { rows: out };
  });

export const reviewIntelligenceCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ReviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Read-modify-write. RLS guarantees we only touch rows this provider owns.
    const { data: row, error: readErr } = await supabase
      .from("property_extractions")
      .select("id, fields, candidate_fields")
      .eq("id", data.extractionId)
      .single();
    if (readErr || !row) {
      throw new Error(readErr?.message ?? "Extraction not found");
    }

    const candidates = coerceCandidates(
      (row as { candidate_fields?: unknown }).candidate_fields,
    );
    const fields = {
      ...(((row as { fields?: unknown }).fields as Record<string, unknown>) ?? {}),
    };

    // Locate the candidate. Prefer the supplied index if it still
    // points at the same key; otherwise fall back to the first
    // candidate with a matching key. This makes the call resilient to
    // concurrent reviews on the same row.
    let target = candidates[data.index];
    if (!target || target.key !== data.key) {
      target = candidates.find((c) => c.key === data.key) as
        | CandidateField
        | undefined;
    }
    if (!target) {
      // Already reviewed by a parallel call — treat as a no-op success.
      return { ok: true, alreadyReviewed: true } as const;
    }

    const nextCandidates = candidates.filter((c) => c !== target);

    if (data.action === "approve") {
      const value =
        typeof data.value !== "undefined" ? data.value : target.value;
      fields[target.key] = value;
    }

    const { error: writeErr } = await supabase
      .from("property_extractions")
      .update({
        fields,
        candidate_fields: nextCandidates.length > 0 ? nextCandidates : null,
      })
      .eq("id", data.extractionId);
    if (writeErr) throw new Error(writeErr.message);

    return { ok: true, alreadyReviewed: false } as const;
  });
