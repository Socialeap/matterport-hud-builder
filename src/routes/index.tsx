import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Layers,
  Palette,
  Globe,
  
  Zap,
  Users,
  ChevronRight,
  Sparkles,
  Lock,
  Play,
  Clock,
  DollarSign,
  PackageX,
  Menu,
  X,
  Sun,
  Moon,
  Bot,
  MailCheck,
  
  Boxes,
  CreditCard,
  Wand2,
  Archive,
  Film,
  MapPin,
  Video,
  Infinity as InfinityIcon,
  BarChart3,
  GraduationCap,
} from "lucide-react";
import heroHudBanner from "@/assets/hero-hud-showcase.png";
import tmLogo from "@/assets/tm-logo-landscape.png";
import { toast } from "sonner";

const SITE_URL = "https://matterport-hud-builder.lovable.app";
const OG_TITLE = "3D Presentation Studio — Branded Matterport Tour Presentations";
const OG_DESC =
  "Launch your own white-label studio where clients customize and download self-contained Matterport 3D tour presentations. One-time purchase — no subscriptions, no per-tour fees.";
const OG_IMAGE = `${SITE_URL}/og-3d-presentation-studio.png`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: OG_TITLE },
      { name: "description", content: OG_DESC },
      { name: "keywords", content: "Matterport presentation, 3D tour branding, property presentation portal, white-label Matterport, 3D presentation builder, real estate virtual tour" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: SITE_URL },
      { property: "og:title", content: OG_TITLE },
      { property: "og:description", content: OG_DESC },
      { property: "og:image", content: OG_IMAGE },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: OG_TITLE },
      { name: "twitter:description", content: OG_DESC },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [
      { rel: "canonical", href: SITE_URL },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "3D Presentation Studio",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: OG_DESC,
          url: SITE_URL,
          image: OG_IMAGE,
          offers: [
            { "@type": "Offer", name: "Starter", price: "149", priceCurrency: "USD" },
            { "@type": "Offer", name: "Pro", price: "299", priceCurrency: "USD" },
          ],
          creator: {
            "@type": "Organization",
            name: "Transcendence Media",
          },
        }),
      },
    ],
  }),
  component: Index,
});

/* ------------------------------------------------------------------ */
/*  Feature data                                                       */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Palette,
    title: "100% White-Label Authority",
    description:
      "Invite clients to your Studio with your logo, colors, and domain name, reinforcing your brand equity, not ours.",
  },
  {
    icon: Users,
    title: "Self-Serve Branding Studio",
    description:
      "Invite clients to configure their Tour Presentations with their branding, music tracks, contact options, property data, and more. ",
  },
  {
    icon: Boxes,
    title: "Scale-Based Pricing",
    description:
      "You set the rates. Charge a flat rate for the first set of models and a price for each additional model bundled into each Presentation. ",
  },
  {
    icon: CreditCard,
    title: "White-Label Delivery",
    description:
      "Easily set your Stripe checkout, schedule payouts, and track orders within a single dashboard.",
  },
];

const presentationFeatures = [
  {
    icon: Layers,
    title: "Multi-Model Presentation Portal",
    description:
      "Bundle multiple Matterport tours into a single branded presentation with seamless dropdown navigation.",
  },
  {
    icon: Zap,
    title: "15+ Tour Behaviors",
    description:
      "Clients can easily configure each model, setting MLS mode, auto-play, scroll-wheel lock, guided tours, language forcing, custom transitions, and more.",
  },
  {
    icon: Film,
    title: "Matterport Media Sync & Cinema Mode",
    description:
      "Each property auto-syncs videos, photos, and GIFs from its Matterport Media page into a built-in carousel — plus a one-click Cinematic Video player for YouTube, Vimeo, Loom, Wistia, or .mp4 links.",
  },
  {
    icon: MapPin,
    title: "Google-Powered Neighborhood Map",
    description:
      "Each listed property gets an embedded interactive map of its surroundings — schools, dining, transit — accessible directly from the Portal without leaving the tour.",
  },
  {
    icon: Archive,
    title: "Production Vault Add-Ons",
    description:
      "Pro studios curate a proprietary library of sound, Portal filters, widgets, custom icons, and property docs — surfaced inside every client's builder as plug-and-play upgrades.",
  },
];

