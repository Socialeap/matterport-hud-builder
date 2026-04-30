import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkDemoPublished } from "@/lib/sandbox-demo.functions";
import { Check, X, Link2, Palette, Download, Sparkles, Menu, LogIn, LogOut } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { PortalSignupModal } from "@/components/portal/PortalSignupModal";
import { toast } from "sonner";


const fetchBrandingBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { data: branding, error } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (error || !branding) {
      return { branding: null, demoPublished: false, lusActive: false, vaultAssetCount: 0, providerActive: false };
    }

    const [demoCheck, licenseRes, vaultRes, paidLicenseRes, paidPurchaseRes, grantRes] = await Promise.all([
      checkDemoPublished({ data: { providerId: branding.provider_id } }),
      supabase.rpc("get_license_info", { user_uuid: branding.provider_id }),
      supabase
        .from("vault_templates")
        .select("id", { count: "exact", head: true })
        .eq("provider_id", branding.provider_id)
        .eq("is_active", true),
      supabase
        .from("licenses")
        .select("id")
        .eq("user_id", branding.provider_id)
        .limit(1),
      supabase
        .from("purchases")
        .select("id")
        .eq("user_id", branding.provider_id)
        .eq("status", "completed")
        .limit(1),
      supabase
        .from("admin_grants")
        .select("id")
        .eq("provider_id", branding.provider_id)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .limit(1),
    ]);

    let lusActive = false;
    const lic = licenseRes.data?.[0];
    if (lic && lic.license_status === "active") {
      if (!lic.license_expiry || new Date(lic.license_expiry).getTime() > Date.now()) {
        lusActive = true;
      }
    }

    const providerActive =
      (paidLicenseRes.data?.length ?? 0) > 0 ||
      (paidPurchaseRes.data?.length ?? 0) > 0 ||
      (grantRes.data?.length ?? 0) > 0;

    return {
      branding,
      demoPublished: demoCheck.published,
      lusActive,
      vaultAssetCount: vaultRes.count ?? 0,
      providerActive,
    };
  });

const recordPageVisit = createServerFn({ method: "POST" })
  .inputValidator((data: { providerId: string; slug: string; referrer: string | null; userAgent: string | null }) => data)
  .handler(async ({ data }) => {
    await supabase.from("page_visits").insert({
      provider_id: data.providerId,
      slug: data.slug,
      referrer: data.referrer,
      user_agent: data.userAgent,
    });
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
        <h1 className="text-4xl font-bold text-foreground">Studio Not Found</h1>
        <p className="mt-2 text-muted-foreground">This provider's Studio does not exist.</p>
      </div>
    </div>
  ),
});

