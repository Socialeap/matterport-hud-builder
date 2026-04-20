import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { getPublicDemoBySlug } from "@/lib/sandbox-demo.functions";
import { HudPreview } from "@/components/portal/HudPreview";
import { Button } from "@/components/ui/button";
import { DEFAULT_BEHAVIOR, DEFAULT_AGENT } from "@/components/portal/types";
import type { PropertyModel, AgentContact, TourBehavior } from "@/components/portal/types";
import { useState } from "react";
import { X } from "lucide-react";

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
  const [ctaDismissed, setCtaDismissed] = useState(false);

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
  if (typeof agent.avatarUrl === "string" && agent.avatarUrl.startsWith("blob:")) {
    agent.avatarUrl = "";
  }

  const safeBehaviors: Record<string, TourBehavior> = { ...behaviors };
  properties.forEach((p) => {
    if (!safeBehaviors[p.id]) safeBehaviors[p.id] = { ...DEFAULT_BEHAVIOR };
  });

  // Empty state — keep contained card layout
  if (properties.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="rounded-lg border-2 border-dashed p-12 text-center max-w-md">
          <h1 className="text-2xl font-bold text-foreground">{brandName}</h1>
          <p className="mt-3 text-muted-foreground">
            This Presentation has no properties configured yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      {/* Full-viewport Demo Portal — fills the screen edge to edge */}
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
        fullViewport={true}
      />

      {/* Slim bottom CTA strip — hidden on Pro tier (whitelabel) and after dismissal */}
      {!isPro && !ctaDismissed && (
        <div
          className="absolute inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2 text-xs text-white backdrop-blur-md sm:px-6"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
        >
          <span className="truncate">
            <span className="opacity-70">Powered by Transcendence Media — </span>
            <span className="font-medium">Want a Presentation like this?</span>
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Link to="/p/$slug" params={{ slug }}>
              <Button
                size="sm"
                className="h-7 px-3 text-xs text-white shadow-md"
                style={{ backgroundColor: accentColor }}
              >
                Build Your Own →
              </Button>
            </Link>
            <button
              onClick={() => setCtaDismissed(true)}
              aria-label="Dismiss"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
