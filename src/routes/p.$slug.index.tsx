import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";
import { checkDemoPublished } from "@/lib/sandbox-demo.functions";
import { Check, X, Link2, Palette, Download, Sparkles, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const fetchBrandingBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { data: branding, error } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (error || !branding) {
      return { branding: null, demoPublished: false, lusActive: false, vaultAssetCount: 0 };
    }

    const [demoCheck, licenseRes, vaultRes] = await Promise.all([
      checkDemoPublished({ data: { providerId: branding.provider_id } }),
      supabase.rpc("get_license_info", { user_uuid: branding.provider_id }),
      supabase
        .from("vault_templates")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", branding.provider_id)
        .eq("is_active", true),
    ]);

    let lusActive = false;
    const lic = licenseRes.data?.[0];
    if (lic && lic.license_status === "active") {
      if (!lic.license_expiry || new Date(lic.license_expiry).getTime() > Date.now()) {
        lusActive = true;
      }
    }

    return {
      branding,
      demoPublished: demoCheck.published,
      lusActive,
      vaultAssetCount: vaultRes.count ?? 0,
    };
  });

export const Route = createFileRoute("/p/$slug/")({
  head: () => ({
    meta: [
      { title: "3D Property Presentations" },
      { name: "description", content: "Create stunning 3D property tour presentations" },
    ],
  }),
  loader: async ({ params }) => {
    const result = await fetchBrandingBySlug({ data: { slug: params.slug } });
    return result;
  },
  component: PortalPage,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Portal Not Found</h1>
        <p className="mt-2 text-muted-foreground">This provider portal does not exist.</p>
      </div>
    </div>
  ),
});

