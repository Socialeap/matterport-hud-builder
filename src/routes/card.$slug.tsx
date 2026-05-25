import { createFileRoute, notFound } from "@tanstack/react-router";
import { fetchPublicBrandingBySlug } from "@/lib/public-portal.functions";
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
    const { branding } = await fetchPublicBrandingBySlug({ data: { slug: params.slug } });
    if (!branding) throw notFound();
    return branding as unknown as CardLoaderData;
  },

  head: ({ params, loaderData }) => {
    const name = loaderData?.brand_name || "3D Presentation";
    const url = `https://3dps.transcendencemedia.com/card/${params.slug}`;
    return {
      meta: [
        { title: `${name} — Calling Card` },
        { name: "description", content: `Custom 3D presentations by ${name}.` },
        { property: "og:title", content: `${name} — Custom 3D Presentations` },
        { property: "og:description", content: `Interactive overlays with ${name}'s branding.` },
        { property: "og:url", content: url },
        { property: "og:type", content: "website" },
      ],
      links: [{ rel: "canonical", href: url }],
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
        className="relative w-full overflow-hidden rounded-[14px] bg-white/90 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)]"
        style={{ aspectRatio: "1920 / 1065" }}
      >
        <CallingCard data={cardData} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[14px] border border-white/20"
          style={{ boxShadow: "inset 0 0 30px rgba(0,0,0,0.15)" }}
        />
      </div>
    </div>
  );
}
