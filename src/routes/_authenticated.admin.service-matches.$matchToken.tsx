import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Building2, Clock, ExternalLink, Loader2, Mail, MapPin,
  Sparkles, Globe, Phone,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

export const Route = createFileRoute(
  "/_authenticated/admin/service-matches/$matchToken",
)({
  component: AdminServiceMatchDetail,
});

interface BeaconRow {
  id: string;
  email: string;
  name: string | null;
  brokerage: string | null;
  city: string;
  region: string | null;
  zip: string | null;
  country: string;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  match_token: string;
  pro_visibility_until: string | null;
  expires_at: string;
  created_at: string;
  status: string;
  service_match_notified_at: string | null;
}

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

interface DetailPayload {
  status: "ok" | "not_found";
  beacon?: BeaconRow;
  is_pro_window?: boolean;
  results?: ResultRow[];
}

const formatLabel = (s: string) =>
  s.replace(/^scan-|^vault-|^ai-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function AdminServiceMatchDetail() {
  const { matchToken } = Route.useParams();
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data: rpc, error } = await supabase.rpc(
        "get_service_match_detail_for_admin",
        { p_match_token: matchToken },
      );
      if (!active) return;
      if (error) {
        console.error("admin match detail load failed:", error);
        setLoadError(error.message || "Backend request failed");
        setData(null);
      } else {
        setData(rpc as unknown as DetailPayload);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [matchToken]);

  const proCountdown = useMemo(() => {
    const until = data?.beacon?.pro_visibility_until;
    if (!until) return null;
    const ms = new Date(until).getTime() - Date.now();
    if (ms <= 0) return null;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Loading match…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/service-matches">
            <ArrowLeft className="mr-1 size-4" /> Back to Service Match Requests
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-destructive">
            <p className="font-semibold">Could not load match detail</p>
            <p className="mt-2 text-sm">{loadError}</p>
            <p className="mt-2 text-xs text-muted-foreground">Token: <code>{matchToken}</code></p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.status !== "ok" || !data.beacon) {
    return (
      <div className="space-y-4">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/service-matches">
            <ArrowLeft className="mr-1 size-4" /> Back to Service Match Requests
          </Link>
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Match not found for token <code>{matchToken}</code>.
          </CardContent>
        </Card>
      </div>
    );
  }

  const b = data.beacon;
  const results = data.results ?? [];
  const isProWindow = !!data.is_pro_window;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="outline" size="sm">
          <Link to="/admin/service-matches">
            <ArrowLeft className="mr-1 size-4" /> Back
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a
            href={`/agents/match/${b.match_token}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1"
          >
            Open visitor view <ExternalLink className="size-3.5" />
          </a>
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <h2 className="text-lg font-semibold">Visitor</h2>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">Name:</span>{" "}
              <span className="font-medium">{b.name || "—"}</span>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Company:</span>{" "}
              <span className="font-medium">{b.brokerage || "—"}</span>
            </p>
            <p className="text-sm flex items-center gap-1">
              <Mail className="size-3.5 text-muted-foreground" />
              <a href={`mailto:${b.email}`} className="text-primary hover:underline">{b.email}</a>
            </p>
            <p className="text-sm flex items-center gap-1">
              <MapPin className="size-3.5 text-muted-foreground" />
              {[b.city, b.region].filter(Boolean).join(", ")}
              {b.zip ? ` · ${b.zip}` : ""}
            </p>
          </div>
          <div>
            <h2 className="text-lg font-semibold">Request</h2>
            <p className="mt-2 text-sm">
              <span className="text-muted-foreground">Submitted:</span>{" "}
              {new Date(b.created_at).toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Expires:</span>{" "}
              {new Date(b.expires_at).toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Confirmation email:</span>{" "}
              {b.service_match_notified_at
                ? new Date(b.service_match_notified_at).toLocaleString()
                : <span className="italic text-muted-foreground">not sent</span>}
            </p>
            <div className="mt-2">
              {isProWindow && proCountdown ? (
                <Badge className="gap-1">
                  <Clock className="size-3" /> Pro Partner Exclusive — {proCountdown} left
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="size-3" /> Expanded Match Window
                </Badge>
              )}
            </div>
          </div>

          <div className="sm:col-span-2 space-y-2">
            {b.essential_services.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-amber-700">Essential</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {b.essential_services.map((s) => (
                    <Badge key={s} className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                      {formatLabel(s)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {b.preferable_services.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wider text-cyan-700">Preferable</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {b.preferable_services.map((s) => (
                    <Badge key={s} variant="secondary" className="bg-cyan-50 text-cyan-900">
                      {formatLabel(s)}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          Matched MSPs ({results.length})
        </h2>
        {results.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="font-medium text-foreground">No qualifying MSPs yet</p>
              <p className="mt-2 text-sm">
                {isProWindow
                  ? "Currently in the Pro Partner Exclusive window — only Pro studios serving this area and offering all Essential services would appear."
                  : "No public studios serving this area satisfy all of the visitor's Essential services."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {results.map((r) => (
              <Card key={r.provider_id}>
                <CardContent className="flex flex-col gap-2 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                      {r.logo_url
                        ? <img src={r.logo_url} alt="" className="size-full object-contain" />
                        : <Building2 className="size-5 text-muted-foreground" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-semibold">{r.brand_name}</p>
                        <div className="flex shrink-0 gap-1">
                          {r.tier === "pro" && <Badge>Pro</Badge>}
                          <Badge variant="secondary">{r.match_quality}</Badge>
                        </div>
                      </div>
                      {(r.primary_city || r.region) && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="size-3" />
                          {[r.primary_city, r.region].filter(Boolean).join(", ")}
                        </p>
                      )}
                    </div>
                  </div>
                  {r.matched_essential.length > 0 && (
                    <p className="text-xs">
                      <span className="text-amber-700">Essential met:</span>{" "}
                      {r.matched_essential.map(formatLabel).join(", ")}
                    </p>
                  )}
                  {r.matched_preferable.length > 0 && (
                    <p className="text-xs">
                      <span className="text-cyan-700">Preferable met:</span>{" "}
                      {r.matched_preferable.map(formatLabel).join(", ")}
                    </p>
                  )}
                  {r.missing_preferable.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Missing preferable: {r.missing_preferable.map(formatLabel).join(", ")}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    {r.directory_website_url && (
                      <a href={r.directory_website_url} target="_blank" rel="noreferrer"
                         className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Globe className="size-3" /> Website
                      </a>
                    )}
                    {r.directory_contact_email && (
                      <a href={`mailto:${r.directory_contact_email}`}
                         className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Mail className="size-3" /> {r.directory_contact_email}
                      </a>
                    )}
                    {r.directory_phone && (
                      <a href={`tel:${r.directory_phone.replace(/[^\d+]/g, "")}`}
                         className="inline-flex items-center gap-1 text-primary hover:underline">
                        <Phone className="size-3" /> {r.directory_phone}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
