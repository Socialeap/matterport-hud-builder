/**
 * Server functions for the "Sandbox as Public Demo" feature.
 *
 * - getSandboxDemo: provider loads their own demo (auth-scoped).
 * - saveSandboxDemo: provider upserts their canonical demo config.
 * - publishSandboxDemo: provider toggles is_published flag.
 * - getPublicDemoBySlug: anonymous read of a published demo via brand slug.
 *
 * Publishing requires an active LUS license; we enforce this server-side
 * by checking get_license_info() for the provider before flipping the
 * is_published flag.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

interface SandboxDemoPayload {
  brand_overrides: {
    brandName?: string;
    accentColor?: string;
    hudBgColor?: string;
    gateLabel?: string;
    logoUrl?: string | null;
  };
  properties: unknown[];
  behaviors: Record<string, unknown>;
  agent: Record<string, unknown>;
}

export const getSandboxDemo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("sandbox_demos")
      .select("*")
      .eq("provider_id", userId)
      .maybeSingle();
    if (error) {
      return { demo: null, error: error.message };
    }
    return { demo: data, error: null };
  });

export const saveSandboxDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SandboxDemoPayload) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("sandbox_demos")
      .select("id, is_published")
      .eq("provider_id", userId)
      .maybeSingle();

    const payload = {
      provider_id: userId,
      brand_overrides: data.brand_overrides as unknown as Json,
      properties: data.properties as unknown as Json,
      behaviors: data.behaviors as unknown as Json,
      agent: data.agent as unknown as Json,
    };

    if (existing) {
      const { error } = await supabase
        .from("sandbox_demos")
        .update(payload)
        .eq("provider_id", userId);
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await supabase.from("sandbox_demos").insert(payload);
      if (error) return { success: false, error: error.message };
    }
    return { success: true, error: null };
  });

export const publishSandboxDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { publish: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // If trying to publish, enforce active LUS license
    if (data.publish) {
      const { data: license } = await supabase.rpc("get_license_info", {
        user_uuid: userId,
      });
      const row = license?.[0];
      const isActive =
        row?.license_status === "active" &&
        (!row.license_expiry || new Date(row.license_expiry).getTime() > Date.now());
      if (!isActive) {
        return {
          success: false,
          error: "Publishing requires an active LUS license. Please renew to publish your demo.",
        };
      }
    }

    const { error } = await supabase
      .from("sandbox_demos")
      .update({ is_published: data.publish })
      .eq("provider_id", userId);
    if (error) return { success: false, error: error.message };
    return { success: true, error: null };
  });

/**
 * Public read by slug — uses admin client so anonymous visitors can fetch
 * the demo without an auth token. Only returns rows where is_published=true.
 */
export const getPublicDemoBySlug = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => input)
  .handler(async ({ data }) => {
    const { data: branding } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (!branding) return { branding: null, demo: null };

    const { data: demo } = await supabase
      .from("sandbox_demos")
      .select("*")
      .eq("provider_id", branding.provider_id)
      .eq("is_published", true)
      .maybeSingle();

    return { branding, demo };
  });

/**
 * Lightweight check used on /p/$slug to decide whether to surface the
 * "View Live Demo" CTA. Returns boolean only — no payload.
 */
export const checkDemoPublished = createServerFn({ method: "GET" })
  .inputValidator((input: { providerId: string }) => input)
  .handler(async ({ data }) => {
    const { data: row } = await supabase
      .from("sandbox_demos")
      .select("id")
      .eq("provider_id", data.providerId)
      .eq("is_published", true)
      .maybeSingle();
    return { published: !!row };
  });