const salesFeatures = [
  {
    icon: Bot,
    title: "The AI Concierge",
    description:
      "A 24/7 Q&A assistant trained on your client's property data — answers viewer questions while proactively capturing emails from high-intent visitors.",
  },
  {
    icon: GraduationCap,
    title: "Teach Your AI in Minutes",
    description:
      "You don't need to be a prompt engineer. Our simple 4-step training wizard lets you upload property docs and instantly teaches your AI Concierge exactly how to answer questions about the home.",
  },
  {
    icon: InfinityIcon,
    title: "Unlimited AI Answers",
    description:
      "We give you 20 free AI answers per property. Want more? Plug in your own Google Gemini API key to remove the cap and let your AI Concierge run 24/7 on your own terms.",
  },
  {
    icon: MailCheck,
    title: "Instant Lead Alerts",
    description:
      "No dashboards to babysit. High-intent leads land directly in your client's inbox the moment a viewer raises their hand.",
  },
  {
    icon: Video,
    title: "Host Live Guided Tours",
    description:
      "Don't just send a link — walk them through it. Hop into a live, two-way audio session right inside the 3D presentation. You can even \u201Cteleport\u201D your client so they see exactly what you're looking at, all in real time.",
  },
];

const ownershipFeatures = [
  {
    icon: Globe,
    title: "Brand + SEO/GEO Sovereignty",
    description:
      "Clients brand, download, and own the self-contained presentation file, optimized for human & AI search. Host on a variety of platforms,  including cost-free like Netlify or Github.",
  },
  {
    icon: BarChart3,
    title: "Built-In Traffic Analytics",
    description:
      "Know exactly how many eyeballs are on your properties. Check your built-in dashboard for weekly and monthly visit stats, or easily plug in your Google Analytics ID for deeper audience tracking.",
  },
  {
    icon: Lock,
    title: "Secure, VIP Access Gates",
    description:
      "Have an off-market or exclusive listing? Lock your presentation behind a secure password. Visitors can't view the tour, documents, or your contact info until they enter the correct code.",
  },
  {
    icon: Wand2,
    title: "Try Before You Buy Presentations",
    description:
      "Clients can design, configure, and tweak their presentations for their preferred look and behavior. Once satisfied, they make a payment to unlock the download.",
  },
];

const featureGroups = [
  { heading: "Stunning Interactive Presentations", items: presentationFeatures },
  { heading: "24/7 Smart Sales & Chat", items: salesFeatures },
  { heading: "Privacy, Stats & Ownership", items: ownershipFeatures },
];


const starterFeatures = [
  { text: 'Co-branded Presentation Portal output ("Powered by Transcendence Media")', included: true },
  { text: "Full builder access", included: true },
  { text: "Client invitation management", included: true },
  { text: "Music & tour behavior config", included: true },
  { text: "AI Property FAQ Assistant*", included: true },
  { text: "Matterport Media Sync & Cinema Mode", included: true },
  { text: "Google-Powered Neighborhood Map", included: true },
  { text: "Easy Stripe-Connect payout options", included: true },
  { text: "Per-pricing for multiple property tours", included: true },
  { text: "Custom domain", included: false },
  { text: "Full whitelabel (remove co-branding)", included: false },
  { text: "Production Vault (curated plugins/add-ons)", included: false },
  { text: "AI Lead Generation for Clients*", included: false },
];

const proFeatures = [
  { text: "100% whitelabel — no co-branding", included: true },
  { text: "Full builder access", included: true },
  { text: "Client invitation management", included: true },
  { text: "Music & tour behavior config", included: true },
  { text: "AI Property FAQ Assistant*", included: true },
  { text: "Matterport Media Sync & Cinema Mode", included: true },
  { text: "Google-Powered Neighborhood Map", included: true },
  { text: "Easy Stripe-Connect payout options", included: true },
  { text: "Per-pricing for multiple property tours", included: true },
  { text: "Custom domain", included: true },
  { text: "Production Vault (curated plugins/add-ons)", included: true },
  { text: "AI Lead Generation for Clients*", included: true },
  { text: "Priority support", included: true },
];

/* ------------------------------------------------------------------ */
/*  Demo Button (inline in pricing cards)                              */
/* ------------------------------------------------------------------ */

