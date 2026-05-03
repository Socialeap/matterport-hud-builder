import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bot,
  Video,
  MailCheck,
  Sparkles,
  MapPin,
  Search,
  ChevronRight,
  Building2,
  Users,
  CheckCircle2,
  ArrowRight,
  Loader2,
  Camera,
  Plane,
  Sunset,
  Ruler,
  Sofa,
  Zap,
  Music2,
  Wand2,
  Puzzle,
  Shapes,
  MapPinned,
  Magnet,
  Info,
} from "lucide-react";
import heroHudBanner from "@/assets/hero-hud-showcase.png";
import tmLogo from "@/assets/tm-logo-landscape.png";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BeaconForm } from "@/components/marketplace/BeaconForm";
import { buildStudioUrl } from "@/lib/public-url";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

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

type FilterOption = {
  value: MarketplaceSpecialty;
  label: string;
  icon: typeof Camera;
  note?: string;
};

// Group 1: On-site scanning / 3D capture services
const SCANNING_FILTERS: ReadonlyArray<FilterOption> = [
  { value: "scan-matterport-pro3", label: "Matterport Pro3", icon: Camera },
  { value: "scan-drone-aerial", label: "Drone / Aerial", icon: Plane },
  { value: "scan-twilight-photography", label: "Twilight Photography", icon: Sunset },
  { value: "scan-floor-plans", label: "Floor Plans", icon: Ruler },
  { value: "scan-dimensional-measurements", label: "Dimensional Measurements", icon: Sofa },
  { value: "scan-same-day-turnaround", label: "Same-Day Turnaround", icon: Zap },
];

// Group 2: Studio (Production Vault) services with minimum-quantity hints
const STUDIO_FILTERS: ReadonlyArray<FilterOption> = [
  { value: "vault-sound-library", label: "Sound Library", icon: Music2, note: "12+ tracks" },
  { value: "vault-portal-filters", label: "Visual Portal Filters", icon: Wand2, note: "3+" },
  { value: "vault-interactive-widgets", label: "Interactive Widgets", icon: Puzzle, note: "2+" },
  { value: "vault-custom-icons", label: "Custom Iconography", icon: Shapes, note: "2+ sets" },
  { value: "vault-property-mapper", label: "Property Mapper", icon: MapPinned, note: "6+ maps" },
  { value: "ai-lead-generation", label: "AI Lead Generation", icon: Magnet },
];

const SPECIALTY_LABEL: Record<MarketplaceSpecialty, string> = Object.fromEntries(
  [...SCANNING_FILTERS, ...STUDIO_FILTERS].map((s) => [s.value, s.label]),
) as Record<MarketplaceSpecialty, string>;

interface DirectoryMSP {
  brand_name: string;
  slug: string | null;
  logo_url: string | null;
  tier: "starter" | "pro";
  specialties: MarketplaceSpecialty[];
  primary_city: string;
  region: string;
}

