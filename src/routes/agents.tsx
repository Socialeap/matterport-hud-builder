import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Bot,
  Video,
  MailCheck,
  Sparkles,
  MapPin,
  Palette,
  Film,
  Lock,
  BarChart3,
  Globe,
  Search,
  ChevronRight,
  Building2,
  Users,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import heroHudBanner from "@/assets/hero-hud-showcase.png";
import tmLogo from "@/assets/tm-logo-landscape.png";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

const SITE_URL = "https://matterport-hud-builder.lovable.app";
const OG_TITLE = "Find a 3D Presentation Studio for Your Listings — For Agents & Property Managers";
const OG_DESC =
  "Browse the directory of Matterport Service Providers who deliver branded, interactive 3D tour presentations for the properties you market.";
const OG_IMAGE = `${SITE_URL}/og-3d-presentation-studio.png`;
const PAGE_URL = `${SITE_URL}/agents`;

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: OG_TITLE },
      { name: "description", content: OG_DESC },
      {
        name: "keywords",
        content:
          "Matterport service provider directory, find 3D tour provider, real estate 3D presentation, property manager Matterport, agent virtual tour",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: PAGE_URL },
      { property: "og:title", content: OG_TITLE },
      { property: "og:description", content: OG_DESC },
      { property: "og:image", content: OG_IMAGE },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: OG_TITLE },
      { name: "twitter:description", content: OG_DESC },
      { name: "twitter:image", content: OG_IMAGE },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
  }),
  component: AgentsPage,
});

/* ------------------------------------------------------------------ */
/*  Agent-facing benefits                                              */
/* ------------------------------------------------------------------ */

const agentBenefits = [
  {
    icon: Sparkles,
    title: "Branded Property Presentations",
    description:
      "Hand prospects a polished, interactive 3D presentation that showcases your listing — not someone else's logo.",
  },
  {
    icon: Bot,
    title: "24/7 AI Concierge",
    description:
      "Buyers ask questions about the home at any hour. Your MSP-powered assistant answers instantly using property docs and listing data.",
  },
  {
    icon: Video,
    title: "Live Guided Tours",
    description:
      "Hop into a real-time, two-way audio walkthrough inside the 3D space. Teleport your client so they see exactly what you see.",
  },
  {
    icon: MailCheck,
    title: "Instant Lead Alerts",
    description:
      "High-intent viewers get captured automatically. Qualified leads land directly in your inbox — no dashboards to babysit.",
  },
];

/* ------------------------------------------------------------------ */
/*  How it works (agent journey)                                       */
/* ------------------------------------------------------------------ */

const journeySteps = [
  {
    step: 1,
    title: "Find Your MSP",
    description: "Search the directory by location and the features that matter to your listings.",
  },
  {
    step: 2,
    title: "Share Your Matterport",
    description: "Hand off your tour links. Your MSP configures branding, AI training, and tour behavior.",
  },
  {
    step: 3,
    title: "Receive a Branded Presentation",
    description: "Get a self-contained, interactive 3D presentation file — yours to share, embed, or host anywhere.",
  },
];

/* ------------------------------------------------------------------ */
/*  MSP Directory data + filters                                       */
/* ------------------------------------------------------------------ */

const FEATURE_FILTERS = [
  { id: "branding", icon: Palette, label: "Custom branding" },
  { id: "ai", icon: Bot, label: "AI Concierge" },
  { id: "live", icon: Video, label: "Live guided tours" },
  { id: "cinema", icon: Film, label: "Cinematic intros" },
  { id: "map", icon: MapPin, label: "Neighborhood maps" },
  { id: "vip", icon: Lock, label: "Private/VIP listings" },
  { id: "analytics", icon: BarChart3, label: "Traffic analytics" },
  { id: "domain", icon: Globe, label: "Custom domain hosting" },
] as const;

type FeatureId = typeof FEATURE_FILTERS[number]["id"];

interface SampleMSP {
  id: string;
  name: string;
  city: string;
  state: string;
  tagline: string;
  features: FeatureId[];
}

