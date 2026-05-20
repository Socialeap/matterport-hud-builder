/**
 * Agent profile server functions — reusable client-side identity data
 * (name, role, company, phone, social links, etc.) shared across every
 * MSP studio the agent uses.
 *
 * All functions run as the authenticated user and rely on the existing
 * RLS policies on `public.profiles` and `public.saved_models` to scope
 * reads/writes correctly.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SocialLinksSchema = z
  .object({
    linkedin: z.string().max(500).optional().default(""),
    twitter: z.string().max(500).optional().default(""),
    instagram: z.string().max(500).optional().default(""),
    facebook: z.string().max(500).optional().default(""),
    tiktok: z.string().max(500).optional().default(""),
    other: z.string().max(500).optional().default(""),
    website: z.string().max(500).optional().default(""),
  })
  .partial();

const ProfileUpdateSchema = z.object({
  display_name: z.string().max(200).optional().nullable(),
  title_role: z.string().max(200).optional().nullable(),
  company: z.string().max(200).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  welcome_note: z.string().max(2000).optional().nullable(),
  social_links: SocialLinksSchema.optional(),
  ga_tracking_id: z.string().max(50).optional().nullable(),
  avatar_url: z.string().max(2000).optional().nullable(),
  logo_url: z.string().max(2000).optional().nullable(),
  favicon_url: z.string().max(2000).optional().nullable(),
});

export type AgentProfileInput = z.infer<typeof ProfileUpdateSchema>;

export const getMyAgentProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "user_id, display_name, avatar_url, title_role, company, phone, welcome_note, social_links, ga_tracking_id, logo_url, favicon_url"
      )
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { profile: data };
  });

export const updateMyAgentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ProfileUpdateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ensure a profile row exists (handle_new_user trigger should have made
    // one already, but upsert defensively for safety).
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          user_id: userId,
          ...data,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

interface HistoryRow {
  id: string;
  name: string;
  primaryProperty: string;
  brandName: string;
  brandSlug: string | null;
  amountCents: number;
  isFree: boolean;
  status: string;
  downloadedAt: string;
}

export const getMyAgentHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: models, error } = await supabase
      .from("saved_models")
      .select("id, name, properties, amount_cents, status, is_released, updated_at, provider_id")
      .eq("client_id", userId)
      .or("is_released.eq.true,status.eq.paid")
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    const providerIds = Array.from(new Set((models ?? []).map((m) => m.provider_id).filter(Boolean)));
    const brandByProvider = new Map<string, { name: string; slug: string | null }>();

    if (providerIds.length > 0) {
      const { data: brands } = await supabase
        .from("branding_settings")
        .select("provider_id, brand_name, slug")
        .in("provider_id", providerIds);
      for (const b of brands ?? []) {
        brandByProvider.set(b.provider_id, { name: b.brand_name || "", slug: b.slug });
      }
    }

    const rows: HistoryRow[] = (models ?? []).map((m) => {
      const props = Array.isArray(m.properties) ? (m.properties as Array<Record<string, unknown>>) : [];
      const primary =
        (props[0]?.name as string | undefined)?.trim() ||
        (props[0]?.label as string | undefined)?.trim() ||
        m.name ||
        "Untitled property";
      const brand = brandByProvider.get(m.provider_id) ?? { name: "Unknown studio", slug: null };
      const amountCents = m.amount_cents ?? 0;
      return {
        id: m.id,
        name: m.name,
        primaryProperty: primary,
        brandName: brand.name || "Unknown studio",
        brandSlug: brand.slug,
        amountCents,
        isFree: amountCents === 0,
        status: m.status,
        downloadedAt: m.updated_at,
      };
    });

    return { rows };
  });
