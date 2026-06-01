/**
 * Server functions for the Frontiers3D Atlas (`atlas_entries`).
 *
 * - `listActiveAtlasEntries`: public read of active listings (anon-friendly).
 * - `listMyAtlasEntries`:     owner reads all their own submissions.
 * - `submitAtlasClientEntry`: owner upserts a pending_review client entry.
 * - `withdrawForEdit`:        owner pulls an active listing back to pending_review
 *                              via the SECURITY DEFINER RPC (RLS would otherwise
 *                              block editing live rows).
 * - `deleteMyAtlasEntry`:     owner deletes their own pending/inactive/rejected entry.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AtlasEntry } from "./atlas-demo-data";

const HTTPS_URL_RE = /^https:\/\/[^\s<>"']+$/i;
const FORBIDDEN_URL_RE = /^(javascript|data|vbscript|file|about):/i;

/** Strict URL validator: https only, length-capped, blocks javascript:/data:/etc. */
const httpsUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .regex(HTTPS_URL_RE, "Must be an https:// URL")
  .refine((u) => !FORBIDDEN_URL_RE.test(u), "URL scheme not allowed");

const optionalHttpsUrl = z
  .union([httpsUrl, z.literal("")])
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const optionalShortText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal("")])
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null));

/** Shared input schema for client submission + admin save. */
export const atlasEntryInput = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  summary: optionalShortText(600),
  category: z.string().trim().min(1).max(40),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  hero_image_url: optionalHttpsUrl,
  presentation_url: httpsUrl,
  address: optionalShortText(200),
  city: optionalShortText(120),
  region: optionalShortText(120),
  country: z
    .union([z.string().trim().min(2).max(2), z.literal("")])
    .optional()
    .transform((v) => (v && v.length > 0 ? v.toUpperCase() : "US")),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  saved_model_id: z.string().uuid().nullable().optional(),
});

export type AtlasEntryInput = z.infer<typeof atlasEntryInput>;

const COLUMNS =
  "id,kind,status,is_active,title,summary,hero_image_url,category,tags,sort_order,address,city,region,country,latitude,longitude,presentation_url,saved_model_id,owner_user_id,submitted_at,reviewed_at,reviewed_by,rejection_reason,created_at,updated_at";

// ── Public read ──────────────────────────────────────────────────────────────

export const listActiveAtlasEntries = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ entries: AtlasEntry[]; error: string | null }> => {
    // atlas_entries isn't in the generated types yet — cast (repo idiom).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as any;
    const { data, error } = await sb
      .from("atlas_entries")
      .select(COLUMNS)
      .eq("status", "active")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) return { entries: [], error: error.message };
    return { entries: (data ?? []) as AtlasEntry[], error: null };
  },
);

// ── Owner reads ──────────────────────────────────────────────────────────────

export const listMyAtlasEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ entries: AtlasEntry[] }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as unknown as any;
    const { data, error } = await sb
      .from("atlas_entries")
      .select(COLUMNS)
      .eq("owner_user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { entries: (data ?? []) as AtlasEntry[] };
  });

// ── Owner upsert ─────────────────────────────────────────────────────────────

export const submitAtlasClientEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => atlasEntryInput.parse(input))
  .handler(async ({ data, context }): Promise<{ entry: AtlasEntry }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as unknown as any;

    const nowIso = new Date().toISOString();
    const payload = {
      kind: "client_submitted" as const,
      status: "pending_review" as const,
      owner_user_id: context.userId,
      submitted_at: nowIso,
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
      title: data.title,
      summary: data.summary,
      category: data.category,
      tags: data.tags,
      hero_image_url: data.hero_image_url,
      presentation_url: data.presentation_url,
      address: data.address,
      city: data.city,
      region: data.region,
      country: data.country,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      saved_model_id: data.saved_model_id ?? null,
    };

    // Find any existing client_submitted row for this owner, keyed by
    // saved_model_id when present, otherwise by presentation_url.
    let existingQuery = sb
      .from("atlas_entries")
      .select("id,status")
      .eq("owner_user_id", context.userId)
      .eq("kind", "client_submitted");
    existingQuery = data.saved_model_id
      ? existingQuery.eq("saved_model_id", data.saved_model_id)
      : existingQuery
          .is("saved_model_id", null)
          .eq("presentation_url", data.presentation_url);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      // RLS blocks owner edits to active rows — withdraw first, then update.
      if (existing.status === "active") {
        const { error: wErr } = await sb.rpc("atlas_entry_owner_withdraw", {
          _id: existing.id,
        });
        if (wErr) throw new Error(wErr.message);
      }
      const { data: updated, error } = await sb
        .from("atlas_entries")
        .update(payload)
        .eq("id", existing.id)
        .select(COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return { entry: updated as AtlasEntry };
    }

    const { data: inserted, error } = await sb
      .from("atlas_entries")
      .insert(payload)
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return { entry: inserted as AtlasEntry };
  });

// ── Owner withdraw (active → pending_review) ─────────────────────────────────

export const withdrawForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as unknown as any;
    const { error } = await sb.rpc("atlas_entry_owner_withdraw", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Owner delete (only their own, non-active rows) ──────────────────────────

export const deleteMyAtlasEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as unknown as any;
    const { error } = await sb
      .from("atlas_entries")
      .delete()
      .eq("id", data.id)
      .eq("owner_user_id", context.userId)
      .eq("kind", "client_submitted");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