function PortalPage() {
  const { branding, demoPublished, lusActive, vaultAssetCount, providerActive } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const [viewer, setViewer] = useState<{
    avatarUrl: string | null;
    displayName: string | null;
    email: string | null;
    userId: string | null;
    isAdmin: boolean;
  } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [signupOpen, setSignupOpen] = useState(false);

  // Resolve the signed-in user (if any) and their profile, for the header avatar.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!session?.user) {
        setViewer(null);
        setAuthChecked(true);
        return;
      }
      const [profileRes, rolesRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("avatar_url, display_name")
          .eq("user_id", session.user.id)
          .maybeSingle(),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id),
      ]);
      if (cancelled) return;
      const profile = profileRes.data;
      const isAdmin = (rolesRes.data ?? []).some((r) => r.role === "admin");
      setViewer({
        avatarUrl: profile?.avatar_url ?? (session.user.user_metadata?.avatar_url as string | null) ?? null,
        displayName:
          profile?.display_name ??
          (session.user.user_metadata?.full_name as string | null) ??
          null,
        email: session.user.email ?? null,
        userId: session.user.id,
        isAdmin,
      });
      setAuthChecked(true);
    };
    load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setViewer(null);
    toast.success("Signed out");
  }, []);

  const handleAuthenticated = useCallback(() => {
    setSignupOpen(false);
    // onAuthStateChange will refresh viewer.
  }, []);

  useEffect(() => {
    if (!branding?.provider_id) return;
    recordPageVisit({
      data: {
        providerId: branding.provider_id,
        slug,
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent || null : null,
      },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branding?.provider_id, slug]);

  // Inject GA snippet when provider has configured a tracking ID
  useEffect(() => {
    const gaId = (branding as any)?.ga_tracking_id as string | null | undefined;
    if (!gaId || typeof document === "undefined") return;
    if (document.getElementById("ga-gtag-script")) return;
    const scriptSrc = document.createElement("script");
    scriptSrc.id = "ga-gtag-script";
    scriptSrc.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
    scriptSrc.async = true;
    document.head.appendChild(scriptSrc);
    const scriptInit = document.createElement("script");
    scriptInit.id = "ga-gtag-init";
    scriptInit.textContent = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`;
    document.head.appendChild(scriptInit);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(branding as any)?.ga_tracking_id]);

  if (!branding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-foreground">Studio Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            This provider's Studio does not exist or hasn't been configured yet.
          </p>
        </div>
      </div>
    );
  }

  // Gate the public Studio behind paid status. The provider themselves and
  // admins can still preview their own page (so the in-dashboard Studio
  // Preview iframe and "Open in new tab" continue to work pre-purchase).
  const viewerIsOwner =
    !!viewer?.userId && viewer.userId === branding.provider_id;
  const viewerIsAdmin = !!viewer?.isAdmin;
  const canBypassPaywall = viewerIsOwner || viewerIsAdmin;

  if (!providerActive && authChecked && !canBypassPaywall) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h1 className="text-4xl font-bold text-foreground">Studio Coming Soon</h1>
          <p className="mt-3 text-muted-foreground">
            This Studio isn't published yet. Please check back soon, or contact the
            owner directly if you were expecting access.
          </p>
        </div>
      </div>
    );
  }

  // While we're still resolving the viewer's session, render a neutral
  // loading state instead of flashing either the gated message or the full
  // page (which would leak content to non-owners for a few hundred ms).
  if (!providerActive && !authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
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
          viewer={viewer}
          authChecked={authChecked}
          onSignIn={() => setSignupOpen(true)}
          onSignOut={handleSignOut}
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
            {/* Brand chip moved into sticky header */}

            <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight text-white drop-shadow-lg sm:text-5xl md:text-6xl">
              Your Properties,{" "}
              <span style={{ color: accent }} className="drop-shadow-lg">
                Professionally Presented.
              </span>{" "}
              No Subscriptions.
            </h1>

            <p className="mt-6 max-w-2xl text-lg text-white/90 drop-shadow-md">
              Create a branded, multi-model Presentation Portal for your Matterport tours. Build for free, pay only
              when you're ready to download and host it anywhere.
            </p>

            <a
              href="#builder-start"
              onClick={handleScrollTo("builder-start")}
              className="mt-10 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
              style={{ backgroundColor: accent }}
            >
              <Sparkles className="size-5" />
              Start Building Your Portal
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
                <h3 className="text-lg font-semibold">Design your Portal</h3>
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Add your logo, contact info, choose music, and toggle features like the AI
                Concierge and more.
              </p>
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

        {/* STUDIO INCLUDES — features split across 3 columns with glass texture */}
        <section id="includes" className="scroll-mt-20 mx-auto max-w-6xl px-4 pb-4 sm:px-6">
          <div
            className="rounded-2xl border bg-white/50 p-6 shadow-sm backdrop-blur-xl sm:p-8 dark:bg-slate-900/40"
            style={{ borderColor: `${accent}40` }}
          >
            <div className="mb-6 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <h3 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                What{" "}
                <span style={{ color: accent }}>{branding.brand_name} Studio</span>{" "}
                Includes
              </h3>
              <span
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: accent }}
              >
                Every presentation
              </span>
            </div>

            <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200"
                >
                  <Check
                    className="mt-0.5 size-4 shrink-0"
                    style={{ color: accent }}
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {!lusActive && (
              <p className="mt-5 text-xs italic text-slate-500 dark:text-slate-400">
                Premium AI features currently unavailable on this plan.
              </p>
            )}
          </div>
        </section>

        {/* PUBLIC PRICING TABLE */}
        <PortalPricingSection branding={branding} accent={accent} />

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

        {/* BUILDER CTA — links to dedicated /p/{slug}/builder route */}
        <section id="builder-start" className="scroll-mt-20 px-4 pb-16 pt-12 sm:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
              Ready to build?
            </h2>
            <p className="mt-3 text-slate-600 dark:text-slate-300">
              Open the Presentation Builder to configure your 3D experience. Your progress is saved as you work.
            </p>
            <div
              className="mx-auto mt-6 h-1 w-24 rounded-full"
              style={{ backgroundColor: accent }}
            />
            <Link
              to="/p/$slug/builder"
              params={{ slug }}
              className="mt-8 inline-flex items-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white shadow-2xl transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl"
              style={{ backgroundColor: accent }}
            >
              <Sparkles className="size-5" />
              Open the Builder →
            </Link>
          </div>
        </section>
      </div>

      {/* Sign in / sign up modal — shared with the Builder. */}
      <PortalSignupModal
        open={signupOpen}
        onOpenChange={setSignupOpen}
        onAuthenticated={handleAuthenticated}
        providerId={branding.provider_id}
        accentColor={accent}
        brandName={branding.brand_name}
      />
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
  hudBgColor,
  demoPublished,
  onScrollTo,
  viewer,
  authChecked,
  onSignIn,
  onSignOut,
}: {
  branding: { brand_name: string; logo_url: string | null };
  slug: string;
  accent: string;
  hudBgColor: string;
  demoPublished: boolean;
  onScrollTo: (id: string) => (e: React.MouseEvent<HTMLAnchorElement>) => void;
  viewer: {
    avatarUrl: string | null;
    displayName: string | null;
    email: string | null;
  } | null;
  authChecked: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const navLinks = [
    { id: "steps", label: "Steps" },
    { id: "compare", label: "Compare" },
    { id: "pricing", label: "Pricing" },
  ];

  // Tint header with MSP Portal background color at ~80% opacity (cc hex alpha)
  const headerBg = `${hudBgColor}cc`;

  // Compute initials for the avatar fallback.
  const viewerLabel = viewer?.displayName || viewer?.email || "";
  const viewerInitials = viewerLabel
    ? viewerLabel
        .split(/\s+|@/)
        .filter(Boolean)
        .slice(0, 2)
        .map((s) => s[0]!.toUpperCase())
        .join("") || "U"
    : "";

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-white/15 shadow-sm backdrop-blur-xl"
      style={{ backgroundColor: headerBg }}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Left: enlarged brand pill (translucent over tinted bar) */}
        <div className="flex h-11 items-center gap-3 rounded-full border border-white/25 bg-white/15 px-3 pr-4 shadow-sm backdrop-blur-md">
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
          <span className="text-base font-semibold text-white drop-shadow">
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
              className="text-sm font-medium text-white/90 drop-shadow transition-colors hover:text-white"
              onMouseEnter={(e) => (e.currentTarget.style.color = accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = "")}
            >
              {link.label}
            </a>
          ))}
          <Link
            to="/p/$slug/builder"
            params={{ slug }}
            className="text-sm font-medium text-white/90 drop-shadow transition-colors hover:text-white"
            onMouseEnter={(e) => (e.currentTarget.style.color = accent)}
            onMouseLeave={(e) => (e.currentTarget.style.color = "")}
          >
            Builder
          </Link>
        </nav>

        {/* Far right: profile dropdown (signed in) or Sign In button. */}
        <div className="hidden items-center sm:flex">
          {!authChecked ? (
            <div className="h-9 w-24 animate-pulse rounded-full bg-white/15" />
          ) : viewer ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 items-center gap-2 rounded-full border border-white/25 bg-white/15 pl-1 pr-3 shadow-sm backdrop-blur-md transition-colors hover:bg-white/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  title={viewerLabel || "Signed in"}
                  aria-label={viewerLabel ? `Account menu for ${viewerLabel}` : "Account menu"}
                >
                  {viewer.avatarUrl ? (
                    <img
                      src={viewer.avatarUrl}
                      alt={viewerLabel || "Profile"}
                      className="h-7 w-7 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: accent }}
                    >
                      {viewerInitials || "U"}
                    </div>
                  )}
                  <span className="hidden max-w-[12rem] truncate text-xs font-medium text-white drop-shadow md:inline">
                    {viewer.email || viewer.displayName || "Signed in"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                  <span className="text-xs font-normal text-muted-foreground">
                    Signed in as
                  </span>
                  <span className="truncate text-sm font-semibold text-foreground">
                    {viewer.email || viewer.displayName || "Account"}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onSignOut} className="cursor-pointer">
                  <LogOut className="size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-white shadow-md transition-transform hover:scale-105"
              style={{ backgroundColor: accent }}
            >
              <LogIn className="size-4" />
              Sign In
            </button>
          )}
        </div>

        {/* Mobile: hamburger menu */}
        <Sheet>
          <SheetTrigger asChild>
            <button
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-sm backdrop-blur-md sm:hidden"
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
              <Link
                to="/p/$slug/builder"
                params={{ slug }}
                className="rounded-lg px-4 py-3 text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Builder
              </Link>

              {/* Mobile sign-in / sign-out */}
              <div className="mt-2 border-t pt-2">
                {!authChecked ? null : viewer ? (
                  <button
                    type="button"
                    onClick={onSignOut}
                    className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-base font-medium text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <LogOut className="size-4" />
                    <span className="truncate">
                      Sign Out{viewer.email ? ` (${viewer.email})` : ""}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onSignIn}
                    className="flex w-full items-center gap-2 rounded-lg px-4 py-3 text-left text-base font-medium text-white"
                    style={{ backgroundColor: accent }}
                  >
                    <LogIn className="size-4" />
                    Sign In
                  </button>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

// ============ Public pricing section ============

interface PricingBranding {
  brand_name: string;
  base_price_cents?: number | null;
  tier3_price_cents?: number | null;
  additional_model_fee_cents?: number | null;
  flat_price_per_model_cents?: number | null;
  use_flat_pricing?: boolean | null;
}

function fmtUSD(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function PortalPricingSection({
  branding,
  accent,
}: {
  branding: PricingBranding;
  accent: string;
}) {
  const useFlat = Boolean(branding.use_flat_pricing);
  const flat = branding.flat_price_per_model_cents ?? null;
  const a = branding.base_price_cents ?? null;
  const b = branding.tier3_price_cents ?? null;
  const c = branding.additional_model_fee_cents ?? null;

  const configured = useFlat ? flat != null && flat > 0 : a != null && a > 0;

  return (
    <section
      id="pricing"
      className="scroll-mt-20 mx-auto max-w-6xl px-4 py-16 sm:px-6"
    >
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white">
          What it costs
        </h2>
        <p className="mt-3 text-slate-600 dark:text-slate-300">
          One-time payment per Presentation. No subscriptions.
        </p>
      </div>

      <div
        className="rounded-2xl border bg-white/50 p-6 shadow-sm backdrop-blur-xl sm:p-8 dark:bg-slate-900/40"
        style={{ borderColor: `${accent}40` }}
      >
        {!configured ? (
          <div className="text-center text-slate-700 dark:text-slate-200">
            <p className="text-base font-medium">
              {branding.brand_name} hasn't published pricing yet.
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Contact your provider for a quote.
            </p>
          </div>
        ) : useFlat ? (
          <FlatRateTable flatCents={flat as number} accent={accent} />
        ) : (
          <TieredRateTable
            a={a as number}
            b={b}
            c={c ?? 0}
            accent={accent}
          />
        )}

        {configured && (
          <p className="mt-5 text-center text-xs italic text-slate-500 dark:text-slate-400">
            Prices are per Presentation download. You only pay when you're
            ready to publish.
          </p>
        )}
      </div>
    </section>
  );
}

function FlatRateTable({ flatCents, accent }: { flatCents: number; accent: string }) {
  const rows: { label: string; price: string }[] = [
    { label: "1 model", price: fmtUSD(flatCents) },
    { label: "2 models", price: fmtUSD(flatCents * 2) },
    { label: "3 models", price: fmtUSD(flatCents * 3) },
    { label: "4 models", price: fmtUSD(flatCents * 4) },
    { label: "5 models", price: fmtUSD(flatCents * 5) },
    { label: "Each additional model", price: `+ ${fmtUSD(flatCents)} each` },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-slate-700 dark:text-slate-200">
            Number of models in your Presentation
          </TableHead>
          <TableHead
            className="text-right font-bold"
            style={{ color: accent }}
          >
            Price
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}>
            <TableCell className="text-slate-800 dark:text-slate-100">
              {r.label}
            </TableCell>
            <TableCell className="text-right font-semibold text-slate-900 dark:text-white">
              {r.price}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TieredRateTable({
  a,
  b,
  c,
  accent,
}: {
  a: number;
  b: number | null;
  c: number;
  accent: string;
}) {
  const tier3Total = b ?? a * 2 + c;
  const rows: { label: string; price: string }[] = [
    { label: "1 model", price: fmtUSD(a) },
    { label: "2 models", price: fmtUSD(a * 2) },
    { label: "3 models (bundle)", price: fmtUSD(tier3Total) },
    { label: "4 models", price: fmtUSD(tier3Total + c) },
    { label: "5 models", price: fmtUSD(tier3Total + c * 2) },
    {
      label: "Each additional model beyond 3",
      price: `+ ${fmtUSD(c)} each`,
    },
  ];
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-slate-700 dark:text-slate-200">
            Number of models in your Presentation
          </TableHead>
          <TableHead
            className="text-right font-bold"
            style={{ color: accent }}
          >
            Price
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.label}>
            <TableCell className="text-slate-800 dark:text-slate-100">
              {r.label}
            </TableCell>
            <TableCell className="text-right font-semibold text-slate-900 dark:text-white">
              {r.price}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