function DemoButton({ tier }: { tier: "starter" | "pro" }) {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [activating, setActivating] = useState(false);

  const activateTier = async () => {
    if (!isAuthenticated || !user) {
      navigate({ to: "/login" });
      return;
    }
    setActivating(true);
    try {
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "provider")
        .maybeSingle();

      if (!existingRole) {
        await supabase
          .from("user_roles")
          .insert({ user_id: user.id, role: "provider" });
      }

      const productId = tier === "pro" ? "pro_tier" : "starter_tier";
      const amount = tier === "pro" ? 29900 : 14900;

      await supabase.from("purchases").insert({
        user_id: user.id,
        stripe_session_id: `demo_${tier}_${Date.now()}`,
        product_id: productId,
        price_id: `${tier}_onetime`,
        amount_cents: amount,
        currency: "usd",
        status: "completed",
        environment: "sandbox",
      });

      const { data: existingBranding } = await supabase
        .from("branding_settings")
        .select("id")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (!existingBranding) {
        await supabase.from("branding_settings").insert({
          provider_id: user.id,
          tier: tier,
          brand_name: "",
          accent_color: "#3B82F6",
          hud_bg_color: "#1a1a2e",
          gate_label: "Enter",
        });
      } else {
        await supabase
          .from("branding_settings")
          .update({ tier: tier })
          .eq("provider_id", user.id);
      }

      toast.success(
        `${tier === "pro" ? "Pro" : "Starter"} demo activated! Redirecting…`
      );
      setTimeout(() => navigate({ to: "/dashboard" }), 1200);
    } catch (err) {
      console.error(err);
      toast.error("Failed to activate demo. Please try again.");
    }
    setActivating(false);
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full gap-1.5 border-white/20 text-white/80 hover:bg-white/10 hover:text-white"
      onClick={activateTier}
      disabled={activating}
    >
      <Play className="size-3.5" />
      {activating ? "Activating…" : `View ${tier === "pro" ? "Pro" : "Starter"} Demo`}
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Header Sign-In dropdown                                            */
/* ------------------------------------------------------------------ */

function HeaderSignInMenu({ variant = "desktop" }: { variant?: "desktop" | "mobile" }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error(result.error instanceof Error ? result.error.message : "Google sign-in failed");
      }
    } catch {
      toast.error("Google sign-in failed");
    } finally {
      setLoading(false);
    }
  };

  const trigger =
    variant === "desktop" ? (
      <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" disabled={loading}>
        Sign In
      </Button>
    ) : (
      <Button size="sm" variant="ghost" className="justify-start text-white/80 hover:bg-white/10" disabled={loading}>
        Sign In
      </Button>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={handleGoogle} className="cursor-pointer">
          <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/login" })} className="cursor-pointer">
          Sign in with Email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

function Index() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState(true);

  /* No loading gate — all static content renders on the server for SEO.
     Auth-dependent buttons simply hide during the brief loading window. */

  const bg = isDark ? '#0a0e27' : '#1a1a1a';
  const gridColor = isDark ? 'rgba(148,163,184,0.06)' : 'rgba(255,255,255,0.04)';
  const textColor = 'text-white';
  const textMuted = 'text-white/70';
  const textSubtle = 'text-white/50';
  const headerBg = isDark ? 'bg-[#0a0e27]/60' : 'bg-[#1a1a1a]/70';
  const headerBorder = 'border-white/10';
  const mobileBg = isDark ? 'bg-[#0a0e27]/90' : 'bg-[#1a1a1a]/95';
  const cardBg = 'bg-white/5';
  const footerBg = isDark ? 'bg-[#0a0e27]/80' : 'bg-[#141414]/90';
  const sectionTint = 'rgba(255,255,255,0.02)';
  const sectionTint2 = 'rgba(255,255,255,0.015)';
  const borderLight = 'border-white/5';
  const borderFooter = 'border-white/10';

  return (
    <div className={`${isDark ? 'dark' : ''} relative min-h-screen text-foreground transition-colors duration-500`} style={{ backgroundColor: bg }}>
      {/* ---- Notebook grid overlay ---- */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(${gridColor} 1px, transparent 1px),
            linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
          `,
          backgroundSize: '70px 70px',
        }}
      />

      {/* ---- Organic translucent orbs (both modes) ---- */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-32 -top-20 h-[500px] w-[500px] rounded-full blur-[160px]"
          style={{ background: isDark ? 'rgba(37,99,235,0.15)' : 'rgba(120,100,80,0.08)' }} />
        <div className="absolute right-0 top-[30%] h-[400px] w-[450px] rounded-full blur-[140px]"
          style={{ background: isDark ? 'rgba(99,102,241,0.12)' : 'rgba(100,90,70,0.06)' }} />
        <div className="absolute bottom-[10%] left-[20%] h-[350px] w-[400px] rounded-full blur-[180px]"
          style={{ background: isDark ? 'rgba(20,184,166,0.10)' : 'rgba(140,120,90,0.07)' }} />
        <div className="absolute -right-20 bottom-[40%] h-[300px] w-[350px] rounded-full blur-[150px]"
          style={{ background: isDark ? 'rgba(147,51,234,0.08)' : 'rgba(100,80,60,0.05)' }} />
        <div className="absolute left-[50%] top-[60%] h-[400px] w-[400px] rounded-full blur-[200px]"
          style={{ background: isDark ? 'rgba(6,182,212,0.08)' : 'rgba(130,110,85,0.06)' }} />
      </div>

      {/* ---- Header with glassmorphism ---- */}
      <header className={`fixed inset-x-0 top-0 z-50 border-b ${headerBorder} ${headerBg} backdrop-blur-xl`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <a
              href="https://transcendencemedia.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center"
              aria-label="Transcendence Media — visit main site"
            >
              <img
                src={tmLogo}
                alt="Transcendence Media"
                className="h-[50px] w-auto sm:h-[55px] my-0 mt-[5px] pt-px"
              />
            </a>
            <span className="hidden text-sm font-bold tracking-tight text-white sm:inline lg:text-base">
              3D Presentation Studio
            </span>
          </div>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-6 sm:flex">
            <a href="#features" className="text-sm text-white/70 transition-colors hover:text-white">Features</a>
            <a href="#pricing" className="text-sm text-white/70 transition-colors hover:text-white">Pricing</a>
            <a href="#how-it-works" className="text-sm text-white/70 transition-colors hover:text-white">How It Works</a>

            {/* Theme toggle */}
            <button
              onClick={() => setIsDark(!isDark)}
              className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate({ to: "/dashboard" })}>Dashboard</Button>
            ) : (
              <>
                <HeaderSignInMenu variant="desktop" />
                <Button size="sm" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}>
                  Get Started
                </Button>
              </>
            )}
          </nav>

          {/* Mobile menu button */}
          <div className="flex items-center gap-2 sm:hidden">
            <button
              onClick={() => setIsDark(!isDark)}
              className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10"
              aria-label="Toggle theme"
            >
              {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <button
              className="text-white/80 hover:text-white"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="size-6" /> : <Menu className="size-6" />}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileMenuOpen && (
          <div className={`border-t ${headerBorder} ${mobileBg} backdrop-blur-xl sm:hidden`}>
            <div className="flex flex-col gap-2 px-4 py-4">
              <a href="#features" className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Features</a>
              <a href="#pricing" className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
              <a href="#how-it-works" className="rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/5 hover:text-white" onClick={() => setMobileMenuOpen(false)}>How It Works</a>
              {isAuthenticated ? (
                <Button size="sm" className="mt-2" onClick={() => navigate({ to: "/dashboard" })}>Dashboard</Button>
              ) : (
                <>
                  <HeaderSignInMenu variant="mobile" />
                  <Button size="sm" className="mt-1" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}>Get Started</Button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      {/* ---- Hero ---- */}
      <section className="relative z-10 px-4 pt-20 pb-16 sm:pt-28 sm:pb-24 py-[80px]">
        <div className="mx-auto max-w-4xl text-center">

          {/* Headline */}
          <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-6xl sm:text-4xl">
            Imagine a Turn-Key Studio where <em className="italic">Your</em> Clients Customize <em className="italic">Their</em>{" "}
            <span className="text-slate-50 text-4xl">3D Tour Presentations 🤔</span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/60 sm:text-lg">
            Give clients a space to build, customize, and download presentations they fully own.
          </p>
        </div>

        {/* Browser chrome frame */}
        <div className="mx-auto mt-16 max-w-5xl">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-2xl shadow-black/40">
            {/* Title bar */}
            <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="size-3 rounded-full bg-[#ff5f57]" />
                <div className="size-3 rounded-full bg-[#febc2e]" />
                <div className="size-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 rounded-md bg-white/5 px-3 py-1 text-center text-xs text-white/40">
                your-studio.com/tour/brickell-tower
              </div>
            </div>
            {/* Screenshot */}
            <div className="relative">
              <img
                src={heroHudBanner}
                alt="3D property tour Presentation Portal showcase"
                className="w-full"
                loading="eager"
              />
              {/* Center overlay text */}
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="mx-4 max-w-lg text-lg font-medium text-white/90 lg:text-2xl text-left sm:text-xl" style={{ textShadow: '0 2px 12px rgba(0,0,0,0.7)', whiteSpace: 'pre-line' }}>
                  Here... My clients easily build{"\n"}their own tour presentations 😉
                </p>
              </div>
            </div>
          </div>

          {/* CTA below image */}
          <div className="mt-8 flex justify-center">
            <a href="#pricing">
              <Button size="lg" className="gap-2">
                Try our demo
                <ChevronRight className="size-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* ---- Problem section ---- */}
      <section className="relative z-10 px-4 py-16 sm:py-24" style={{ backgroundColor: sectionTint }}>
        <div className="mx-auto max-w-5xl">
          <h2 className={`text-center text-2xl font-bold tracking-tight text-white sm:text-3xl`}>
            The &ldquo;Service Trap&rdquo; of Traditional 3D Presentation Platforms
          </h2>
          <p className={`mx-auto mt-3 max-w-xl text-center text-white/60`}>
            Most 3D tour presentation platforms require you to format and configure your client's models, charging you a monthly subscription just to keep the assets on their servers. At 3DPS , we flip that dynamic to give YOU ownership of the presentation service and your clients ownership of the results.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            <Card className={`border-red-500/20 ${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/10`}>
              <CardContent className="pt-6 text-left">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <DollarSign className="size-5 text-amber-300" />
                </div>
                <h3 className={`mt-4 font-semibold text-white`}>You Do the Work, They Get Paid</h3>
                <p className={`mt-2 text-sm text-white/60`}>
                  Monthly subscriptions to keep your assets online — while you&#39;re the one doing all the manual labor on their servers.
                </p>
              </CardContent>
            </Card>

            <Card className={`border-red-500/20 ${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/10`}>
              <CardContent className="pt-6 text-left">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <Clock className="size-5 text-amber-300" />
                </div>
                <h3 className={`mt-4 font-semibold text-white`}>Every Change Goes Through You</h3>
                <p className={`mt-2 text-sm text-white/60`}>
                  When a client needs an MLS-compliant version or a simple music change, you have to log in and do the work every time.
                </p>
              </CardContent>
            </Card>

            <Card className={`border-red-500/20 ${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/10`}>
              <CardContent className="pt-6 text-left">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <Lock className="size-5 text-amber-300" />
                </div>
                <h3 className={`mt-4 font-semibold text-white`}>A Bottleneck You Don&#39;t Own</h3>
                <p className={`mt-2 text-sm text-white/60`}>
                  You aren&#39;t just paying for software — you&#39;re paying for the privilege of being an unpaid administrator for a company you don&#39;t own. It drains your time and limits your growth.
                </p>
              </CardContent>
            </Card>

            <Card className={`border-red-500/20 ${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-red-500/60 hover:shadow-lg hover:shadow-red-500/10`}>
              <CardContent className="pt-6 text-left">
                <div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10">
                  <PackageX className="size-5 text-amber-300" />
                </div>
                <h3 className={`mt-4 font-semibold text-white`}>Paying for Tools You Never Use</h3>
                <p className={`mt-2 text-sm text-white/60`}>
                  Complex &ldquo;bloatware&rdquo; like IoT data integrations and rarely used features like graphical overlays and sectional audio — bundled into every plan whether you need them or not.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ---- Features grid ---- */}
      <section id="features" className={`relative z-10 border-t ${borderLight} px-4 py-16 sm:py-24`} style={{ backgroundColor: sectionTint2 }}>
        <div className="mx-auto max-w-5xl">
          <h2 className={`text-center text-2xl font-bold tracking-tight text-white sm:text-3xl`}>
            Invite Clients to a Space where they Build their Own Presentations
          </h2>
          <p className={`mx-auto mt-3 max-w-xl text-center text-white/60`}>
            Our platform lets you brand, configure, and run  your Studio like a kiosk that delivers professional 3D presentations for clients and other model owners.
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <Card key={f.title} className={`${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-lg hover:shadow-amber-300/10`}>
                <CardContent className="pt-6 text-left">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                    <f.icon className="size-5 text-amber-300" />
                  </div>
                  <h3 className={`mt-4 font-semibold text-white`}>{f.title}</h3>
                  <p className={`mt-1 text-sm text-white/60`}>{f.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Client value section ---- */}
      <section className={`relative z-10 border-t ${borderLight} px-4 py-16 sm:py-24`} style={{ backgroundColor: sectionTint }}>
        <div className="mx-auto max-w-5xl">
          <h2 className={`text-center text-2xl font-bold tracking-tight text-white sm:text-3xl`}>
            Clients will Love your Studio's  Self-Serve Work Flow
          </h2>
          <p className={`mx-auto mt-3 max-w-2xl text-center text-white/60`}>
            Hand clients self-serve features — not a service ticket. They configure, brand, and walk away with a permanent, self-contained presentation file.
          </p>

          {featureGroups.map((group) => (
            <div key={group.heading} className="mt-14 first:mt-12">
              <h3 className="text-center text-xl font-semibold text-amber-300/90 sm:text-2xl">
                {group.heading}
              </h3>
              <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((f) => (
                  <Card key={f.title} className={`${cardBg} backdrop-blur transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-lg hover:shadow-amber-300/10`}>
                    <CardContent className="pt-6 text-left">
                      <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                        <f.icon className="size-5 text-amber-300" />
                      </div>
                      <h3 className={`mt-4 font-semibold text-white`}>{f.title}</h3>
                      <p className={`mt-1 text-sm text-white/60`}>{f.description}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Pricing comparison ---- */}
      <section id="pricing" className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-4xl">
          <h2 className={`text-center text-2xl font-bold tracking-tight text-white sm:text-3xl`}>
            Purchase Your Studio
          </h2>
          <p className={`mx-auto mt-3 max-w-lg text-center text-white/60`}>
            One-time setup fee · then $49/year upkeep license (first year free).
          </p>

          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {/* Starter */}
            <Card className={`relative flex flex-col backdrop-blur bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-amber-300/60 hover:shadow-lg hover:shadow-amber-300/10`}>
              <CardHeader className="text-center">
                <CardTitle className="text-xl text-amber-300">Starter Studio</CardTitle>
                <p className="text-sm text-white/60">Get started with co-branded studio.</p>
                <div className="mt-4 space-y-1">
                  <div>
<span className="text-4xl font-bold text-amber-300">$149</span>
<span className="text-sm text-white/50"> setup</span>
                  </div>
                  <div className="text-sm text-white/60">
                    <span className="font-semibold text-white">$49</span>/year upkeep license - First year <span className="font-bold text-primary">FREE!</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="space-y-3">
                  {starterFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {f.included ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <X className="mt-0.5 size-4 shrink-0 text-white/40" />
                      )}
                      <span className={f.included ? "text-white/90" : "text-white/40"}>
                        {f.text}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-white/50 italic">
                  Upgrade to Pro Studio later for just $199 — not the full $299.
                </p>
                <div className="flex flex-col gap-2">
                  {!isAuthenticated && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}
                    >
                      Get Starter Studio
                    </Button>
                  )}
                  <DemoButton tier="starter" />
                </div>
              </CardContent>
            </Card>

            {/* Pro */}
            <Card className={`relative flex flex-col border-primary shadow-lg backdrop-blur bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-primary hover:shadow-xl hover:shadow-primary/20`}>
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Most Popular
              </Badge>
              <CardHeader className="text-center">
                <CardTitle className="text-xl text-amber-300">Pro Studio</CardTitle>
                <p className="text-sm text-white/60">Full whitelabel studio and more.</p>
                <div className="mt-4 space-y-1">
                  <div>
<span className="text-4xl font-bold text-amber-300">$299</span>
<span className="text-sm text-white/50"> setup</span>
                  </div>
                  <div className="text-sm text-white/60">
                    <span className="font-semibold text-white">$49</span>/year upkeep license - First year <span className="font-bold text-primary">FREE!</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-6">
                <ul className="space-y-3">
                  {proFeatures.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      {f.included ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <X className="mt-0.5 size-4 shrink-0 text-white/40" />
                      )}
                      <span className={f.included ? "text-white/90" : "text-white/40"}>
                        {f.text}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col gap-2">
                  {!isAuthenticated && (
                    <Button
                      className="w-full"
                      onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}
                    >
                      Get Pro Studio
                    </Button>
                  )}
                  <DemoButton tier="pro" />
                </div>
              </CardContent>
            </Card>
          </div>

          <p className={`mx-auto mt-6 max-w-2xl text-center text-xs text-white/50`}>
            *All AI supported features require an active annual upkeep license to function.
            <br />
            Your studio setup (builder, branding, saved presentations) is permanent and never expires.
          </p>

          <p className={`mx-auto mt-4 max-w-2xl text-center text-xs text-white/50`}>
            <strong>Activate a test tier instantly</strong> — no Stripe purchase required. Explore the full dashboard, branding settings, client portal, and orders workflow. Demo purchases are recorded in sandbox mode. You can switch Demo tiers any time by returning here.
          </p>
        </div>
      </section>

      {/* ---- How it works ---- */}
      <section id="how-it-works" className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-3xl">
          <h2 className={`text-center text-2xl font-bold tracking-tight text-white sm:text-3xl`}>
            How It Works
          </h2>
          <div className="mt-12 space-y-8">
            {[
              {
                step: "1",
                title: "Choose Your Studio Tier",
                desc: "Create your account and pick Starter or Pro. One-time payment, lifetime access.",
              },
              {
                step: "2",
                title: "Configure Your Brand & Pricing",
                desc: "Upload your logo, set accent colors, and customize your Presentation Portal's header. Set a Studio URL slug and (optional) pricing for your client-facing page.",
              },
              {
                step: "3",
                title: "Share Your Studio Link",
                desc: "Send agents and property managers to your branded studio. They add Matterport models, configure tour behaviors, and preview in real-time.",
              },
              {
                step: "4",
                title: "Fulfill & Deliver",
                desc: "When a client confirms, you receive a notification. Mark as paid, generate the self-contained HTML file, and release it to your client.",
              },
            ].map((item) => (
              <div key={item.step} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {item.step}
                </div>
                <div>
                  <h3 className={`font-semibold text-white`}>{item.title}</h3>
                  <p className={`mt-1 text-sm text-white/60`}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className={`relative z-10 border-t ${borderFooter} ${footerBg} backdrop-blur-lg px-4 py-10 transition-colors duration-500`}>
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className={`text-lg font-bold ${textColor}`}>3D Presentation Studio</span>
              <p className={`mt-2 text-sm ${textSubtle}`}>
                Professional, white-labeled 3D property tour presentations. Your clients/agents customize & pay to download and host anywhere.
              </p>
            </div>
            <div>
              <h4 className={`mb-3 text-sm font-semibold uppercase tracking-wider text-white/60`}>Product</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className={`text-white/50 transition-colors hover:text-white`}>Features</a></li>
                <li><a href="#pricing" className={`text-white/50 transition-colors hover:text-white`}>Pricing</a></li>
                <li><a href="#how-it-works" className={`text-white/50 transition-colors hover:text-white`}>How It Works</a></li>
              </ul>
            </div>
            <div>
              <h4 className={`mb-3 text-sm font-semibold uppercase tracking-wider text-white/60`}>Account</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/login" className={`text-white/50 transition-colors hover:text-white`}>Sign In</Link></li>
                <li><Link to="/signup" search={{ token: "", email: "" }} className={`text-white/50 transition-colors hover:text-white`}>Get Started</Link></li>
              </ul>
            </div>
            <div>
              <h4 className={`mb-3 text-sm font-semibold uppercase tracking-wider text-white/60`}>Legal</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/privacy" className={`text-white/50 transition-colors hover:text-white`}>Privacy Policy</Link></li>
                <li><Link to="/terms" className={`text-white/50 transition-colors hover:text-white`}>Terms of Service</Link></li>
              </ul>
            </div>
          </div>
          <div className={`mt-8 border-t ${borderFooter} pt-6 text-center text-xs text-white/40`}>
            © {new Date().getFullYear()} Transcendence Media. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
