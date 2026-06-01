/**
 * Server functions for the public Atlas demo route.
 *
 * `listActiveAtlasDemoListings` reads ACTIVE rows from `atlas_demo_listings`
 * (RLS allows anonymous read of active rows only). It is resilient: if the table
 * doesn't exist yet (migration not applied) it returns an empty list rather than
 * throwing, so /atlas still renders a friendly empty state pre-activation.
 */
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import type { AtlasDemoListing } from "./atlas-demo-data";

const COLUMNS =
  "id,title,address,city,region,country,latitude,longitude,category,summary,presentation_url,hero_image_url,tags,is_active,sort_order,created_at,updated_at";

export const listActiveAtlasDemoListings = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ listings: AtlasDemoListing[]; error: string | null }> => {
    // New table is not in the generated Database types yet — cast (repo idiom).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as unknown as any;
    const { data, error } = await sb
      .from("atlas_demo_listings")
      .select(COLUMNS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      return { listings: [], error: error.message };
    }
    return { listings: (data ?? []) as AtlasDemoListing[], error: null };
  },
);
