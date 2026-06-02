/**
 * Server functions for the Frontiers3D Atlas (`atlas_entries`).
 *
 * - `listActiveAtlasEntries`:   public read of active listings (anon-friendly).
 * - `listMyAtlasEntries`:       owner reads all their own submissions.
 * - `verifyAndSubmitAtlasEntry`: verification-first submit — fetches the live
 *                                URL's `atlas-manifest.json` (SSRF-safe), verifies
 *                                the opaque `atlas_v1` token belongs to the caller,
 *                                and ONLY then activates the entry. No verified
 *                                token → no row is created.
 * - `withdrawForEdit`:          owner pulls an active listing back to pending_review
 *                                via the SECURITY DEFINER RPC (RLS would otherwise
 *                                block editing live rows).
 * - `deleteMyAtlasEntry`:       owner deletes their own pending/inactive/rejected entry.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AtlasEntry, AtlasVerifyState } from "./atlas-demo-data";

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

// ── Verification ─────────────────────────────────────────────────────────────

/** Shared user-facing copy per verification state (submit success copy differs). */
const VERIFY_MESSAGES: Record<AtlasVerifyState, string> = {
  verified:
    "Verified. This published presentation has a valid Frontiers3D Atlas manifest.",
  missing_manifest:
    "Unverified: no valid Frontiers3D Atlas manifest was found at this URL.",
  token_mismatch:
    "Unverified. This published URL does not contain a valid Frontiers3D Atlas manifest.",
  unverified:
    "Unverified: this published presentation belongs to a different account.",
  fetch_failed:
    "We couldn't reach that URL to verify it. Make sure the presentation is published and publicly reachable over https, then try again.",
};

export interface AtlasVerifyCheckResponse {
  result: AtlasVerifyState;
  verified: boolean;
  message: string;
}

/**
 * Verify-only pre-check: fetch + verify the manifest at the pasted URL WITHOUT
 * creating a row and WITHOUT requiring listing fields. Gates the UI so the
 * listing form only opens after the URL is confirmed. Purely a UX gate — the
 * final submit re-verifies server-side, so this never grants anything on its own.
 */
export const verifyAtlasUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ presentation_url: httpsUrl }).parse(input))
  .handler(async ({ data, context }): Promise<AtlasVerifyCheckResponse> => {
    const verify = await import("./atlas-verify-server");
    const { state } = await verify.runAtlasVerification(
      data.presentation_url,
      context.userId,
    );
    return {
      result: state,
      verified: state === "verified",
      message: VERIFY_MESSAGES[state],
    };
  });

// ── Verification-first submit ────────────────────────────────────────────────

export interface AtlasVerifyResponse {
  result: AtlasVerifyState;
  entry: AtlasEntry | null;
  message: string;
}

/**
 * Verification-first Atlas submission. Re-verifies the manifest server-side
 * (even when the UI already pre-checked via `verifyAtlasUrl`) and ONLY on
 * success activates the entry. An unverified URL never creates a row. All
 * server-only logic (node:dns, crypto, service-role) lives in the
 * dynamically-imported `atlas-verify-server` so it stays out of the client.
 */
export const verifyAndSubmitAtlasEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => atlasEntryInput.parse(input))
  .handler(async ({ data, context }): Promise<AtlasVerifyResponse> => {
    const verify = await import("./atlas-verify-server");
    const { state, savedModelId } = await verify.runAtlasVerification(
      data.presentation_url,
      context.userId,
    );
    if (state !== "verified" || !savedModelId) {
      return { result: state, entry: null, message: VERIFY_MESSAGES[state] };
    }

    const entry = await verify.activateVerifiedEntry({
      ownerUserId: context.userId,
      savedModelId,
      presentationUrl: data.presentation_url,
      fields: {
        title: data.title,
        summary: data.summary,
        category: data.category,
        tags: data.tags,
        hero_image_url: data.hero_image_url,
        address: data.address,
        city: data.city,
        region: data.region,
        country: data.country,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
      },
    });

    return {
      result: "verified",
      entry,
      message: "Verified. Your Atlas listing is ready for the public Atlas.",
    };
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