function PortalPage() {
  const { branding, demoPublished, lusActive, vaultAssetCount } = Route.useLoaderData();
  const { slug } = Route.useParams();

  if (!branding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-foreground">Portal Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            This provider portal does not exist or hasn't been configured yet.
          </p>
        </div>
      </div>
    );
  }

  const accent = branding.accent_color || "#3B82F6";
  const isPro = branding.tier === "pro";
  const heroBgUrl =
    (branding as any).hero_bg_url ||
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2400&q=80";
  const heroBgOpacity =
    typeof (branding as any).hero_bg_opacity === "number"
      ? (branding as any).hero_bg_opacity
      : 0.45;

  // Build dynamic feature list
  const features: string[] = [
    "Custom branding (logo, color, contact)",
    "Music & tour behavior config",
    "Matterport Media Sync & Cinema Mode",
    "Google-Powered Neighborhood Map",
  ];
  if (lusActive) {
    features.push(
      "AI Property FAQ Concierge",
      "AI Lead Capture & Email Alerts",
      "Smart Doc Engine (PDF extractions)",
    );
  }
  if (isPro) {
    features.push(
      `Production Vault add-ons (${vaultAssetCount} curated plugin${vaultAssetCount === 1 ? "" : "s"} available)`,
      "Per-model pricing tiers",
      "Custom-domain hosting",
    );
  }

  const handleScrollTo = (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      {/* Notebook grid overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px)
          `,
          backgroundSize: "70px 70px",
        }}
      />

      {/* Accent-colored organic orbs (lower sections only) */}
      <div className="pointer-events-none fixed inset-0 top-[85vh] z-0 overflow-hidden">
        <div
          className="absolute -left-32 top-20 h-[500px] w-[500px] rounded-full blur-[160px]"
          style={{ background: `${accent}26` }}
        />
        <div
          className="absolute -right-20 top-[40%] h-[400px] w-[450px] rounded-full blur-[150px]"
          style={{ background: `${accent}1f` }}
        />
      </div>

      <div className="relative z-10">
        {/* Sticky glassmorphism header */}
        <PortalHeader
          branding={branding}
          slug={slug}
          accent={accent}
          hudBgColor={branding.hud_bg_color || "#0f172a"}
          demoPublished={demoPublished}
          onScrollTo={handleScrollTo}
        />

        {/* HERO STAGE — image-backed cinematic hero */}
        <section
          className="relative min-h-[85vh] w-full overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_70%,transparent_100%)]"
        >
          {/* Layer 0: bg image */}
          <img
            src={heroBgUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover object-center"
          />

          {/* Layer 1: dark dimming overlay (driven by hero_bg_opacity) */}
          <div
            className="absolute inset-0"
            style={{ backgroundColor: `rgba(0,0,0,${heroBgOpacity})` }}
          />

          {/* Layer 1b: subtle accent tint */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, ${accent}22 0%, transparent 60%)`,
            }}
          />

          {/* Layer 2: notebook grid overlay */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: `
                linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px),
                linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)
              `,
              backgroundSize: "70px 70px",
            }}
          />

          {/* Layer 4: content */}
          <div className="relative mx-auto flex min-h-[85vh] max-w-6xl flex-col items-center justify-center px-4 py-20 text-center sm:px-6 sm:py-28">
            {/* Brand chip */}
            <div className="mb-8 inline-flex items-center gap-3 rounded-full border border-white/30 bg-white/15 px-4 py-2 shadow-lg backdrop-blur-md">
              {branding.logo_url ? (
                <img
                  src={branding.logo_url}
                  alt={`${branding.brand_name} logo`}
                  className="h-7 w-7 rounded-full object-cover"
                />
              ) : (
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {branding.brand_name?.[0]?.toUpperCase() ?? "S"}
                </div>
              )}
              <span className="text-sm font-semibold text-white drop-shadow">
                {branding.brand_name} Studio
              </span>
            </div>

            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl md:text-6xl">
              Your Properties,{" "}
              <span style={{ color: accent }} className="drop-shadow-lg">
                Professionally Presented.
              </span>{" "}
              No Subscriptions.
            </h1>

            <p className="mt-6 max-w-2xl text-lg text-white/90 drop-shadow-md">
              Create a branded, multi-model HUD for your Matterport tours. Build for free, pay only
              when you're ready to download and host it anywhere.
            </p>

            <a
              href="#builder-start"
              onClick={handleScrollTo("builder-start")}
              className="mt-10 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
              style={{ backgroundColor: accent }}
            >
              <Sparkles className="size-5" />
              Start Building Your HUD
            </a>
          </div>
        </section>

        {/* 3-STEP ONBOARDING */}
        <section id="steps" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              Three steps to your branded presentation
            </h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Step 1 */}
            <div className="rounded-2xl border border-white/40 bg-white/60 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-slate-900/60">
              <StepBadge n={1} accent={accent} />
              <div className="mt-4 flex items-center gap-2 text-slate-900 dark:text-white">
                <Link2 className="size-5" style={{ color: accent }} />
                <h3 className="text-lg font-semibold">Paste your Model</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Drop in your Matterport URL(s). Single tour or a portfolio — your call.
              </p>
            </div>

            {/* Step 2 with nested capabilities */}
            <div className="rounded-2xl border border-white/40 bg-white/60 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-slate-900/60">
              <StepBadge n={2} accent={accent} />
              <div className="mt-4 flex items-center gap-2 text-slate-900 dark:text-white">
                <Palette className="size-5" style={{ color: accent }} />
                <h3 className="text-lg font-semibold">Design your HUD</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Add your logo, contact info, choose music, and toggle features like the AI
                Concierge and more.
              </p>

              {/* Nested green-bordered capabilities card */}
              <div className="mt-5 rounded-xl border-2 border-emerald-400/60 bg-emerald-50/70 p-4 dark:bg-emerald-950/30">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  What {branding.brand_name} Studio Includes
                </div>
                <ul className="mt-3 space-y-2">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {!lusActive && (
                  <p className="mt-3 text-xs italic text-slate-500 dark:text-slate-400">
                    Premium AI features currently unavailable.
                  </p>
                )}
              </div>
            </div>

            {/* Step 3 */}
            <div className="rounded-2xl border border-white/40 bg-white/60 p-6 shadow-sm backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-white/10 dark:bg-slate-900/60">
              <StepBadge n={3} accent={accent} />
              <div className="mt-4 flex items-center gap-2 text-slate-900 dark:text-white">
                <Download className="size-5" style={{ color: accent }} />
                <h3 className="text-lg font-semibold">Download & Own</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Preview your presentation. Once satisfied, make a one-time payment to get your
                self-contained file — no monthly fees to keep it online.
              </p>
            </div>
          </div>
        </section>

        {/* SOVEREIGNTY COMPARISON */}
        <section id="compare" className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              Stop renting. Start owning.
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
              Generic tours expire. {branding.brand_name} presentations are yours forever.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Generic */}
            <div className="rounded-2xl border border-slate-200 bg-white/60 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900/60">
              <h3 className="text-xl font-bold text-slate-500 dark:text-slate-400">
                Generic Matterport
              </h3>
              <ul className="mt-5 space-y-3">
                <ComparisonRow negative text="No branding — Matterport's logo, not yours" />
                <ComparisonRow negative text="Hosted links can expire or change" />
                <ComparisonRow negative text="No lead capture or instant alerts" />
                <ComparisonRow negative text="Ongoing subscription fees" />
              </ul>
            </div>

            {/* Brand */}
            <div
              className="rounded-2xl border-2 bg-white/70 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:shadow-xl dark:bg-slate-900/70"
              style={{ borderColor: accent }}
            >
              <h3 className="text-xl font-bold" style={{ color: accent }}>
                {branding.brand_name} Studio
              </h3>
              <ul className="mt-5 space-y-3">
                <ComparisonRow accent={accent} text="Full white-label — your brand, front and center" />
                <ComparisonRow accent={accent} text="You own the presentation file forever" />
                <ComparisonRow accent={accent} text="AI lead alerts straight to your inbox" />
                <ComparisonRow accent={accent} text="One-time payment per tour. No subscriptions." />
              </ul>
            </div>
          </div>
        </section>

        {/* BUILDER ANCHOR */}
        <section id="builder-start" className="scroll-mt-20 px-4 pb-8 pt-12 sm:px-6">
          <div className="mx-auto max-w-6xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              Studio Presentation Builder
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
              Configure your 3D experience below. Your progress is saved as you work.
            </p>
            <div
              className="mx-auto mt-6 h-1 w-24 rounded-full"
              style={{ backgroundColor: accent }}
            />
          </div>
        </section>

        <HudBuilderSandbox branding={branding} />
      </div>
    </div>
  );
}

function StepBadge({ n, accent }: { n: number; accent: string }) {
  return (
    <div
      className="flex h-10 w-10 items-center justify-center rounded-full text-base font-bold text-white shadow-md"
      style={{ backgroundColor: accent }}
    >
      {n}
    </div>
  );
}

function ComparisonRow({
  text,
  negative,
  accent,
}: {
  text: string;
  negative?: boolean;
  accent?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      {negative ? (
        <X className="mt-0.5 size-5 shrink-0 text-slate-400" />
      ) : (
        <Check className="mt-0.5 size-5 shrink-0" style={{ color: accent }} />
      )}
      <span
        className={
          negative
            ? "text-slate-500 line-through dark:text-slate-500"
            : "text-slate-800 dark:text-slate-100"
        }
      >
        {text}
      </span>
    </li>
  );
}

function PortalHeader({
  branding,
  slug,
  accent,
  demoPublished,
  onScrollTo,
}: {
  branding: { brand_name: string; logo_url: string | null };
  slug: string;
  accent: string;
  demoPublished: boolean;
  onScrollTo: (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const navLinks = [
    { id: "steps", label: "Steps" },
    { id: "compare", label: "Compare" },
    { id: "builder-start", label: "Builder" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/30 bg-white/40 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: enlarged brand pill */}
        <div className="flex h-11 items-center gap-3 rounded-full border border-white/40 bg-white/60 px-3 pr-4 shadow-sm backdrop-blur-md dark:border-white/10 dark:bg-slate-900/60">
          {branding.logo_url ? (
            <img
              src={branding.logo_url}
              alt={`${branding.brand_name} logo`}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: accent }}
            >
              {branding.brand_name?.[0]?.toUpperCase() ?? "S"}
            </div>
          )}
          <span className="text-base font-semibold text-slate-900 dark:text-white">
            <span className="hidden sm:inline">{branding.brand_name} Studio</span>
            <span className="sm:hidden">{branding.brand_name}</span>
          </span>
        </div>

        {/* Center: View Demo CTA (desktop only) */}
        <div className="hidden flex-1 justify-center sm:flex">
          {demoPublished && (
            <Link
              to="/p/$slug/demo"
              params={{ slug }}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white shadow-md transition-transform hover:scale-105"
              style={{ backgroundColor: accent }}
            >
              <Sparkles className="size-4" />
              View Demo →
            </Link>
          )}
        </div>

        {/* Right: section nav (desktop) */}
        <nav className="hidden items-center gap-6 sm:flex">
          {navLinks.map((link) => (
            <a
              key={link.id}
              href={`#${link.id}`}
              onClick={onScrollTo(link.id)}
              className="text-sm font-medium text-slate-700 transition-colors hover:opacity-80 dark:text-slate-200"
              style={{ color: undefined }}
              onMouseEnter={(e) => (e.currentTarget.style.color = accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = "")}
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Mobile: hamburger menu */}
        <Sheet>
          <SheetTrigger asChild>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-white/60 text-slate-900 shadow-sm backdrop-blur-md sm:hidden dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
              aria-label="Open menu"
            >
              <Menu className="size-5" />
            </button>
          </SheetTrigger>
          <SheetContent side="right" className="w-72">
            <SheetHeader>
              <SheetTitle>{branding.brand_name} Studio</SheetTitle>
            </SheetHeader>
            <div className="mt-6 flex flex-col gap-2">
              {demoPublished && (
                <Link
                  to="/p/$slug/demo"
                  params={{ slug }}
                  className="inline-flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white shadow-md"
                  style={{ backgroundColor: accent }}
                >
                  <Sparkles className="size-4" />
                  View Demo →
                </Link>
              )}
              {navLinks.map((link) => (
                <a
                  key={link.id}
                  href={`#${link.id}`}
                  onClick={onScrollTo(link.id)}
                  className="rounded-lg px-4 py-3 text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  {link.label}
                </a>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