const SAMPLE_MSPS: SampleMSP[] = [
  {
    id: "transcendence-media",
    name: "Transcendence Media",
    city: "Los Angeles",
    state: "CA",
    tagline: "Cinematic 3D presentations for luxury and commercial listings.",
    features: ["branding", "ai", "live", "cinema", "map", "vip", "analytics", "domain"],
  },
  {
    id: "skyline-tours",
    name: "Skyline Tours",
    city: "Austin",
    state: "TX",
    tagline: "Fast-turnaround Matterport for residential agents.",
    features: ["branding", "ai", "map", "analytics"],
  },
  {
    id: "harbor-spaces",
    name: "Harbor Spaces",
    city: "Boston",
    state: "MA",
    tagline: "Coastal property specialists with VIP access controls.",
    features: ["branding", "vip", "live", "map", "domain"],
  },
  {
    id: "midwest-3d",
    name: "Midwest 3D",
    city: "Chicago",
    state: "IL",
    tagline: "High-volume residential MSP with neighborhood maps included.",
    features: ["branding", "map", "analytics", "ai"],
  },
  {
    id: "desert-vista-tours",
    name: "Desert Vista Tours",
    city: "Phoenix",
    state: "AZ",
    tagline: "Luxury & resort Matterport with cinematic intros.",
    features: ["branding", "cinema", "live", "vip", "domain"],
  },
  {
    id: "pacific-render",
    name: "Pacific Render",
    city: "Seattle",
    state: "WA",
    tagline: "Tech-forward studio with full AI and analytics stack.",
    features: ["branding", "ai", "analytics", "cinema", "domain"],
  },
  {
    id: "magnolia-immersive",
    name: "Magnolia Immersive",
    city: "Atlanta",
    state: "GA",
    tagline: "Boutique southern MSP focused on storytelling and live tours.",
    features: ["branding", "live", "ai", "map"],
  },
  {
    id: "rocky-mtn-spaces",
    name: "Rocky Mountain Spaces",
    city: "Denver",
    state: "CO",
    tagline: "Mountain real estate specialists with private listing gates.",
    features: ["branding", "vip", "map", "cinema", "domain"],
  },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function AgentsPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const bg = "#0a0e27";
  const gridColor = "rgba(148,163,184,0.06)";

  return (
    <div className="dark relative min-h-screen text-foreground" style={{ backgroundColor: bg }}>
      {/* Notebook grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(${gridColor} 1px, transparent 1px),
            linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
          `,
          backgroundSize: "70px 70px",
        }}
      />
      {/* Orbs */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute -left-32 -top-20 h-[500px] w-[500px] rounded-full blur-[160px]"
          style={{ background: "rgba(37,99,235,0.15)" }}
        />
        <div
          className="absolute right-0 top-[30%] h-[400px] w-[450px] rounded-full blur-[140px]"
          style={{ background: "rgba(99,102,241,0.12)" }}
        />
        <div
          className="absolute bottom-[10%] left-[20%] h-[350px] w-[400px] rounded-full blur-[180px]"
          style={{ background: "rgba(20,184,166,0.10)" }}
        />
      </div>

      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0a0e27]/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center" aria-label="3D Presentation Studio — home">
              <img src={tmLogo} alt="Transcendence Media" className="h-[50px] w-auto sm:h-[55px] my-0 mt-[5px] pt-px" />
            </Link>
            <span className="hidden text-sm font-bold tracking-tight text-white sm:inline lg:text-base">
              For Agents & Property Managers
            </span>
          </div>

          <nav className="hidden items-center gap-6 sm:flex">
            <a href="#benefits" className="text-sm text-white/70 transition-colors hover:text-white">
              Benefits
            </a>
            <a href="#how-it-works" className="text-sm text-white/70 transition-colors hover:text-white">
              How It Works
            </a>
            <a href="#directory" className="text-sm text-white/70 transition-colors hover:text-white">
              MSP Directory
            </a>
            <Link to="/" className="text-sm text-white/70 transition-colors hover:text-white">
              I'm an MSP →
            </Link>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate({ to: "/dashboard" })}>
                Dashboard
              </Button>
            ) : (
              <Button size="sm" variant="ghost" className="text-white/80 hover:bg-white/10 hover:text-white" onClick={() => navigate({ to: "/login" })}>
                Sign In
              </Button>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-4 pt-24 pb-12 sm:pt-32 sm:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <Badge className="mb-4 bg-white/10 text-white/80 backdrop-blur">For Agents · Property Managers · Marketers</Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-6xl sm:text-5xl">
            Find a 3D Presentation Studio for{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
              Your Listings
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            Hire a Matterport Service Provider who can deliver beautifully branded, interactive 3D
            tour presentations for the properties you market — complete with AI Concierge, live
            guided tours, and built-in lead capture.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#directory">
              <Button size="lg" className="gap-2">
                Browse the MSP Directory
                <ChevronRight className="size-4" />
              </Button>
            </a>
            <a href="#how-it-works">
              <Button size="lg" variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10">
                Learn How It Works
              </Button>
            </a>
          </div>
        </div>

        {/* Hero image */}
        <div className="mx-auto mt-14 max-w-5xl">
          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#111] shadow-2xl shadow-black/40">
            <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
              <div className="flex gap-1.5">
                <div className="size-3 rounded-full bg-[#ff5f57]" />
                <div className="size-3 rounded-full bg-[#febc2e]" />
                <div className="size-3 rounded-full bg-[#28c840]" />
              </div>
              <div className="flex-1 rounded-md bg-white/5 px-3 py-1 text-center text-xs text-white/40">
                your-listing.com/tour/lakeshore-residence
              </div>
            </div>
            <img src={heroHudBanner} alt="Branded 3D property tour presentation example" className="w-full" loading="eager" />
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="relative z-10 px-4 py-16 sm:py-24" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">What Your Listings Get</h2>
            <p className="mx-auto mt-3 max-w-2xl text-white/60">
              Every MSP in the directory uses the 3D Presentation Studio platform — so your
              listings get the same powerful feature set, branded by them.
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {agentBenefits.map((b) => {
              const Icon = b.icon;
              return (
                <Card key={b.title} className="border-white/10 bg-white/5 backdrop-blur transition-all hover:-translate-y-1 hover:border-white/20">
                  <CardContent className="p-6 text-left">
                    <div className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 text-cyan-300">
                      <Icon className="size-5" />
                    </div>
                    <h3 className="mb-2 text-base font-semibold text-white">{b.title}</h3>
                    <p className="text-sm leading-relaxed text-white/60">{b.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">How It Works</h2>
            <p className="mx-auto mt-3 max-w-2xl text-white/60">
              From finding the right MSP to delivering a polished presentation — three simple steps.
            </p>
          </div>
          <div className="grid gap-6 lg:grid-cols-3">
            {journeySteps.map((s, i) => (
              <div key={s.step} className="relative">
                <Card className="h-full border-white/10 bg-white/5 backdrop-blur transition-all hover:-translate-y-1 hover:border-amber-300/50 hover:shadow-lg hover:shadow-amber-300/10">
                  <CardContent className="p-6 text-left">
                    <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-amber-300/40 bg-amber-300/10 text-lg font-bold text-amber-300">
                      {s.step}
                    </div>
                    <h3 className="mb-2 text-lg font-semibold text-white">{s.title}</h3>
                    <p className="text-sm leading-relaxed text-white/60">{s.description}</p>
                  </CardContent>
                </Card>
                {i < journeySteps.length - 1 && (
                  <div className="pointer-events-none absolute right-[-12px] top-1/2 hidden h-0.5 w-6 -translate-y-1/2 border-t-2 border-dashed border-white/15 lg:block" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MSP Directory */}
      <DirectorySection />

      {/* Trust band */}
      <section className="relative z-10 px-4 py-16 sm:py-20" style={{ background: "rgba(255,255,255,0.015)" }}>
        <div className="mx-auto max-w-3xl text-center">
          <CheckCircle2 className="mx-auto mb-4 size-10 text-emerald-300" />
          <h2 className="text-2xl font-bold text-white sm:text-3xl">You Work Directly With the MSP</h2>
          <p className="mx-auto mt-4 max-w-2xl text-white/60">
            Every studio in this directory uses the 3D Presentation Studio platform, but your engagement
            is between you and the MSP — pricing, scope, and delivery are theirs to set. We don't take a
            cut, and we don't get in the middle.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/10 bg-[#0a0e27]/80 px-4 py-12">
        <div className="mx-auto max-w-6xl text-center text-sm text-white/50">
          <p className="mb-2">
            <Link to="/" className="text-white/70 hover:text-white">
              ← Back to MSP landing
            </Link>
          </p>
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-white/60">
            <a href="mailto:info@transcendencemedia.com" className="hover:text-white transition-colors">info@transcendencemedia.com</a>
            <span className="text-white/20">·</span>
            <a href="https://transcendencemedia.com" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">transcendencemedia.com</a>
            <span className="text-white/20">·</span>
            <a href="https://www.facebook.com/transcendNY/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Facebook</a>
          </div>
          <p>
            © {new Date().getFullYear()} Transcendence Media · 3D Presentation Studio · For Agents
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Directory section (interactive, no backend)                        */
/* ------------------------------------------------------------------ */

function DirectorySection() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<FeatureId>>(new Set());
  const [waitlistEmail, setWaitlistEmail] = useState("");

  const toggleFeature = (id: FeatureId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setQuery("");
    setSelected(new Set());
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SAMPLE_MSPS.filter((m) => {
      const matchesQuery =
        !q ||
        m.city.toLowerCase().includes(q) ||
        m.state.toLowerCase().includes(q) ||
        `${m.city}, ${m.state}`.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q);
      const matchesFeatures =
        selected.size === 0 || Array.from(selected).every((f) => m.features.includes(f));
      return matchesQuery && matchesFeatures;
    });
  }, [query, selected]);

  const handleWaitlist = (e: FormEvent) => {
    e.preventDefault();
    if (!waitlistEmail.trim()) return;
    toast.success("Thanks — we'll email you when the directory is live.");
    setWaitlistEmail("");
  };

  return (
    <section id="directory" className="relative z-10 px-4 py-16 sm:py-24" style={{ background: "rgba(255,255,255,0.02)" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col items-center justify-center gap-3 text-center">
          <Badge className="bg-amber-300/15 text-amber-200 backdrop-blur">Coming Soon</Badge>
          <h2 className="text-3xl font-bold text-white sm:text-4xl">MSP Directory</h2>
          <p className="mx-auto max-w-2xl text-white/60">
            Search by location and the features that matter most to your listings. The directory
            launches soon — these listings are previews so you can explore the experience.
          </p>
        </div>

        <Card className="border-white/10 bg-white/5 p-4 backdrop-blur sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            {/* Filter rail */}
            <aside className="space-y-6">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/60">
                  Location
                </label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
                  <Input
                    placeholder="City, state, or ZIP"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-white/60">
                  Required Services
                </label>
                <div className="space-y-2">
                  {FEATURE_FILTERS.map((f) => {
                    const Icon = f.icon;
                    const checked = selected.has(f.id);
                    return (
                      <label
                        key={f.id}
                        className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                          checked
                            ? "border-cyan-300/50 bg-cyan-300/10 text-white"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleFeature(f.id)}
                          className="border-white/30 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-[#0a0e27]"
                        />
                        <Icon className="size-4 shrink-0 opacity-80" />
                        <span>{f.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {(query || selected.size > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="w-full text-white/70 hover:bg-white/10 hover:text-white"
                >
                  Reset filters
                </Button>
              )}
            </aside>

            {/* Results */}
            <div className="space-y-4">
              {/* Waitlist banner */}
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-4">
                <form
                  onSubmit={handleWaitlist}
                  className="flex flex-col items-start gap-3 text-sm sm:flex-row sm:items-center"
                >
                  <p className="flex-1 text-white/80">
                    <span className="font-semibold text-amber-200">Directory launching soon.</span>{" "}
                    Get notified the moment we go live.
                  </p>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Input
                      type="email"
                      required
                      placeholder="you@email.com"
                      value={waitlistEmail}
                      onChange={(e) => setWaitlistEmail(e.target.value)}
                      className="border-white/10 bg-white/5 text-white placeholder:text-white/40 sm:w-56"
                    />
                    <Button type="submit" size="sm" className="shrink-0">
                      Notify Me
                    </Button>
                  </div>
                </form>
              </div>

              {/* Cards */}
              {filtered.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/15 bg-white/2 p-10 text-center">
                  <Building2 className="mx-auto mb-3 size-8 text-white/30" />
                  <p className="text-sm text-white/60">
                    No matches yet — adjust your filters or check back soon.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {filtered.map((m) => (
                    <MSPCard key={m.id} msp={m} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function MSPCard({ msp }: { msp: SampleMSP }) {
  return (
    <Card className="flex h-full flex-col border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-cyan-300/30">
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-white">
            <Building2 className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-white">{msp.name}</h3>
            <p className="flex items-center gap-1 text-xs text-white/50">
              <MapPin className="size-3" />
              {msp.city}, {msp.state}
            </p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-white/70">{msp.tagline}</p>

        <div className="flex flex-wrap gap-1.5">
          {msp.features.map((fid) => {
            const def = FEATURE_FILTERS.find((f) => f.id === fid);
            if (!def) return null;
            const Icon = def.icon;
            return (
              <TooltipProvider key={fid} delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex size-7 items-center justify-center rounded-md bg-white/5 text-white/70 ring-1 ring-white/10">
                      <Icon className="size-3.5" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{def.label}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        <div className="mt-auto flex items-center gap-2 pt-3">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    className="w-full cursor-not-allowed border-white/15 bg-white/5 text-white/50"
                  >
                    Request a Quote
                    <ArrowRight className="ml-1 size-3.5" />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Coming soon</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Badge variant="outline" className="border-white/15 bg-transparent text-[10px] uppercase tracking-wider text-white/50">
            <Users className="mr-1 size-3" />
            Preview
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
