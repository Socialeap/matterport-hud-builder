import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Camera,
  Helicopter,
  Sunset,
  Film,
  Ruler,
  Box,
  Zap,
  Music2,
  Wand2,
  Puzzle,
  Shapes,
  MapPinned,
  Magnet,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
} from "lucide-react";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

export const Route = createFileRoute("/_authenticated/admin/service-matches")({
  component: AdminServiceMatches,
});

interface RequestRow {
  id: string;
  created_at: string;
  email: string;
  name: string | null;
  brokerage: string | null;
  city: string;
  region: string | null;
  zip: string | null;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  match_token: string;
  status: string;
  expires_at: string;
}

const ICONS: Record<MarketplaceSpecialty, { icon: typeof Camera; label: string }> = {
  "scan-matterport-pro3": { icon: Camera, label: "Matterport Pro3" },
  "scan-drone-aerial": { icon: Helicopter, label: "Drone / Aerial" },
  "scan-twilight-photography": { icon: Sunset, label: "Twilight Photography" },
  "scan-walkthrough-video-clips": { icon: Film, label: "Walk-through Video Clips" },
  "scan-floor-plans": { icon: Ruler, label: "Floor Plans" },
  "scan-dimensional-measurements": { icon: Box, label: "Dimensional Measurements" },
  "scan-same-day-turnaround": { icon: Zap, label: "Two-Day Turnaround" },
  "vault-sound-library": { icon: Music2, label: "Sound Library" },
  "vault-portal-filters": { icon: Wand2, label: "Visual Portal Filters" },
  "vault-interactive-widgets": { icon: Puzzle, label: "Interactive Widgets" },
  "vault-custom-icons": { icon: Shapes, label: "Custom Iconography" },
  "vault-property-mapper": { icon: MapPinned, label: "Property Mapper" },
  "ai-lead-generation": { icon: Magnet, label: "AI Lead Generation" },
};

type SortKey = "created_at" | "name" | "email" | "services" | "location";
type SortDir = "asc" | "desc";

function AdminServiceMatches() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc(
        "get_service_match_requests_for_admin",
      );
      if (error) {
        console.error("Failed to load service-match requests:", error);
        setRows([]);
      } else {
        setRows((data ?? []) as RequestRow[]);
      }
      setLoading(false);
    })();
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "created_at" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = !q
      ? rows
      : rows.filter((r) =>
          [r.email, r.name, r.brokerage, r.city, r.region, r.zip]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q)),
        );

    const totalServices = (r: RequestRow) =>
      (r.essential_services?.length ?? 0) + (r.preferable_services?.length ?? 0);
    const locationKey = (r: RequestRow) =>
      `${(r.city ?? "").toLowerCase()} ${(r.region ?? "").toLowerCase()} ${r.zip ?? ""}`;

    const cmp = (a: RequestRow, b: RequestRow) => {
      let av: string | number = "";
      let bv: string | number = "";
      switch (sortKey) {
        case "created_at":
          av = new Date(a.created_at).getTime();
          bv = new Date(b.created_at).getTime();
          break;
        case "name":
          av = (a.name ?? "").toLowerCase();
          bv = (b.name ?? "").toLowerCase();
          break;
        case "email":
          av = a.email.toLowerCase();
          bv = b.email.toLowerCase();
          break;
        case "services":
          av = totalServices(a);
          bv = totalServices(b);
          break;
        case "location":
          av = locationKey(a);
          bv = locationKey(b);
          break;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    };
    return [...list].sort(cmp);
  }, [rows, search, sortKey, sortDir]);

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => {
    const Active =
      sortKey !== k ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground"
      >
        {label}
        <Active className="size-3.5" />
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">MSP Service Match Requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visitor "Notify Me" submissions from the MSP Directory. Only requests with at
            least one Essential or Preferable service are shown.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/admin">← Admin Overview</Link>
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search name, email, brokerage, city, ZIP…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : (
        <TooltipProvider delayDuration={150}>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">
                    <SortHeader label="Submitted" k="created_at" />
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortHeader label="Visitor" k="name" />
                  </th>
                  <th className="px-3 py-2 text-left">Company</th>
                  <th className="px-3 py-2 text-left">
                    <SortHeader label="Email" k="email" />
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortHeader label="Services" k="services" />
                  </th>
                  <th className="px-3 py-2 text-left">
                    <SortHeader label="Location / ZIP" k="location" />
                  </th>
                  <th className="px-3 py-2 text-right">Match Page</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top hover:bg-muted/30">
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {r.name || <span className="text-muted-foreground italic">—</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {r.brokerage || <span className="italic">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`mailto:${r.email}`}
                        className="text-primary hover:underline"
                      >
                        {r.email}
                      </a>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {r.essential_services?.map((s) => {
                          const meta = ICONS[s];
                          if (!meta) return null;
                          const Icon = meta.icon;
                          return (
                            <Tooltip key={`e-${s}`}>
                              <TooltipTrigger asChild>
                                <span
                                  aria-label={`Essential: ${meta.label}`}
                                  className="inline-flex size-6 items-center justify-center rounded border border-amber-400/60 bg-amber-100 text-amber-900"
                                >
                                  <Icon className="size-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Essential — {meta.label}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                        {r.preferable_services?.map((s) => {
                          const meta = ICONS[s];
                          if (!meta) return null;
                          const Icon = meta.icon;
                          return (
                            <Tooltip key={`p-${s}`}>
                              <TooltipTrigger asChild>
                                <span
                                  aria-label={`Preferable: ${meta.label}`}
                                  className="inline-flex size-6 items-center justify-center rounded border border-cyan-400/60 bg-cyan-50 text-cyan-900"
                                >
                                  <Icon className="size-3.5" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>Preferable — {meta.label}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {[r.city, r.region].filter(Boolean).join(", ")}
                      {r.zip ? (
                        <>
                          {" "}
                          <Badge variant="secondary" className="ml-1 align-middle">
                            {r.zip}
                          </Badge>
                        </>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button asChild size="sm" variant="outline">
                        <a
                          href={`/agents/match/${r.match_token}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1"
                        >
                          Open <ExternalLink className="size-3.5" />
                        </a>
                      </Button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                      No service-match requests yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
