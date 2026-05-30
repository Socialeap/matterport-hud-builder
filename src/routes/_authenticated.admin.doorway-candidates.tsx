import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Star,
  Globe,
  Phone,
  RefreshCw,
  ShieldAlert,
  AlertTriangle,
  MapPinned,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/doorway-candidates")({
  component: AdminDoorwayCandidates,
});

type CandidateStatus = "new" | "queued" | "surfaced" | "dismissed";
const STATUSES: CandidateStatus[] = ["new", "queued", "surfaced", "dismissed"];

// Subset of the composed doorway card we render (the view exposes the full
// jsonb in `doorway_payload`).
interface DoorwayPayload {
  rating?: number;
  rating_count?: number;
  website?: string;
  phone?: string;
  phone_display?: string;
  email?: string;
}

// Mirror of public.operator_doorway_candidates (security_invoker, admin-only).
interface CandidateRow {
  property_id: string;
  status: CandidateStatus;
  name: string | null;
  locality: string | null;
  region: string | null;
  category: string | null;
  hero_summary: string | null;
  doorway_payload: DoorwayPayload | null;
  updated_at: string | null;
}

const STATUS_STYLE: Record<CandidateStatus, string> = {
  new: "bg-amber-100 text-amber-900 border border-amber-300",
  queued: "bg-blue-100 text-blue-900 border border-blue-300",
  surfaced: "bg-green-100 text-green-900 border border-green-300",
  dismissed: "bg-muted text-muted-foreground border border-border",
};

function StatusPill({ status }: { status: CandidateStatus }) {
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[status]}`}>
      {status}
    </span>
  );
}

function AdminDoorwayCandidates() {
  const { roles, isLoading: authLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CandidateStatus | "all">("all");
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await supabase
      .from("operator_doorway_candidates")
      .select(
        "property_id,status,name,locality,region,category,hero_summary,doorway_payload,updated_at",
      );
    if (err) {
      console.error("Failed to load doorway candidates:", err);
      setError(err.message);
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as CandidateRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) {
      void load();
    } else {
      setLoading(false);
    }
  }, [authLoading, isAdmin, load]);

  const changeStatus = async (row: CandidateRow, next: CandidateStatus) => {
    if (next === row.status) return;
    setUpdating(row.property_id);
    const { error: err } = await supabase.rpc("set_doorway_candidate_status", {
      p_property_id: row.property_id,
      p_status: next,
    });
    if (err) {
      console.error("set_doorway_candidate_status failed:", err);
      toast.error(
        /operator \(admin\) only|insufficient_privilege|42501/i.test(err.message)
          ? "Permission denied — admin only."
          : `Could not update status: ${err.message}`,
      );
    } else {
      setRows((prev) =>
        prev.map((r) => (r.property_id === row.property_id ? { ...r, status: next } : r)),
      );
      toast.success(`Status set to "${next}".`);
    }
    setUpdating(null);
  };

  const filtered = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  // ── Permission denied (defensive; the admin layout also guards this) ──
  if (!authLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Doorway Candidates is an operator-only surface.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <MapPinned className="size-6 text-primary" />
            Map Oracle — Doorway Candidates
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review normalized Map Oracle candidates and set their discovery status.
            Operator-only; no outreach, billing, or client binding happens here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={(v) => setFilter(v as CandidateStatus | "all")}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            <span className="font-medium">Couldn’t load candidates</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
            Try again
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-16 text-center text-muted-foreground">
          {rows.length === 0
            ? "No doorway candidates yet. Stage them with detect_doorway_candidates()."
            : `No candidates with status “${filter}”.`}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Candidate</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Rating</th>
                <th className="px-3 py-2 text-left">Contact</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Set status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const p = r.doorway_payload ?? {};
                const phone = p.phone_display || p.phone;
                return (
                  <tr key={r.property_id} className="border-t border-border align-top hover:bg-muted/30">
                    <td className="px-3 py-2">
                      <div className="font-medium text-foreground">
                        {r.name || <span className="italic text-muted-foreground">Unnamed</span>}
                      </div>
                      {r.hero_summary && (
                        <div className="mt-0.5 max-w-md text-xs text-muted-foreground">{r.hero_summary}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {[r.locality, r.region].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2 capitalize text-muted-foreground">
                      {r.category ? r.category.replace(/_/g, " ") : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {typeof p.rating === "number" ? (
                        <span className="inline-flex items-center gap-1">
                          <Star className="size-3.5 text-amber-500" />
                          {p.rating.toFixed(1)}
                          {typeof p.rating_count === "number" && (
                            <span className="text-xs text-muted-foreground">({p.rating_count})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-0.5">
                        {p.website && (
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <Globe className="size-3.5" /> Website
                          </a>
                        )}
                        {phone && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Phone className="size-3.5" /> {phone}
                          </span>
                        )}
                        {!p.website && !phone && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Select
                        value={r.status}
                        onValueChange={(v) => void changeStatus(r, v as CandidateStatus)}
                        disabled={updating === r.property_id}
                      >
                        <SelectTrigger className="ml-auto w-[140px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUSES.map((s) => (
                            <SelectItem key={s} value={s} className="capitalize">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