// Sample MSPs shown for demonstration before the live directory is populated.
// `slug: null` makes MSPCard render a disabled "Studio coming soon" CTA — no
// broken links. These are clearly labeled as "Sample" in the UI.
const MOCK_MSPS: DirectoryMSP[] = [
  {
    brand_name: "Skyline 3D Studios",
    slug: null,
    logo_url: null,
    tier: "pro",
    specialties: [
      "scan-matterport-pro3",
      "scan-drone-aerial",
      "scan-twilight-photography",
      "vault-sound-library",
      "vault-portal-filters",
      "ai-lead-generation",
    ],
    primary_city: "Atlanta",
    region: "GA",
  },
  {
    brand_name: "Coastal Tour Co.",
    slug: null,
    logo_url: null,
    tier: "starter",
    specialties: ["scan-matterport-pro3", "scan-floor-plans", "scan-same-day-turnaround"],
    primary_city: "San Diego",
    region: "CA",
  },
  {
    brand_name: "Lakeshore Immersive",
    slug: null,
    logo_url: null,
    tier: "pro",
    specialties: [
      "scan-matterport-pro3",
      "scan-dimensional-measurements",
      "vault-interactive-widgets",
      "vault-property-mapper",
    ],
    primary_city: "Chicago",
    region: "IL",
  },
  {
    brand_name: "Lone Star Spaces",
    slug: null,
    logo_url: null,
    tier: "starter",
    specialties: ["scan-matterport-pro3", "scan-drone-aerial", "vault-custom-icons"],
    primary_city: "Austin",
    region: "TX",
  },
  {
    brand_name: "Mile High Matterworks",
    slug: null,
    logo_url: null,
    tier: "pro",
    specialties: [
      "scan-matterport-pro3",
      "scan-twilight-photography",
      "vault-sound-library",
      "vault-property-mapper",
      "ai-lead-generation",
    ],
    primary_city: "Denver",
    region: "CO",
  },
  {
    brand_name: "Beacon Hill Tours",
    slug: null,
    logo_url: null,
    tier: "starter",
    specialties: ["scan-matterport-pro3", "scan-floor-plans", "vault-portal-filters"],
    primary_city: "Boston",
    region: "MA",
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
/*  Directory section (live)                                           */
/* ------------------------------------------------------------------ */

const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;

function DirectorySection() {
  const [searchMode, setSearchMode] = useState<"city" | "zip">("city");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zip, setZip] = useState("");
  const [results, setResults] = useState<DirectoryMSP[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState<{ city: string; region: string; zip: string } | null>(
    null,
  );
  const [selectedSpecialties, setSelectedSpecialties] = useState<Set<MarketplaceSpecialty>>(
    new Set(),
  );

  const toggleSpecialty = (id: MarketplaceSpecialty) => {
    setSelectedSpecialties((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setCity("");
    setRegion("");
    setZip("");
    setResults(null);
    setSelectedSpecialties(new Set());
    setLastQuery(null);
  };

  const filtered = useMemo(() => {
    if (!results) return null;
    if (selectedSpecialties.size === 0) return results;
    return results.filter((m) =>
      Array.from(selectedSpecialties).every((s) => m.specialties.includes(s)),
    );
  }, [results, selectedSpecialties]);

  // Demo cards mirror the same specialty-filter behavior as live results, so
  // visitors get an immediate sense of how filtering works before any Pros
  // are live in their city.
  const visibleMocks = useMemo(() => {
    if (selectedSpecialties.size === 0) return MOCK_MSPS;
    return MOCK_MSPS.filter((m) =>
      Array.from(selectedSpecialties).every((s) => m.specialties.includes(s)),
    );
  }, [selectedSpecialties]);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    const cityTrim = city.trim();
    const regionTrim = region.trim().toUpperCase();
    const zipTrim = zip.trim();

    if (searchMode === "city") {
      if (cityTrim.length < 2) {
        toast.error("Please enter a city");
        return;
      }
      if (regionTrim && !STATE_RE.test(regionTrim)) {
        toast.error("Please enter a 2-letter state code (e.g. GA)");
        return;
      }
    } else {
      if (!ZIP_RE.test(zipTrim)) {
        toast.error("ZIP must be 5 digits (or 5+4)");
        return;
      }
    }

    setSearching(true);
    const { data, error } = await supabase.rpc("search_msp_directory", {
      p_city: searchMode === "city" ? cityTrim : undefined,
      p_zip: searchMode === "zip" ? zipTrim : undefined,
    });
    setSearching(false);

    if (error) {
      toast.error("Could not load the directory. Please try again.");
      return;
    }

    // We only filter by region client-side — the RPC is city-only by design
    // (zip is ANY-of-array). This keeps the SQL simple and lets us surface
    // results from MSPs serving multiple states with the same city name.
    const rows = (data ?? []) as DirectoryMSP[];
    const finalRows = regionTrim
      ? rows.filter((r) => r.region === regionTrim)
      : rows;
    setResults(finalRows);
    setLastQuery({ city: cityTrim, region: regionTrim, zip: zipTrim });
  };

  const hasSearched = lastQuery !== null;
  const hasResults = (filtered?.length ?? 0) > 0;

  return (
    <section
      id="directory"
      className="relative z-10 px-4 py-16 sm:py-24"
      style={{ background: "rgba(255,255,255,0.02)" }}
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col items-center justify-center gap-3 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">MSP Directory</h2>
          <p className="mx-auto max-w-2xl text-white/60">
            Search by city or ZIP. If no Pro Partner is live in your market yet, drop your details
            so we can notify you the moment one activates locally.
          </p>
        </div>

        <Card className="border-white/10 bg-white/5 p-4 backdrop-blur sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            {/* Filter rail */}
            <aside className="space-y-6">
              <form onSubmit={handleSearch} className="space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/60">
                    Search By
                  </label>
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setSearchMode("city")}
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "city"
                          ? "bg-cyan-400 text-[#0a0e27]"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      City
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchMode("zip")}
                      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                        searchMode === "zip"
                          ? "bg-cyan-400 text-[#0a0e27]"
                          : "text-white/60 hover:text-white"
                      }`}
                    >
                      ZIP
                    </button>
                  </div>
                </div>

                {searchMode === "city" ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
                      <Input
                        placeholder="City"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/40"
                      />
                    </div>
                    <Input
                      placeholder="State (optional, e.g. GA)"
                      value={region}
                      maxLength={2}
                      onChange={(e) =>
                        setRegion(
                          e.target.value.toUpperCase().replace(/[^A-Z]/g, ""),
                        )
                      }
                      className="border-white/10 bg-white/5 text-white placeholder:text-white/40"
                    />
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/40" />
                    <Input
                      placeholder="ZIP code"
                      value={zip}
                      onChange={(e) => setZip(e.target.value)}
                      className="border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/40"
                    />
                  </div>
                )}

                <Button type="submit" disabled={searching} className="w-full gap-2">
                  {searching ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Searching…
                    </>
                  ) : (
                    <>
                      <Search className="size-4" />
                      Find Studios
                    </>
                  )}
                </Button>
              </form>

              <div className="space-y-5">
                <FilterGroup
                  title="On-Site Scanning"
                  options={SCANNING_FILTERS}
                  selected={selectedSpecialties}
                  onToggle={toggleSpecialty}
                />
                <FilterGroup
                  title="Studio Presentation (Production Vault)"
                  subtitle="Minimum-quantity service offering"
                  options={STUDIO_FILTERS}
                  selected={selectedSpecialties}
                  onToggle={toggleSpecialty}
                />
              </div>

              {(hasSearched || selectedSpecialties.size > 0) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="w-full text-white/70 hover:bg-white/10 hover:text-white"
                >
                  Reset
                </Button>
              )}
            </aside>

            {/* Results */}
            <div className="space-y-4">
              {!hasSearched && (
                <DemoPreview
                  mocks={visibleMocks}
                  defaultCity={city}
                  defaultRegion={region}
                  defaultZip={zip}
                />
              )}

              {hasSearched && !hasResults && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-5">
                    <h3 className="text-base font-semibold text-amber-100">
                      No Pro Partner in {lastQuery!.city || lastQuery!.zip} yet.
                    </h3>
                    <p className="mt-1 text-sm text-white/70">
                      Be first in line. Drop your details below and we'll email you the moment a
                      local Pro Partner activates in your market.
                    </p>
                  </div>
                  <BeaconForm
                    defaultCity={lastQuery!.city}
                    defaultRegion={lastQuery!.region}
                    defaultZip={lastQuery!.zip}
                    variant="dark"
                  />
                  <DemoPreview mocks={visibleMocks} hideForm />
                </div>
              )}

              {hasSearched && hasResults && (
                <>
                  <p className="text-sm text-white/60">
                    {filtered!.length} {filtered!.length === 1 ? "Pro Partner" : "Pro Partners"}{" "}
                    serving{" "}
                    <span className="font-medium text-white">
                      {lastQuery!.city || lastQuery!.zip}
                    </span>
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {filtered!.map((m) => (
                      <MSPCard key={`${m.slug ?? m.brand_name}`} msp={m} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}

function FilterGroup({
  title,
  subtitle,
  options,
  selected,
  onToggle,
}: {
  title: string;
  subtitle?: string;
  options: ReadonlyArray<FilterOption>;
  selected: Set<MarketplaceSpecialty>;
  onToggle: (id: MarketplaceSpecialty) => void;
}) {
  return (
    <div>
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-white/60">{title}</p>
        {subtitle && <p className="mt-0.5 text-[10px] text-white/40">{subtitle}</p>}
      </div>
      <div className="space-y-2">
        {options.map((f) => {
          const checked = selected.has(f.value);
          const Icon = f.icon;
          return (
            <label
              key={f.value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                checked
                  ? "border-cyan-300/50 bg-cyan-300/10 text-white"
                  : "border-white/10 bg-white/5 text-white/70 hover:border-white/20 hover:text-white"
              }`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(f.value)}
                className="border-white/30 data-[state=checked]:bg-cyan-400 data-[state=checked]:text-[#0a0e27]"
              />
              <Icon className="size-3.5 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{f.label}</span>
              {f.note && (
                <span className="shrink-0 text-[10px] text-white/40">{f.note}</span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MSPCard({ msp, isSample = false }: { msp: DirectoryMSP; isSample?: boolean }) {
  const isPro = msp.tier === "pro";
  const studioUrl = msp.slug
    ? buildStudioUrl(msp.slug, { tier: msp.tier, customDomain: null })
    : null;

  return (
    <Card className="flex h-full flex-col border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-cyan-300/30">
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-white">
            {msp.logo_url ? (
              <img
                src={msp.logo_url}
                alt={`${msp.brand_name} logo`}
                className="size-full object-contain"
                loading="lazy"
              />
            ) : (
              <Building2 className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-base font-semibold text-white">{msp.brand_name}</h3>
              <div className="flex shrink-0 items-center gap-1.5">
                {isSample && (
                  <Badge className="bg-slate-400/15 text-slate-200 ring-1 ring-slate-300/30">
                    Sample
                  </Badge>
                )}
                {isPro && (
                  <Badge className="bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/30">
                    Pro
                  </Badge>
                )}
              </div>
            </div>
            <p className="flex items-center gap-1 text-xs text-white/50">
              <MapPin className="size-3" />
              {msp.primary_city}, {msp.region}
            </p>
          </div>
        </div>

        {msp.specialties.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msp.specialties.map((s) => (
              <span
                key={s}
                className="inline-flex items-center rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10"
              >
                {SPECIALTY_LABEL[s]}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center gap-2 pt-3">
          {studioUrl ? (
            <a href={studioUrl} target="_blank" rel="noreferrer" className="flex-1">
              <Button
                size="sm"
                variant="outline"
                className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                Visit Studio
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            </a>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="w-full flex-1 cursor-not-allowed border-white/15 bg-white/5 text-white/50"
            >
              Studio coming soon
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
