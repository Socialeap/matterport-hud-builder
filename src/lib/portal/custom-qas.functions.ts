/**
 * Custom Q&A management — Phase 3 of the Ask AI hardening plan.
 *
 * Custom Q&As are provider-authored question/answer pairs scoped to a
 * specific property within a saved presentation. They take precedence
 * over Gemini synthesis: if a visitor's question matches one of these
 * entries, the runtime returns the human-authored answer verbatim.
 *
 * Embeddings are intentionally not generated server-side here — the
 * runtime short-circuit relies on deterministic lexical matching, and
 * the `embedding` column on `custom_qas` is reserved for a future
 * semantic-match upgrade.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PROPERTY_UUID_SCHEMA = z.string().min(1).max(128);
const SAVED_MODEL_ID_SCHEMA = z.string().uuid();

const ListInput = z.object({
  savedModelId: SAVED_MODEL_ID_SCHEMA,
  propertyUuid: PROPERTY_UUID_SCHEMA.optional(),
});

const UpsertInput = z.object({
  id: z.string().uuid().optional(),
  savedModelId: SAVED_MODEL_ID_SCHEMA,
  propertyUuid: PROPERTY_UUID_SCHEMA,
  question: z.string().min(2).max(500),
  answer: z.string().min(2).max(2000),
});

const DeleteInput = z.object({
  id: z.string().uuid(),
});

export interface CustomQARow {
  id: string;
  saved_model_id: string;
  property_uuid: string;
  question: string;
  answer: string;
  created_at: string;
  updated_at: string;
}

export const listCustomQAs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("custom_qas")
      .select("id, saved_model_id, property_uuid, question, answer, created_at, updated_at")
      .eq("provider_id", userId)
      .eq("saved_model_id", data.savedModelId)
      .order("created_at", { ascending: false });
    if (data.propertyUuid) {
      query = query.eq("property_uuid", data.propertyUuid);
    }
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as CustomQARow[] };
  });

export const upsertCustomQA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UpsertInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const payload = {
      provider_id: userId,
      saved_model_id: data.savedModelId,
      property_uuid: data.propertyUuid,
      question: data.question.trim(),
      answer: data.answer.trim(),
      updated_at: new Date().toISOString(),
    } as const;
    if (data.id) {
      const { data: row, error } = await supabase
        .from("custom_qas")
        .update(payload)
        .eq("id", data.id)
        .eq("provider_id", userId)
        .select("id, saved_model_id, property_uuid, question, answer, created_at, updated_at")
        .single();
      if (error) throw new Error(error.message);
      return { row: row as CustomQARow };
    }
    const { data: row, error } = await supabase
      .from("custom_qas")
      .insert(payload)
      .select("id, saved_model_id, property_uuid, question, answer, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return { row: row as CustomQARow };
  });

export const deleteCustomQA = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("custom_qas")
      .delete()
      .eq("id", data.id)
      .eq("provider_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
