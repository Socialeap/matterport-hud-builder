import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, Inbox } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

interface WorkOrderRow {
  id: string;
  created_at: string;
  status:
    | "pending"
    | "confirmed"
    | "completed"
    | "incomplete"
    | "cancelled"
    | "expired";
  city: string;
  region: string | null;
  zip: string | null;
  property_type: string;
  size_band: string;
  available_from: string;
  available_to: string;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  invite_count: number;
  available_count: number;
  expired_count: number;
  confirmed_provider_id: string | null;
  confirmed_brand_name: string | null;
  completion: "complete" | "incomplete" | null;
  completion_at: string | null;
  priority_window_until: string | null;
}

const STATUS_LABELS: Record<WorkOrderRow["status"], { label: string; color: string }> = {
  pending: { label: "Awaiting responses", color: "bg-amber-300/15 text-amber-200 ring-amber-300/30" },
  confirmed: { label: "Confirmed", color: "bg-cyan-400/15 text-cyan-200 ring-cyan-300/30" },
  completed: { label: "Completed", color: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/30" },
  incomplete: { label: "Incomplete", color: "bg-orange-400/15 text-orange-200 ring-orange-300/30" },
  cancelled: { label: "Cancelled", color: "bg-slate-400/15 text-slate-200 ring-slate-300/30" },
  expired: { label: "Expired", color: "bg-red-400/15 text-red-200 ring-red-300/30" },
};

export const Route = createFileRoute("/_authenticated/agent-dashboard/work-orders/")({
  head: () => ({
    meta: [
      { title: "My Work Orders — 3DPS Marketplace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkOrdersIndexPage,
});

function WorkOrdersIndexPage() {
  const [rows, setRows] = useState<WorkOrderRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_my_work_orders");
      if (cancelled) return;
      setLoading(false);
      if (error) {
        toast.error("Could not load your work orders.");
        setRows([]);
        return;
      }
      setRows((data as unknown as WorkOrderRow[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Work Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anonymized job requests sent to qualifying MSPs. Track responses and
            confirm one to release contact info.
          </p>
        </div>
        <Link to="/agents">
          <Button variant="outline" size="sm" className="gap-2">
            Browse Directory <ArrowRight className="size-3.5" />
          </Button>
        </Link>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 size-5 animate-spin" /> Loading…
        </div>
      )}

      {!loading && (rows?.length ?? 0) === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <Inbox className="size-10 text-muted-foreground/50" />
            <p className="text-base font-semibold">No work orders yet</p>
            <p className="text-sm text-muted-foreground">
              Browse the MSP directory, shortlist qualifying studios, and send a
              Work Order to get availability within 3 hours.
            </p>
            <Link to="/agents" className="mt-2">
              <Button size="sm" className="gap-2">
                Browse Directory <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!loading && (rows?.length ?? 0) > 0 && (
        <div className="grid gap-3">
          {rows!.map((wo) => {
            const status = STATUS_LABELS[wo.status];
            const showAvailableCount =
              wo.status === "pending" || wo.status === "confirmed";
            return (
              <Link
                key={wo.id}
                to="/agent-dashboard/work-orders/$id"
                params={{ id: wo.id }}
                className="block"
              >
                <Card className="transition-colors hover:bg-accent/40">
                  <CardContent className="grid gap-3 p-5 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={`ring-1 ${status.color}`}>
                          {status.label}
                        </Badge>
                        <span className="text-sm font-semibold">
                          {wo.property_type} ·{" "}
                          {wo.city}
                          {wo.region ? `, ${wo.region}` : ""}
                          {wo.zip ? ` · ${wo.zip}` : ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Submitted{" "}
                        {new Date(wo.created_at).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </p>
                      {wo.confirmed_brand_name && (
                        <p className="mt-1 text-xs text-cyan-700 dark:text-cyan-300">
                          Confirmed: {wo.confirmed_brand_name}
                        </p>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {wo.invite_count} invited
                      {showAvailableCount && (
                        <>
                          {" · "}
                          <span className="text-emerald-700 dark:text-emerald-300">
                            {wo.available_count} available
                          </span>
                        </>
                      )}
                      {wo.expired_count > 0 && wo.status === "pending" && (
                        <>
                          {" · "}
                          <span className="text-orange-700 dark:text-orange-300">
                            {wo.expired_count} no response
                          </span>
                        </>
                      )}
                    </div>
                    <ArrowRight className="hidden size-4 text-muted-foreground sm:block" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
