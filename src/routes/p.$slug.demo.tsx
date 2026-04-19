import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getPublicDemoBySlug } from "@/lib/sandbox-demo.functions";
import { HudPreview } from "@/components/portal/HudPreview";
import { Button } from "@/components/ui/button";
import { DEFAULT_BEHAVIOR, DEFAULT_AGENT } from "@/components/portal/types";
import type { PropertyModel, AgentContact, TourBehavior } from "@/components/portal/types";
import { useState } from "react";

export const Route = createFileRoute("/p/$slug/demo")({
  head: () => ({
    meta: [
      { title: "Live 3D Property Presentation" },
      { name: "description", content: "Explore an interactive, fully-branded 3D property presentation." },
      { property: "og:title", content: "Live 3D Property Presentation" },
      { property: "og:description", content: "Interactive, branded 3D property presentation." },
    ],
  }),
  loader: async ({ params }) => {
    const result = await getPublicDemoBySlug({ data: { slug: params.slug } });
    return result;
  },
  component: PublicDemoPage,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => router.invalidate()} className="mt-4">Retry</Button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Presentation Not Found</h1>
        <p className="mt-2 text-muted-foreground">This Presentation isn't available.</p>
      </div>
    </div>
  ),
});

function PublicDemoPage() {
  const { branding, demo } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [selectedModelIndex, setSelectedModelIndex] = useState(0);

  if (!branding || !demo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center max-w-md">
          <h1 className="text-3xl font-bold text-foreground">No Live Presentation Yet</h1>
          <p className="mt-2 text-muted-foreground">
            This Studio hasn't published a Presentation yet. Visit the main builder to start your own.
          </p>
          {branding?.slug && (
            <Link to="/p/$slug" params={{ slug }}>
              <Button className="mt-4">Go to Studio</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Merge brand overrides on top of branding defaults
  const brandOverrides = (demo.brand_overrides ?? {}) as {
    brandName?: string;
    accentColor?: string;
    hudBgColor?: string;
    gateLabel?: string;
    logoUrl?: string | null;
  };
  const brandName = brandOverrides.brandName || branding.brand_name;
  const accentColor = brandOverrides.accentColor || branding.accent_color;
  const hudBgColor = brandOverrides.hudBgColor || branding.hud_bg_color;
  // Coerce stale blob: URLs (saved before storage upload was wired) to null so brand name fallback renders.
  const rawLogo = brandOverrides.logoUrl ?? branding.logo_url;
  if (typeof rawLogo === "string" && rawLogo.startsWith("blob:")) {
    console.warn("[demo] Ignoring stale blob: logo URL in brand_overrides");
  }
  const logoPreview =
    typeof rawLogo === "string" && rawLogo.startsWith("blob:") ? null : rawLogo;
  const isPro = branding.tier === "pro";

  const properties = ((demo.properties as unknown) ?? []) as PropertyModel[];
  const behaviors = ((demo.behaviors as unknown) ?? {}) as Record<string, TourBehavior>;
  const agent = { ...DEFAULT_AGENT, ...(((demo.agent as unknown) ?? {}) as Partial<AgentContact>) };
  // Defensive: clear stale blob: avatar URLs that should never have been persisted.
  if (typeof agent.avatarUrl === "string" && agent.avatarUrl.startsWith("blob:")) {
    agent.avatarUrl = "";
  }

  // Ensure every property has a behavior entry
  const safeBehaviors: Record<string, TourBehavior> = { ...behaviors };
  properties.forEach((p) => {
    if (!safeBehaviors[p.id]) safeBehaviors[p.id] = { ...DEFAULT_BEHAVIOR };
  });

  return (
    <div
      className="min-h-screen bg-background"
      style={{
        backgroundImage: `radial-gradient(ellipse at top, ${accentColor}14, transparent 60%)`,
      }}
    >
      {/* Cinematic brand header */}
      <header
        className="border-b backdrop-blur-sm"
        style={{
          borderColor: `${accentColor}33`,
          backgroundColor: `${hudBgColor}cc`,
        }}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            {logoPreview && (
              <img src={logoPreview} alt={`${brandName} logo`} className="h-10 object-contain" />
            )}
            <span className="text-xl font-bold tracking-tight text-white">{brandName}</span>
          </div>
          <span
            className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow-sm"
            style={{ backgroundColor: accentColor }}
          >
            ● Live
          </span>
        </div>
      </header>

      {/* Centered cinematic HUD */}
      <main className="mx-auto max-w-7xl px-4 py-10">
        {properties.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed p-12 text-center">
            <p className="text-muted-foreground">This Presentation has no properties configured yet.</p>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                A Live 3D Property Presentation by
              </p>
              <p
                className="mt-1 text-2xl font-bold sm:text-3xl"
                style={{ color: accentColor }}
              >
                {brandName}
              </p>
            </div>

            <HudPreview
              models={properties}
              selectedModelIndex={selectedModelIndex}
              onSelectModel={setSelectedModelIndex}
              behaviors={safeBehaviors}
              brandName={brandName}
              accentColor={accentColor}
              hudBgColor={hudBgColor}
              logoPreview={logoPreview}
              agent={agent}
              isPro={isPro}
              defaultHeaderVisible={true}
            />
          </>
        )}

        {/* Bottom CTA only — no top duplicate */}
        <div
          className="mt-10 rounded-xl border-2 p-8 text-center"
          style={{
            borderColor: accentColor,
            backgroundImage: `linear-gradient(135deg, ${accentColor}10, transparent)`,
          }}
        >
          <h2 className="text-2xl font-bold text-foreground">Want a Presentation like this?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Build your own branded 3D property Presentation in minutes.
          </p>
          <Link to="/p/$slug" params={{ slug }}>
            <Button size="lg" className="mt-5 text-white shadow-lg" style={{ backgroundColor: accentColor }}>
              Build Your Own →
            </Button>
          </Link>
        </div>

        {!isPro && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Powered by Transcendence Media
          </p>
        )}
      </main>
    </div>
  );
}
