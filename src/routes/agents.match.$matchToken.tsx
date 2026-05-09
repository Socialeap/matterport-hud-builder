import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { buildStudioUrl } from "@/lib/public-url";
import {
  ArrowRight, Building2, Clock, ExternalLink, Globe, Loader2, Mail,
  MapPin, Phone, Sparkles, Star,
} from "lucide-react";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

export const Route = createFileRoute("/agents/match/$matchToken")({
  component: MatchPage,
});

interface SummaryActive {
  status: "active";
  city: string;
  region: string | null;
  zip: string | null;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  pro_visibility_until: string | null;
  expires_at: string;
  created_at: string;
  is_pro_window: boolean;
}
type Summary = SummaryActive | { status: "expired" | "not_found" };

interface ResultRow {
  provider_id: string;
  brand_name: string;
  slug: string | null;
  logo_url: string | null;
  tier: "starter" | "pro";
  primary_city: string | null;
  region: string | null;
  directory_website_url: string | null;
  directory_contact_email: string | null;
  directory_phone: string | null;
  match_score: number;
  match_quality: string;
  matched_essential: MarketplaceSpecialty[];
  matched_preferable: MarketplaceSpecialty[];
  missing_preferable: MarketplaceSpecialty[];
}

const formatLabel = (s: string) =>
  s.replace(/^scan-|^vault-|^ai-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function MatchPage() {
  const { matchToken } = Route.useParams();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notifyingId, setNotifyingId] = useState<string | null>(null);
  const [notifiedIds, setNotifiedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const [{ data: sumData, error: sumErr }, { data: resData, error: resErr }] = await Promise.all([
        supabase.rpc("get_service_match_summary", { p_match_token: matchToken }),
        supabase.rpc("get_service_match_results", { p_match_token: matchToken }),
      ]);
      if (!active) return;
      if (sumErr || resErr) {
        console.error("match page load failed:", sumErr ?? resErr);
        setLoadError((sumErr ?? resErr)?.message || "Backend request failed");
        setSummary(null);
        setResults([]);
      } else {
        setSummary((sumData as unknown as Summary) ?? { status: "not_found" });
        setResults(((resData as unknown as ResultRow[]) ?? []));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [matchToken]);

  const proWindowCountdown = useMemo(() => {
    if (!summary || summary.status !== "active" || !summary.pro_visibility_until) return null;
    const ms = new Date(summary.pro_visibility_until).getTime() - Date.now();
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  }, [summary]);

  const recordEvent = async (
    providerId: string,
    eventType: "click_studio" | "click_website" | "click_email" | "click_phone" | "notify_msp",
  ) => {
    await supabase.rpc("record_service_match_interest", {
      p_match_token: matchToken,
      p_provider_id: providerId,
      p_event_type: eventType,
    });
  };

  const handleNotify = async (providerId: string) => {
    setNotifyingId(providerId);
    const { data, error } = await supabase.rpc("record_service_match_interest", {
      p_match_token: matchToken,
      p_provider_id: providerId,
      p_event_type: "notify_msp",
    });
    setNotifyingId(null);
    if (error) {
      toast.error("Could not send your interest. Please try again.");
      return;
    }
    const ok = (data as { success?: boolean })?.success !== false;
    if (ok) {
      setNotifiedIds((s) => new Set(s).add(providerId));
      toast.success("Studio notified — they'll reach out directly.");
    } else {
      toast.error("Could not send your interest.");
    }
  };

  const bg = "#0a0e27";
  const gridColor = "rgba(148,163,184,0.06)";

  return (
    <div className="dark relative min-h-screen text-foreground" style={{ backgroundColor: bg }}>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
          backgroundSize: "70px 70px",
        }}
      />
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -left-32 -top-20 h-[500px] w-[500px] rounded-full blur-[160px]" style={{ background: "rgba(37,99,235,0.15)" }} />
        <div className="absolute right-0 top-[30%] h-[400px] w-[450px] rounded-full blur-[140px]" style={{ background: "rgba(99,102,241,0.12)" }} />
      </div>

      <header className="relative z-10 border-b border-white/10 bg-[#0a0e27]/60 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/agents" className="text-sm text-white/70 hover:text-white">← MSP Directory</Link>
          <span className="text-xs text-white/50">3D Presentation Studio</span>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:py-14">
        <div className="mb-8 text-center">
          <Badge className="mb-3 bg-white/10 text-white/80 backdrop-blur">MSP Service Match</Badge>
          <h1 className="text-3xl font-bold text-amber-300 sm:text-4xl">Your matched studios</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/60">
            Studios serving your area, ranked by how well they fit the services you flagged.
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20 text-white/60">
            <Loader2 className="mr-2 size-5 animate-spin" /> Loading your match…
          </div>
        )}

        {!loading && summary?.status === "not_found" && (
          <Card className="border-white/10 bg-white/5">
            <CardContent className="p-8 text-center text-white/70">
              <p className="text-base font-semibold text-white">Match not found</p>
              <p className="mt-2 text-sm">This match link is invalid or has been removed.</p>
            </CardContent>
          </Card>
        )}

        {!loading && summary?.status === "expired" && (
          <Card className="border-white/10 bg-white/5">
            <CardContent className="p-8 text-center text-white/70">
              <p className="text-base font-semibold text-white">This match has expired</p>
              <p className="mt-2 text-sm">
                You can <Link to="/agents" className="text-cyan-300 underline">create a new MSP Service Match</Link> any time.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && summary?.status === "active" && (
          <>
            <Card className="mb-6 border-white/10 bg-white/5 backdrop-blur">
              <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/50">Location</p>
                  <p className="mt-1 flex items-center gap-1 text-sm font-semibold text-white">
                    <MapPin className="size-3.5 text-cyan-300" />
                    {summary.city}{summary.region ? `, ${summary.region}` : ""}{summary.zip ? ` · ${summary.zip}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/50">Services</p>
                  <p className="mt-1 text-sm text-white">
                    <span className="text-amber-200">{summary.essential_services.length} essential</span>
                    {" · "}
                    <span className="text-cyan-200">{summary.preferable_services.length} preferable</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-white/50">Window</p>
                  {summary.is_pro_window && proWindowCountdown ? (
                    <p className="mt-1 flex items-center gap-1 text-sm text-cyan-200">
                      <Clock className="size-3.5" /> Pro Partners only · {proWindowCountdown} left
                    </p>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-sm text-white/70">
                      <Sparkles className="size-3.5" /> All qualifying studios
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {results.length === 0 ? (
              <Card className="border-white/10 bg-white/5">
                <CardContent className="p-8 text-center text-white/70">
                  <p className="text-base font-semibold text-white">No studios match yet</p>
                  <p className="mt-2 text-sm">
                    We'll keep watching your area. As soon as a qualifying studio appears, you'll get
                    an email update.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {results.map((r) => (
                  <ResultCard
                    key={r.provider_id}
                    row={r}
                    notified={notifiedIds.has(r.provider_id)}
                    notifying={notifyingId === r.provider_id}
                    onNotify={() => handleNotify(r.provider_id)}
                    recordEvent={recordEvent}
                  />
                ))}
              </div>
            )}

            <div className="mt-10 rounded-md border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/60">
              <p className="flex items-start gap-2">
                <Star className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                <span>
                  If you hire any matched MSP for one of the listed services, you may receive a
                  request to provide a short satisfaction rating. Your feedback helps us improve
                  future MSP Service Match results.
                </span>
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function ResultCard({
  row, notified, notifying, onNotify, recordEvent,
}: {
  row: ResultRow;
  notified: boolean;
  notifying: boolean;
  onNotify: () => void;
  recordEvent: (id: string, t: "click_studio" | "click_website" | "click_email" | "click_phone") => void;
}) {
  const isPro = row.tier === "pro";
  const studioUrl = row.slug ? buildStudioUrl(row.slug, { tier: row.tier, customDomain: null }) : null;

  return (
    <Card className="flex h-full flex-col border-white/10 bg-white/5 backdrop-blur transition-all hover:border-cyan-300/30">
      <CardContent className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-white">
            {row.logo_url
              ? <img src={row.logo_url} alt={`${row.brand_name} logo`} className="size-full object-contain" loading="lazy" />
              : <Building2 className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="truncate text-base font-semibold text-amber-300">{row.brand_name}</h3>
              <div className="flex shrink-0 items-center gap-1.5">
                {isPro && <Badge className="bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-300/30">Pro</Badge>}
                <Badge className="bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/30">{row.match_quality}</Badge>
              </div>
            </div>
            {(row.primary_city || row.region) && (
              <p className="flex items-center gap-1 text-xs text-white/50">
                <MapPin className="size-3" />
                {[row.primary_city, row.region].filter(Boolean).join(", ")}
              </p>
            )}
          </div>
        </div>

        {row.matched_essential.length > 0 && (
          <p className="text-xs text-white/70">
            <span className="text-amber-200">Essential met:</span>{" "}
            {row.matched_essential.map(formatLabel).join(", ")}
          </p>
        )}
        {row.matched_preferable.length > 0 && (
          <p className="text-xs text-white/70">
            <span className="text-cyan-200">Preferable met:</span>{" "}
            {row.matched_preferable.map(formatLabel).join(", ")}
          </p>
        )}
        {row.missing_preferable.length > 0 && (
          <p className="text-xs text-white/40">
            Missing preferable: {row.missing_preferable.map(formatLabel).join(", ")}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {studioUrl && (
            <a href={studioUrl} target="_blank" rel="noreferrer" onClick={() => recordEvent(row.provider_id, "click_studio")}>
              <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                Visit Studio <ArrowRight className="ml-1 size-3.5" />
              </Button>
            </a>
          )}
          {row.directory_website_url && (
            <a href={row.directory_website_url} target="_blank" rel="noreferrer" onClick={() => recordEvent(row.provider_id, "click_website")}>
              <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Globe className="size-3.5" /> Website <ExternalLink className="size-3" />
              </Button>
            </a>
          )}
          {row.directory_contact_email && (
            <a href={`mailto:${row.directory_contact_email}`} onClick={() => recordEvent(row.provider_id, "click_email")}>
              <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Mail className="size-3.5" /> Email
              </Button>
            </a>
          )}
          {row.directory_phone && (
            <a href={`tel:${row.directory_phone.replace(/[^\d+]/g, "")}`} onClick={() => recordEvent(row.provider_id, "click_phone")}>
              <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10">
                <Phone className="size-3.5" /> Call
              </Button>
            </a>
          )}
        </div>

        <Button
          size="sm"
          disabled={notified || notifying}
          onClick={onNotify}
          className="mt-2 w-full gap-2"
        >
          {notified ? "Notified ✓" : notifying ? "Notifying…" : "Notify this MSP I'm interested"}
        </Button>
      </CardContent>
    </Card>
  );
}
