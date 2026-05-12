import { createFileRoute, notFound } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { CallingCard, type CallingCardData } from "@/components/branding/CallingCard";
import { buildStudioUrl } from "@/lib/public-url";

interface CardLoaderData {
  brand_name: string;
  slug: string;
  logo_url: string | null;
  accent_color: string;
  tier: "starter" | "pro";
  custom_domain: string | null;
  calling_card_studio_name: string | null;
  calling_card_headline: string | null;
  calling_card_cta_label: string | null;
  calling_card_logo_url: string | null;
}

export const Route = createFileRoute("/card/$slug")({
  loader: async ({ params }) => {
    const { data, error } = await supabase
      .from("branding_settings")
      .select(
        "brand_name, slug, logo_url, accent_color, tier, custom_domain, calling_card_studio_name, calling_card_headline, calling_card_cta_label, calling_card_logo_url",
      )
      .eq("slug", params.slug)
      .maybeSingle();
    if (error || !data) throw notFound();
    return data as unknown as CardLoaderData;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.brand_name || "3D Presentation";
    return {
      meta: [
        { title: `${name} — Calling Card` },
        { name: "description", content: `Custom 3D presentations by ${name}.` },
        { property: "og:title", content: `${name} — Custom 3D Presentations` },
        { property: "og:description", content: `Interactive overlays with ${name}'s branding.` },
      ],
    };
  },
  component: CardPage,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-8 text-center">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Calling card not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          This studio link is no longer available.
        </p>
      </div>
    </div>
  ),
});

function CardPage() {
  const data = Route.useLoaderData();
  const studioUrl = buildStudioUrl(data.slug, {
    tier: data.tier,
    customDomain: data.custom_domain,
  });

  const cardData: CallingCardData = {
    brandName: data.brand_name || "Studio",
    studioName: data.calling_card_studio_name || data.brand_name || "our 3D Presentation",
    logoUrl: data.calling_card_logo_url || data.logo_url,
    accentColor: data.accent_color || "#2d6a4f",
    studioUrl,
  };

  // Tight, rounded, slightly-translucent container so the card hugs the
  // iframe edges with a soft 90%-opacity halo around the corners.
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-transparent p-0">
      <div
        className="w-full overflow-hidden rounded-[18px] bg-white/90 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]"
        style={{ aspectRatio: "1920 / 1065" }}
      >
        <CallingCard data={cardData} />
      </div>
    </div>
  );
}
