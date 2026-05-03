import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MapPin,
  TrendingUp,
  Users,
  Sparkles,
  CheckCircle2,
  Loader2,
  ChevronRight,
} from "lucide-react";
import tmLogo from "@/assets/tm-logo-landscape.png";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const SITE_URL = "https://matterport-hud-builder.lovable.app";
const PAGE_URL = `${SITE_URL}/opportunities`;
const OG_TITLE = "Local Demand Board for Matterport Service Providers";
const OG_DESC =
  "See where real estate agents are actively looking for a 3D Presentation Studio Pro Partner. Activate your Studio to start receiving local leads in markets with confirmed demand.";
const OG_IMAGE = `${SITE_URL}/og-3d-presentation-studio.png`;

export const Route = createFileRoute("/opportunities")({
  head: () => ({
    meta: [
      { title: OG_TITLE },
      { name: "description", content: OG_DESC },
      {
        name: "keywords",
        content:
          "Matterport leads, MSP demand, real estate 3D tour leads, Matterport service provider demand, 3D presentation studio territory",
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
  component: OpportunitiesPage,
});

interface DemandRow {
  city: string;
  region: string;
  waiting_count: number;
}

function OpportunitiesPage() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<DemandRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("public_beacon_demand");
      if (cancelled) return;
      if (error) {
        toast.error("Could not load the demand board");
        setLoading(false);
        return;
      }
      setRows((data ?? []) as DemandRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAgents = (rows ?? []).reduce((sum, r) => sum + r.waiting_count, 0);
  const marketCount = rows?.length ?? 0;

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
          style={{ background: "rgba(244,114,182,0.12)" }}
        />
        <div
          className="absolute right-0 top-[30%] h-[400px] w-[450px] rounded-full blur-[140px]"
          style={{ background: "rgba(251,191,36,0.10)" }}
        />
        <div
          className="absolute bottom-[10%] left-[20%] h-[350px] w-[400px] rounded-full blur-[180px]"
          style={{ background: "rgba(34,197,94,0.10)" }}
        />
      </div>

      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0a0e27]/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center" aria-label="3D Presentation Studio — home">
              <img
                src={tmLogo}
                alt="Transcendence Media"
                className="h-[50px] w-auto sm:h-[55px]"
              />
            </Link>
            <span className="hidden text-sm font-bold tracking-tight text-white sm:inline lg:text-base">
              For Matterport Service Providers
            </span>
          </div>

          <nav className="flex items-center gap-3 sm:gap-6">
            <Link
              to="/agents"
              className="hidden text-sm text-white/70 transition-colors hover:text-white sm:inline"
            >
              For Agents →
            </Link>
            {isAuthenticated ? (
              <Button size="sm" onClick={() => navigate({ to: "/dashboard" })}>
                Dashboard
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-white/80 hover:bg-white/10 hover:text-white"
                  onClick={() => navigate({ to: "/login" })}
                >
                  Sign In
                </Button>
                <Button size="sm" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}>
                  Activate Studio
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 px-4 pt-24 pb-12 sm:pt-32 sm:pb-16">
        <div className="mx-auto max-w-4xl text-center">
          <Badge className="mb-4 bg-amber-300/15 text-amber-200 backdrop-blur">
            <TrendingUp className="mr-1 size-3" />
            Local Demand Board
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-white lg:text-6xl sm:text-5xl">
            Real agents are{" "}
            <span className="bg-gradient-to-r from-amber-300 to-pink-400 bg-clip-text text-transparent">
              waiting in your market.
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
            Every market below has confirmed real-estate agents who've requested a local 3D
            Presentation Studio Pro Partner. Activate your Studio to start receiving these leads
            as they're matched to your service area.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isAuthenticated ? (
              <Button size="lg" onClick={() => navigate({ to: "/dashboard/branding" })} className="gap-2">
                Configure Your Listing
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button size="lg" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })} className="gap-2">
                Activate Your Studio
                <ChevronRight className="size-4" />
              </Button>
            )}
            <a href="#demand">
              <Button
                size="lg"
                variant="outline"
                className="border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                See the Demand Board
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Stats strip */}
      {!loading && rows && rows.length > 0 && (
        <section className="relative z-10 px-4 pb-12">
          <div className="mx-auto grid max-w-3xl grid-cols-2 gap-4">
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardContent className="flex items-center gap-4 p-5">
                <Users className="size-8 text-amber-200" />
                <div>
                  <div className="text-2xl font-bold text-white">{totalAgents}</div>
                  <div className="text-xs uppercase tracking-wider text-white/50">
                    Agents Waiting
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-white/10 bg-white/5 backdrop-blur">
              <CardContent className="flex items-center gap-4 p-5">
                <MapPin className="size-8 text-pink-300" />
                <div>
                  <div className="text-2xl font-bold text-white">{marketCount}</div>
                  <div className="text-xs uppercase tracking-wider text-white/50">
                    Active Markets
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* Demand board */}
      <section
        id="demand"
        className="relative z-10 px-4 py-16 sm:py-20"
        style={{ background: "rgba(255,255,255,0.02)" }}
      >
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">Where the Demand Is</h2>
            <p className="mx-auto max-w-2xl text-white/60">
              Markets with three or more confirmed agents waiting. The list updates live as new
              agents join the waitlist.
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="size-8 animate-spin text-white/40" />
            </div>
          ) : !rows || rows.length === 0 ? (
            <div className="mx-auto max-w-xl rounded-lg border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
              <Sparkles className="mx-auto mb-3 size-8 text-white/30" />
              <p className="text-sm text-white/60">
                No markets above the visibility threshold yet. Be the first Pro Partner to
                activate — agents joining the waitlist will start matching to your service area
                immediately.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <DemandCard key={`${row.city}-${row.region ?? ""}`} row={row} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* How it works (MSP-side) */}
      <section className="relative z-10 px-4 py-16 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-10 flex flex-col items-center justify-center gap-3 text-center">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">How Lead Matching Works</h2>
            <p className="mx-auto max-w-2xl text-white/60">
              The Marketplace is a supplemental marketing channel — it doesn't replace your
              existing branding or workflow. Think of it as another wing capturing 3DPS-aware
              leads in your service area.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            <StepCard
              step={1}
              title="Activate your Studio"
              description="Spin up your branded 3D Presentation Studio and configure your service area — primary city, ZIPs, and specialties."
            />
            <StepCard
              step={2}
              title="Match with waiting agents"
              description="Agents who joined the waitlist for your city get notified the moment your listing goes public. New agents who arrive after you're listed match instantly."
            />
            <StepCard
              step={3}
              title="Win their first scan"
              description="The Marketplace funnels 3DPS-aware demand to you. You handle the scan, they get a branded interactive presentation — and your client roster grows."
            />
          </div>

          <div className="mt-10 flex justify-center">
            {isAuthenticated ? (
              <Button size="lg" onClick={() => navigate({ to: "/dashboard/branding" })} className="gap-2">
                Configure Your Listing
                <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button size="lg" onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })} className="gap-2">
                Activate Your Studio
                <ChevronRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 bg-[#070b1f] px-4 py-10">
        <div className="mx-auto max-w-6xl text-center text-xs text-white/40">
          <p>
            © {new Date().getFullYear()} Transcendence Media · 3D Presentation Studio.{" "}
            <Link to="/agents" className="underline hover:text-white/60">
              For Agents
            </Link>{" "}
            ·{" "}
            <Link to="/" className="underline hover:text-white/60">
              For MSPs
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function DemandCard({ row }: { row: DemandRow }) {
  return (
    <Card className="group flex flex-col border-white/10 bg-white/5 transition-all hover:-translate-y-0.5 hover:border-amber-300/40">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold text-white">
              {row.city}
              {row.region && (
                <span className="ml-1 text-sm font-normal text-white/50">, {row.region}</span>
              )}
            </h3>
          </div>
          <Badge className="shrink-0 bg-amber-300/15 text-amber-200 ring-1 ring-amber-300/30">
            <Users className="mr-1 size-3" />
            {row.waiting_count}
          </Badge>
        </div>
        <p className="text-sm text-white/70">
          {row.waiting_count} {row.waiting_count === 1 ? "agent" : "agents"} waiting for a local
          Pro Partner.
        </p>
        <div className="mt-auto flex items-center gap-1.5 pt-2 text-xs text-white/40">
          <CheckCircle2 className="size-3 text-emerald-300" />
          <span>Confirmed local demand</span>
        </div>
      </CardContent>
    </Card>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <Card className="border-white/10 bg-white/5 backdrop-blur">
      <CardContent className="flex flex-col gap-3 p-6">
        <div className="flex size-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300/20 to-pink-400/20 text-lg font-bold text-amber-200 ring-1 ring-amber-300/30">
          {step}
        </div>
        <h3 className="text-lg font-semibold text-white">{title}</h3>
        <p className="text-sm leading-relaxed text-white/65">{description}</p>
      </CardContent>
    </Card>
  );
}
