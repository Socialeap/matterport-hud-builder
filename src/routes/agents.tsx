import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Helicopter,
  Sunset,
  Ruler,
  Box,
  Zap,
  Music2,
  Wand2,
  Puzzle,
  Shapes,
  MapPinned,
  Magnet,
  Film,
  Info,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { HeroSlideshow } from "@/components/HeroSlideshow";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import tmLogo from "@/assets/tm-logo-landscape.png";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BeaconForm } from "@/components/marketplace/BeaconForm";
import { ServiceMatchForm } from "@/components/marketplace/ServiceMatchForm";
import { WorkOrderForm } from "@/components/marketplace/WorkOrderForm";

import { buildStudioUrl } from "@/lib/public-url";
import type { Database } from "@/integrations/supabase/types";

type ServicePreference = "essential" | "preferable";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

const SITE_URL = "https://3dps.transcendencemedia.com";
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
    description: "Import your 3D Captured Tours",
  },
  {
    step: 2,
    title: "Hire for Capture &/or Studio Access",
    description: "Hire your MSP to scan & virtualize your property into a 3D digital twin, and/or get access to their studio to brand and customize the tour presentation yourself.",
  },
  {
    step: 3,
    title: "Launch Your Branded Presentation",
    description: "Inside the studio, you customize branding, AI chat, media, and tour behavior — then download a single HTML presentation folder you own and can share, embed, or host anywhere.",
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
  tooltip: string;
};

// Group 1: On-site scanning / 3D capture services
const SCANNING_FILTERS: ReadonlyArray<FilterOption> = [
  { value: "scan-matterport-pro3", label: "Matterport Pro3", icon: Camera, tooltip: "High-quality LiDAR scanning for indoor/outdoor 3D tours and high-accuracy spatial data." },
  { value: "scan-drone-aerial", label: "Drone / Aerial", icon: Helicopter, tooltip: "Stunning bird's-eye views to highlight the property's scale, plot, and neighborhood context." },
  { value: "scan-twilight-photography", label: "Twilight Photography", icon: Sunset, tooltip: "High-end \"Golden Hour\" hero shots designed to make your listing stop the scroll." },
  { value: "scan-walkthrough-video-clips" as MarketplaceSpecialty, label: "Walk-through Video Clips", icon: Film, tooltip: "Cinematic, ready-to-post video clips for maximum social media engagement and reach." },
  { value: "scan-floor-plans", label: "Floor Plans", icon: Ruler, tooltip: "Professional 2D layouts to help buyers visualize flow, room sizes, and furniture placement." },
  { value: "scan-dimensional-measurements", label: "Dimensional Measurements", icon: Box, tooltip: "More accurate measurements when precise sizing and dimensions matter." },
  { value: "scan-same-day-turnaround", label: "Two-Day Turnaround", icon: Zap, tooltip: "Get your finalized 3D tour delivered within 48 hrs, not next week." },
];

// Group 2: Studio services with minimum-quantity hints
const STUDIO_FILTERS: ReadonlyArray<FilterOption> = [
  { value: "vault-sound-library", label: "Sound Library", icon: Music2, note: "12+ tracks", tooltip: "Set the mood with curated background music or upload a voice-over intro over an ambient track." },
  { value: "vault-portal-filters", label: "Visual Portal Filters", icon: Wand2, note: "3+", tooltip: "Professional color grading & style filters that enhance the property's \"vibe.\"" },
  { value: "vault-interactive-widgets", label: "Interactive Widgets", icon: Puzzle, note: "2+", tooltip: "Interactive overlays for info, comparisons, menus, bookmarks, and more. (Coming Soon)" },
  { value: "vault-custom-icons", label: "Custom Iconography", icon: Shapes, note: "2+ sets", tooltip: "Branded navigation icons for your agency's unique look & feel. (Coming Soon)" },
  { value: "vault-property-mapper", label: "Property Mapper", icon: MapPinned, note: "6+ maps", tooltip: "Upload a detailed PDF with property specs used to train the \"Ask About This Property\" chat." },
  { value: "ai-lead-generation", label: "AI Lead Generation", icon: Magnet, tooltip: "An automated 24/7 assistant to identify and capture buyer leads while you sleep." },
];

