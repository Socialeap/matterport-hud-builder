/**
 * Public, anon-reachable reads of `branding_settings` by slug.
 *
 * The base table no longer has a permissive anon SELECT policy (it used
 * to expose Stripe Connect IDs, payout fees, and the directory contact
 * email to anyone with a slug). These server fns run server-side with
 * `supabaseAdmin` (service role, bypasses RLS) and return a sanitized
 * projection: sensitive fields are masked or stripped before the row
 * crosses back to the browser.
 *
 * Keep this file as the SINGLE entry point for public branding lookups
 * so the sanitization stays in one place.
 */
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables } from "@/integrations/supabase/types";

type BrandingRow = Tables<"branding_settings">;

export type PublicBranding = Omit<
  BrandingRow,
  "service_center" | "service_polygon"
>;

function sanitizePublicBranding(
  row: BrandingRow & { service_center?: unknown; service_polygon?: unknown },
): PublicBranding {
  const {
    service_center: _sc,
    service_polygon: _sp,
    stripe_connect_id,
    instant_payout_fee_bps: _ipf,
    directory_contact_email: _dce,
    ...rest
  } = row;
  void _sc; void _sp; void _ipf; void _dce;
  return {
    ...rest,
    stripe_connect_id: stripe_connect_id ? "connected" : null,
    instant_payout_fee_bps: 0,
    directory_contact_email: null,
  } as PublicBranding;
}

export const fetchPublicBrandingBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }): Promise<{ branding: PublicBranding | null }> => {
    const { data: branding, error } = await supabaseAdmin
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();
    if (error || !branding) return { branding: null };
    return { branding: sanitizePublicBranding(branding as BrandingRow) };
  });