const SPECIALTY_LABEL: Record<MarketplaceSpecialty, string> = Object.fromEntries(
  [...SCANNING_FILTERS, ...STUDIO_FILTERS].map((s) => [s.value, s.label]),
) as Record<MarketplaceSpecialty, string>;

interface DirectoryMSP {
  provider_id: string;
  brand_name: string;
  slug: string | null;
  logo_url: string | null;
  tier: "starter" | "pro";
  specialties: MarketplaceSpecialty[];
  primary_city: string;
  region: string;
  // 'polygon' | 'radius' | 'zip' | 'city' | null — set by search_msp_directory.
  // Null on the browse-all (no-input) path.
  match_reason?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function AgentsPage() {
  const { isAuthenticated } = useAuth();
  // The /agents landing page is for agents/clients — Dashboard always opens the Agent Dashboard,
  // even for users who also happen to have provider/admin roles.
  const dashboardTo = "/agent-dashboard";
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
              <Button size="sm" onClick={() => navigate({ to: dashboardTo })}>
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
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-amber-300 lg:text-6xl sm:text-5xl">
            Find a 3D Presentation Studio for{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-blue-400 bg-clip-text text-transparent">
              Your Listings
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            ​
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
            <HeroSlideshow />
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="benefits" className="relative z-10 px-4 py-16 sm:py-24" style={{ background: "rgba(255,255,255,0.02)" }}>
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-amber-300 sm:text-4xl">What Your Listings Get</h2>
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
          <div className="mt-10 flex items-center justify-center gap-2 text-center text-sm font-medium text-white/70">
            <Sparkles className="size-4 text-amber-300" />
            <span className="italic">Curious about our amazing, newly added features? ...</span>
            <a
              href="https://www.transcendencemedia.com/3dps-for-agents"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-amber-300 underline-offset-4 hover:text-amber-200 hover:underline"
            >
              LEARN MORE HERE!
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="relative z-10 px-4 py-16 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold text-amber-300 sm:text-4xl">How It Works</h2>
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
          <h2 className="text-2xl font-bold text-amber-300 sm:text-3xl">You Work Directly With the MSP</h2>
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchMode, setSearchMode] = useState<"city" | "zip">("city");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [zip, setZip] = useState("");
  const [results, setResults] = useState<DirectoryMSP[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(true);
  const [notifyOpen, setNotifyOpen] = useState(false);

  // Browse-all on mount: populate the directory grid with every
  // is_directory_public MSP (no city/zip filter) so visitors immediately
  // see the seeded studios. Searching narrows this list via the existing
  // handleSearch flow; this effect runs once and never overrides results
  // after the user has searched (lastQuery !== null).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("search_msp_directory", {});
      if (cancelled) return;
      if (error) {
        // Non-fatal: empty state will render. Surface in console for ops.
        console.warn("search_msp_directory (browse-all) failed:", error);
        setResults([]);
      } else {
        setResults((data ?? []) as DirectoryMSP[]);
      }
      setBrowseLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const requireAuthThen = (open: () => void) => {
    if (authLoading) return;
    if (!isAuthenticated) {
      const next = encodeURIComponent("/agents#directory");
      toast.message("Please sign in to submit a request.");
      navigate({ to: `/login?next=${next}` });
      return;
    }
    open();
  };
  
  const [lastQuery, setLastQuery] = useState<{ city: string; region: string; zip: string } | null>(
    null,
  );
  // Three-state preferences map. Absent = "Not Needed".
  const [servicePrefs, setServicePrefs] = useState<Map<MarketplaceSpecialty, ServicePreference>>(
    new Map(),
  );

  const setSpecialtyPref = (id: MarketplaceSpecialty, pref: ServicePreference | null) => {
    setServicePrefs((prev) => {
      const next = new Map(prev);
      if (pref === null) next.delete(id);
      else next.set(id, pref);
      return next;
    });
  };

  // Any selected preference (essential OR preferable) acts as a directory filter.
  const selectedSpecialties = useMemo(
    () => new Set<MarketplaceSpecialty>(servicePrefs.keys()),
    [servicePrefs],
  );

  const essentialServices = useMemo(
    () =>
      Array.from(servicePrefs.entries())
        .filter(([, p]) => p === "essential")
        .map(([s]) => s),
    [servicePrefs],
  );
  const preferableServices = useMemo(
    () =>
      Array.from(servicePrefs.entries())
        .filter(([, p]) => p === "preferable")
        .map(([s]) => s),
    [servicePrefs],
  );
  const hasAnyServiceSelected =
    essentialServices.length > 0 || preferableServices.length > 0;


  const reset = () => {
    setCity("");
    setRegion("");
    setZip("");
    setResults(null);
    setServicePrefs(new Map());
    setLastQuery(null);
  };

  const filtered = useMemo(() => {
    if (!results) return null;
    // Essentials = hard filter. Drop MSPs missing any essential service.
    const essentialFiltered =
      essentialServices.length === 0
        ? results
        : results.filter((m) =>
            essentialServices.every((s) => m.specialties.includes(s)),
          );
    // Preferables = soft rank. Sort by match count desc, stable on ties.
    if (preferableServices.length === 0) return essentialFiltered;
    return essentialFiltered
      .map((m, i) => ({
        m,
        i,
        score: preferableServices.reduce(
          (n, s) => n + (m.specialties.includes(s) ? 1 : 0),
          0,
        ),
      }))
      .sort((a, b) => (b.score - a.score) || (a.i - b.i))
      .map((x) => x.m);
  }, [results, essentialServices, preferableServices]);

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
      if (!STATE_RE.test(regionTrim)) {
        // Required so we can geocode the town and test it against
        // each MSP's drawn service area. Without a state, "Bellmore"
        // is ambiguous (NY vs OH) and polygon matching can't run.
        toast.error("Please add a 2-letter state (e.g. NY) so we can match drawn service areas.");
        return;
      }
    } else {
      if (!ZIP_RE.test(zipTrim)) {
        toast.error("ZIP must be 5 digits (or 5+4)");
        return;
      }
    }

    setSearching(true);

    // Geocode the query first so the RPC can test polygon containment
    // and radius coverage against each MSP's drawn service area.
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const geoRes = await fetch("/api/geocode-directory-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: searchMode === "city" ? cityTrim : "",
          region: searchMode === "city" ? regionTrim : "",
          zip: searchMode === "zip" ? zipTrim : "",
        }),
      });
      if (geoRes.ok) {
        const j = (await geoRes.json()) as { lat: number | null; lng: number | null };
        lat = typeof j.lat === "number" ? j.lat : null;
        lng = typeof j.lng === "number" ? j.lng : null;
      }
    } catch {
      // Non-fatal: degrade to ZIP/city fallbacks in SQL.
    }

    // For city searches, if geocoding failed we cannot test drawn
    // service areas. Tell the user instead of silently returning the
    // (likely empty) trigram-only result set.
    if (searchMode === "city" && (lat === null || lng === null)) {
      setSearching(false);
      toast.error(
        `We couldn't locate "${cityTrim}, ${regionTrim}". Check the spelling and state, or search by ZIP.`,
      );
      return;
    }

    const { data, error } = await supabase.rpc("search_msp_directory", {
      p_city: searchMode === "city" ? cityTrim : undefined,
      p_region: searchMode === "city" && regionTrim ? regionTrim : undefined,
      p_zip: searchMode === "zip" ? zipTrim : undefined,
      p_lat: lat ?? undefined,
      p_lng: lng ?? undefined,
    });
    setSearching(false);

    if (error) {
      toast.error("Could not load the directory. Please try again.");
      return;
    }

    // Region narrowing now happens server-side via p_region (when present).
    // No client-side region filter needed.
    const finalRows = (data ?? []) as DirectoryMSP[];
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
          <h2 className="text-3xl font-bold text-amber-300 sm:text-4xl">MSP Directory</h2>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">
            Our live directory of Pro Partners is launching soon. In the meantime,{" "}
            <strong className="font-semibold text-white">
              select the On-Site Scanning & Studio services you're interested in, and
              we'll notify you the moment a Pro Partner is matched in your area.
            </strong>{" "}
            The studio cards shown below are only samples the demo how filtering will work.
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
                      placeholder="State (required, e.g. NY)"
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
                      Find MSPs w/Studio
                    </>
                  )}
                </Button>
              </form>

              <Accordion
                type="single"
                collapsible
                defaultValue="scanning"
                className="space-y-2"
              >
                <AccordionItem
                  value="scanning"
                  className="rounded-md border border-white/10 bg-white/5"
                >
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/80 hover:no-underline">
                    On-Site Scanning
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <FilterGroup
                      title=""
                      options={SCANNING_FILTERS}
                      prefs={servicePrefs}
                      onSetPref={setSpecialtyPref}
                    />
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem
                  value="studio"
                  className="rounded-md border border-white/10 bg-white/5"
                >
                  <AccordionTrigger className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-white/80 hover:no-underline">
                    Studio Presentation
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3">
                    <FilterGroup
                      title=""
                      subtitle="Minimum-quantity service offering"
                      options={STUDIO_FILTERS}
                      prefs={servicePrefs}
                      onSetPref={setSpecialtyPref}
                    />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

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
              <div className="flex flex-wrap justify-end gap-2">
                <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-white/15 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                    onClick={() => requireAuthThen(() => setNotifyOpen(true))}
                    disabled={authLoading}
                  >
                    <MailCheck className="size-4" />
                    {isAuthenticated
                      ? "Notify Me When Matches Are Available"
                      : "Sign in to request matches"}
                  </Button>
                  <DialogContent className="border-white/10 bg-[#0a0e27] text-white sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle className="text-white">
                        Notify me when matched MSPs are available
                      </DialogTitle>
                      <DialogDescription className="text-white/70">
                        We'll create your personal MSP Service Match page and email you a link
                        — including the moment new Pro Partners activate in your area.
                      </DialogDescription>
                    </DialogHeader>
                    {hasAnyServiceSelected ? (
                      <ServiceMatchForm
                        defaultCity={city}
                        defaultRegion={region}
                        defaultZip={zip}
                        essentialServices={essentialServices}
                        preferableServices={preferableServices}
                        onSuccess={() => setNotifyOpen(false)}
                      />
                    ) : (
                      <div className="space-y-3 rounded-md border border-amber-300/30 bg-amber-300/5 p-4 text-sm text-amber-100">
                        <p className="font-semibold">Select at least one service first.</p>
                        <p className="text-amber-100/80">
                          Mark one or more On-Site Scanning or Studio Presentation services
                          as <span className="font-semibold">Essential</span> or{" "}
                          <span className="font-semibold">Preferable</span> in the filter rail,
                          then reopen this dialog. We use those choices to build your
                          MSP Service Match.
                        </p>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>

              </div>


              {!hasSearched && browseLoading && (
                <div className="flex items-center justify-center py-16 text-sm text-white/50">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Loading studios…
                </div>
              )}

              {!hasSearched && !browseLoading && hasResults && (
                <>
                  <p className="text-sm text-white/60">
                    Browsing{" "}
                    <span className="font-medium text-white">
                      {filtered!.length}{" "}
                      {filtered!.length === 1 ? "studio" : "studios"}
                    </span>
                    {essentialServices.length > 0 && preferableServices.length > 0
                      ? " matching your essential services, ranked by preferred"
                      : essentialServices.length > 0
                      ? " matching your essential services"
                      : preferableServices.length > 0
                      ? ", ranked by your preferred services"
                      : " in the directory"}{" "}
                    — search by city or ZIP to narrow.
                  </p>
                  <p className="text-xs italic text-white/50">
                    Note: the studios shown are sample listings for demo
                    purposes. You'll be notified as soon as real matches are
                    found in your area.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {filtered!.map((m) => (
                      <MSPCard
                        key={`${m.slug ?? m.brand_name}`}
                        msp={m}
                        searchLocation={lastQuery}
                        essentialServices={essentialServices}
                        preferableServices={preferableServices}
                        isAuthenticated={isAuthenticated}
                        onRequireAuth={() => requireAuthThen(() => undefined)}
                      />
                    ))}
                  </div>
                </>
              )}

              {!hasSearched && !browseLoading && !hasResults && (
                <DirectoryEmptyState />
              )}

              {hasSearched && !hasResults && (
                <div className="space-y-6">
                  <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-5">
                    <h3 className="text-base font-semibold text-amber-100">
                      No Pro Partner in {lastQuery!.city || lastQuery!.zip} yet.
                    </h3>
                    <p className="mt-1 text-sm text-white/70">
                      Be first in line. Sign in below and we'll email you the moment a
                      local Pro Partner activates in your market.
                    </p>
                  </div>
                  {isAuthenticated ? (
                    <BeaconForm
                      defaultCity={lastQuery!.city}
                      defaultRegion={lastQuery!.region}
                      defaultZip={lastQuery!.zip}
                      variant="dark"
                      hideLocationFields
                    />
                  ) : (
                    <div className="rounded-md border border-white/10 bg-white/5 p-5 text-sm text-white/80">
                      <p>
                        We require sign-in for new requests so MSPs only receive
                        intent-driven inquiries.
                      </p>
                      <Button
                        size="sm"
                        className="mt-3 gap-2"
                        onClick={() =>
                          navigate({
                            to: `/login?next=${encodeURIComponent("/agents#directory")}`,
                          })
                        }
                      >
                        Sign in to be notified
                      </Button>
                    </div>
                  )}
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
                      <MSPCard
                        key={`${m.slug ?? m.brand_name}`}
                        msp={m}
                        searchLocation={lastQuery}
                        essentialServices={essentialServices}
                        preferableServices={preferableServices}
                        isAuthenticated={isAuthenticated}
                        onRequireAuth={() => requireAuthThen(() => undefined)}
                      />
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
  prefs,
  onSetPref,
}: {
  title: string;
  subtitle?: string;
  options: ReadonlyArray<FilterOption>;
  prefs: Map<MarketplaceSpecialty, ServicePreference>;
  onSetPref: (id: MarketplaceSpecialty, pref: ServicePreference | null) => void;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <div>
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/60">{title}</p>
          {subtitle && <p className="mt-0.5 text-[10px] text-white/40">{subtitle}</p>}
        </div>
        <div className="space-y-2">
          {options.map((f) => {
            const current = prefs.get(f.value) ?? null;
            const Icon = f.icon;
            return (
              <Tooltip key={f.value}>
                <TooltipTrigger asChild>
                  <div
                    className={`flex flex-col gap-1.5 rounded-md border px-2.5 py-2 text-sm transition-colors ${
                      current
                        ? "border-cyan-300/40 bg-cyan-300/5 text-white"
                        : "border-white/10 bg-white/5 text-white/70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="size-3.5 shrink-0 opacity-70" />
                      <span className="flex-1 truncate">{f.label}</span>
                      <Info className="size-3 shrink-0 opacity-50" aria-hidden />
                      {f.note && (
                        <span className="shrink-0 text-[10px] text-white/40">{f.note}</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-1 rounded bg-white/5 p-0.5">
                      {([
                        { v: null, label: "Not Needed" },
                        { v: "preferable", label: "Preferable" },
                        { v: "essential", label: "Essential" },
                      ] as const).map((opt) => {
                        const active = current === opt.v;
                        return (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => onSetPref(f.value, opt.v)}
                            className={`rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${
                              active
                                ? opt.v === "essential"
                                  ? "bg-amber-300 text-[#0a0e27]"
                                  : opt.v === "preferable"
                                    ? "bg-cyan-400 text-[#0a0e27]"
                                    : "bg-white/20 text-white"
                                : "text-white/60 hover:text-white"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs text-xs leading-snug">
                  {f.tooltip}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}


function MSPCard({
  msp,
  searchLocation,
  essentialServices,
  preferableServices,
  isAuthenticated,
  onRequireAuth,
}: {
  msp: DirectoryMSP;
  searchLocation: { city: string; region: string; zip: string } | null;
  essentialServices: MarketplaceSpecialty[];
  preferableServices: MarketplaceSpecialty[];
  isAuthenticated: boolean;
  onRequireAuth: () => void;
}) {
  const isPro = msp.tier === "pro";
  const studioUrl = msp.slug
    ? buildStudioUrl(msp.slug, { tier: msp.tier, customDomain: null })
    : null;
  const [requestOpen, setRequestOpen] = useState(false);
  const navigate = useNavigate();

  const handleRequestAvailability = () => {
    if (!isAuthenticated) {
      onRequireAuth();
      return;
    }
    if (!searchLocation || (!searchLocation.city && !searchLocation.zip)) {
      toast.message(
        "Set the property location first — search by city or ZIP to enable a Request Availability flow.",
      );
      return;
    }
    setRequestOpen(true);
  };

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
              <h3 className="truncate text-base font-semibold text-amber-300">{msp.brand_name}</h3>
              <div className="flex shrink-0 items-center gap-1.5">
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
            {msp.match_reason && (
              <p className="mt-1 text-[10px] uppercase tracking-wider text-cyan-300/80">
                {msp.match_reason === "polygon" && "Matched: Service area"}
                {msp.match_reason === "radius" && "Matched: Service radius"}
                {msp.match_reason === "zip" && "Matched: Service ZIP"}
                {msp.match_reason === "city" && "Matched: City"}
              </p>
            )}
          </div>
        </div>

        {msp.specialties.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msp.specialties.map((s) => {
              const opt = [...SCANNING_FILTERS, ...STUDIO_FILTERS].find((o) => o.value === s);
              if (!opt) return null;
              const Icon = opt.icon;
              return (
                <span
                  key={s}
                  title={opt.label}
                  aria-label={opt.label}
                  className="inline-flex size-7 items-center justify-center rounded-md bg-white/5 text-white/70 ring-1 ring-white/10"
                >
                  <Icon className="size-3.5" />
                </span>
              );
            })}
          </div>
        )}

        {/* Primary CTA: Request Availability (on-platform). Secondary: Studio. */}
        <div className="mt-auto flex flex-col gap-2 pt-3">
          <Button
            size="sm"
            onClick={handleRequestAvailability}
            className="w-full gap-2"
          >
            <MailCheck className="size-3.5" />
            Request Availability
          </Button>
          {studioUrl ? (
            <a href={studioUrl} target="_blank" rel="noreferrer">
              <Button
                size="sm"
                variant="outline"
                className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                View Studio
                <ArrowRight className="ml-1 size-3.5" />
              </Button>
            </a>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled
              className="w-full cursor-not-allowed border-white/15 bg-white/5 text-white/50"
            >
              Studio coming soon
            </Button>
          )}
        </div>
      </CardContent>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="border-white/10 bg-[#0a0e27] text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white">
              Request Availability from {msp.brand_name}
            </DialogTitle>
            <DialogDescription className="text-white/70">
              We'll send {msp.brand_name} an anonymized request to mark themselves
              Available or Not Available by the next business window. Your
              contact info and full address are shared only after you confirm
              this MSP.
            </DialogDescription>
          </DialogHeader>
          {searchLocation && (
            <WorkOrderForm
              variant="direct"
              selectedProviderIds={[msp.provider_id]}
              selectedBrandSummary={msp.brand_name}
              city={searchLocation.city || msp.primary_city}
              region={searchLocation.region || msp.region}
              zip={searchLocation.zip}
              essentialServices={essentialServices}
              preferableServices={preferableServices}
              onSuccess={(workOrderId) => {
                setRequestOpen(false);
                navigate({
                  to: "/agent-dashboard/work-orders/$id",
                  params: { id: workOrderId },
                });
              }}
              onCancel={() => setRequestOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Directory empty state (pre-search)                                  */
/* ------------------------------------------------------------------ */

function DirectoryEmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
      <Search className="mx-auto mb-3 size-6 text-white/40" />
      <p className="text-sm font-medium text-white">
        Search by city or ZIP to find studios in your area
      </p>
      <p className="mt-1 text-xs text-white/50">
        Filter by the on-site scanning and studio services that matter for your
        listing, then request availability from qualified MSPs.
      </p>
    </div>
  );
}
