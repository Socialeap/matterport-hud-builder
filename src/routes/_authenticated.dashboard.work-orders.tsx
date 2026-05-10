import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2, Clock, Hourglass, Inbox, Loader2, MapPin, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { MarketplaceStandingBadge } from "@/components/dashboard/MarketplaceStandingBadge";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

interface InviteRow {
  invite_id: string;
  work_order_id: string;
  rank_at_invite: number | null;
  response_status:
    | "invited"
    | "available"
    | "not_available"
    | "expired"
    | "not_selected"
    | "withdrawn";
  respond_by: string;
  responded_at: string | null;
  created_at: string;
  city: string;
  region: string | null;
  zip: string | null;
  property_type: string;
  size_band: string;
  available_from: string;
  available_to: string;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  notes: string | null;
  wo_status:
    | "pending"
    | "confirmed"
    | "completed"
    | "incomplete"
    | "cancelled"
    | "expired";
  agent_name: string | null;
  agent_email: string | null;
  agent_phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  pii_released: boolean;
  completion: "complete" | "incomplete" | null;
  completion_at: string | null;
}

const formatLabel = (s: string) =>
  s.replace(/^scan-|^vault-|^ai-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export const Route = createFileRoute("/_authenticated/dashboard/work-orders")({
  head: () => ({
    meta: [
      { title: "Work Orders — 3DPS MSP Dashboard" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MspWorkOrdersPage,
});

function MspWorkOrdersPage() {
  const [rows, setRows] = useState<InviteRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [responseFor, setResponseFor] = useState<InviteRow | null>(null);
  const [response, setResponse] = useState<"available" | "not_available" | null>(null);
  const [providerNote, setProviderNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reload = async () => {
    const { data, error } = await supabase.rpc("get_my_work_order_invites");
    if (error) {
      toast.error("Could not load your work orders.");
      setRows([]);
      return;
    }
    setRows((data as unknown as InviteRow[]) ?? []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await reload();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => {
    const out = {
      action: [] as InviteRow[],
      active: [] as InviteRow[],
      past: [] as InviteRow[],
    };
    for (const r of rows ?? []) {
      if (r.response_status === "invited" && new Date(r.respond_by) > new Date()) {
        out.action.push(r);
      } else if (r.response_status === "available" && r.wo_status === "pending") {
        out.active.push(r);
      } else if (r.pii_released && r.wo_status === "confirmed") {
        out.active.push(r);
      } else {
        out.past.push(r);
      }
    }
    return out;
  }, [rows]);

  const handleOpenResponse = (row: InviteRow, choice: "available" | "not_available") => {
    setResponseFor(row);
    setResponse(choice);
    setProviderNote("");
  };

  const handleSubmitResponse = async () => {
    if (!responseFor || !response) return;
    setSubmitting(true);
    const { data, error } = await supabase.rpc("respond_to_work_order_invite", {
      p_invite_id: responseFor.invite_id,
      p_response: response,
      p_provider_note: providerNote.trim() || undefined,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message || "Could not record your response.");
      return;
    }
    if (data === false) {
      toast.warning("Response could not be recorded — the window may have closed.");
    } else {
      toast.success(
        response === "available"
          ? "Marked Available. The agent has been notified."
          : "Marked Not Available.",
      );
    }
    setResponseFor(null);
    setResponse(null);
    await reload();
  };

  const handleMarkComplete = async (row: InviteRow, completion: "complete" | "incomplete") => {
    const { data, error } = await supabase.rpc("mark_work_order_complete", {
      p_work_order_id: row.work_order_id,
      p_completion: completion,
    });
    if (error) {
      toast.error(error.message || "Could not mark this work order.");
      return;
    }
    const row0 = Array.isArray(data) ? data[0] : data;
    if (row0?.ok) {
      toast.success(
        completion === "complete"
          ? "Marked complete — the agent will receive a rating link by email."
          : "Marked incomplete.",
      );
    }
    await reload();
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Work Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Anonymized job invites from agents. Respond Available within{" "}
            <strong>3 hours</strong> to stay in good standing.
          </p>
        </div>
        <MarketplaceStandingBadge />
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
              When a qualifying agent in your service area shortlists your studio
              and submits a work order, it'll show up here.
            </p>
          </CardContent>
        </Card>
      )}

      {!loading && groups.action.length > 0 && (
        <Section
          title="Action required"
          description="Respond within 3 hours to earn +0.10 to your Standing. Missing the window costs −0.50."
        >
          {groups.action.map((row) => (
            <InviteCard
              key={row.invite_id}
              row={row}
              onAvailable={() => handleOpenResponse(row, "available")}
              onNotAvailable={() => handleOpenResponse(row, "not_available")}
            />
          ))}
        </Section>
      )}

      {!loading && groups.active.length > 0 && (
        <Section
          title="Active"
          description="You marked Available or were confirmed. Mark complete after the job."
        >
          {groups.active.map((row) => (
            <InviteCard
              key={row.invite_id}
              row={row}
              onMarkComplete={() => handleMarkComplete(row, "complete")}
              onMarkIncomplete={() => handleMarkComplete(row, "incomplete")}
            />
          ))}
        </Section>
      )}

      {!loading && groups.past.length > 0 && (
        <Section title="Past" description="History of work orders you've been invited to.">
          {groups.past.map((row) => (
            <InviteCard key={row.invite_id} row={row} readOnly />
          ))}
        </Section>
      )}

      <Dialog
        open={responseFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResponseFor(null);
            setResponse(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {response === "available" ? "Mark Available" : "Mark Not Available"}
            </DialogTitle>
            <DialogDescription>
              {response === "available"
                ? "The agent will see you as Available and may select you. +0.10 to Standing."
                : "No penalty. The agent will see you marked Not Available."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <label htmlFor="provider-note" className="text-xs uppercase tracking-wider text-muted-foreground">
              Note for the agent (optional)
            </label>
            <Textarea
              id="provider-note"
              value={providerNote}
              onChange={(e) => setProviderNote(e.target.value)}
              maxLength={1000}
              placeholder={
                response === "available"
                  ? "e.g. Available within 4 hours — happy to confirm a time."
                  : "e.g. Booked through Friday."
              }
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResponseFor(null);
                setResponse(null);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmitResponse} disabled={submitting}>
              {submitting ? "Sending…" : "Send response"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mb-3 text-sm text-muted-foreground">{description}</p>}
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function InviteCard({
  row,
  onAvailable,
  onNotAvailable,
  onMarkComplete,
  onMarkIncomplete,
  readOnly,
}: {
  row: InviteRow;
  onAvailable?: () => void;
  onNotAvailable?: () => void;
  onMarkComplete?: () => void;
  onMarkIncomplete?: () => void;
  readOnly?: boolean;
}) {
  const respondBy = new Date(row.respond_by);
  const remainingMs = respondBy.getTime() - Date.now();
  const hoursRemaining = Math.max(0, Math.floor(remainingMs / 3_600_000));
  const minutesRemaining = Math.max(0, Math.floor((remainingMs % 3_600_000) / 60_000));

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {row.property_type} ·{" "}
            <span className="font-normal text-muted-foreground">
              <MapPin className="mr-0.5 inline size-3" />
              {row.city}
              {row.region ? `, ${row.region}` : ""}
              {row.zip ? ` · ${row.zip}` : ""}
            </span>
          </CardTitle>
          <ResponseBadge status={row.response_status} />
        </div>
        {row.response_status === "invited" && remainingMs > 0 && (
          <CardDescription className="flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <Hourglass className="size-3.5" />
            Respond in {hoursRemaining}h {minutesRemaining}m
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="grid gap-2 sm:grid-cols-2">
          <Detail
            label="Available window"
            value={
              <>
                {new Date(row.available_from).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                →{" "}
                {new Date(row.available_to).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </>
            }
          />
          <Detail label="Approximate size" value={row.size_band.replace("_", "–")} />
        </div>

        {row.essential_services.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-amber-700 dark:text-amber-300">
              Essential:
            </span>{" "}
            {row.essential_services.map(formatLabel).join(", ")}
          </div>
        )}
        {row.preferable_services.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-cyan-700 dark:text-cyan-300">
              Preferable:
            </span>{" "}
            {row.preferable_services.map(formatLabel).join(", ")}
          </div>
        )}
        {row.notes && (
          <div className="rounded-md bg-muted/40 p-2 text-xs">
            <span className="font-medium">Agent note:</span> {row.notes}
          </div>
        )}

        {row.pii_released && (
          <div className="rounded-md border border-cyan-300/30 bg-cyan-300/5 p-3 text-sm">
            <p className="font-semibold">Agent contact info</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {row.agent_name && <li><strong>Name:</strong> {row.agent_name}</li>}
              {row.agent_email && (
                <li>
                  <strong>Email:</strong>{" "}
                  <a className="underline" href={`mailto:${row.agent_email}`}>
                    {row.agent_email}
                  </a>
                </li>
              )}
              {row.agent_phone && (
                <li>
                  <strong>Phone:</strong>{" "}
                  <a className="underline" href={`tel:${row.agent_phone.replace(/[^\d+]/g, "")}`}>
                    {row.agent_phone}
                  </a>
                </li>
              )}
              {row.address_line1 && (
                <li>
                  <strong>Address:</strong> {row.address_line1}
                  {row.address_line2 ? `, ${row.address_line2}` : ""}, {row.city}
                  {row.region ? `, ${row.region}` : ""} {row.zip ?? ""}
                </li>
              )}
            </ul>
          </div>
        )}

        {!readOnly && row.response_status === "invited" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={onAvailable} className="gap-1">
              <CheckCircle2 className="size-3.5" /> Available
            </Button>
            <Button size="sm" variant="outline" onClick={onNotAvailable} className="gap-1">
              <XCircle className="size-3.5" /> Not Available
            </Button>
          </div>
        )}

        {!readOnly && row.pii_released && row.wo_status === "confirmed" && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" onClick={onMarkComplete} className="gap-1">
              <CheckCircle2 className="size-3.5" /> Mark Complete
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="gap-1">
                  <XCircle className="size-3.5" /> Mark Incomplete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Mark this work order incomplete?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Use this if the job did not happen (e.g. agent cancelled, no-show).
                    No rating request will be sent.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Back</AlertDialogCancel>
                  <AlertDialogAction onClick={onMarkIncomplete}>
                    Mark incomplete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function ResponseBadge({ status }: { status: InviteRow["response_status"] }) {
  const map: Record<InviteRow["response_status"], { label: string; color: string; icon: typeof Clock }> = {
    invited: { label: "New", color: "bg-amber-300/15 text-amber-700 ring-amber-300/30 dark:text-amber-200", icon: Clock },
    available: { label: "Available", color: "bg-emerald-400/15 text-emerald-700 ring-emerald-300/30 dark:text-emerald-200", icon: CheckCircle2 },
    not_available: { label: "Not Available", color: "bg-slate-400/15 text-slate-700 ring-slate-300/30 dark:text-slate-200", icon: XCircle },
    expired: { label: "Missed window", color: "bg-red-400/15 text-red-700 ring-red-300/30 dark:text-red-200", icon: XCircle },
    not_selected: { label: "Not selected", color: "bg-slate-400/10 text-slate-600 ring-slate-300/20 dark:text-slate-300", icon: XCircle },
    withdrawn: { label: "Withdrawn", color: "bg-slate-400/10 text-slate-600 ring-slate-300/20 dark:text-slate-300", icon: XCircle },
  };
  const v = map[status];
  const Icon = v.icon;
  return (
    <Badge className={`gap-1 ring-1 ${v.color}`}>
      <Icon className="size-3" />
      {v.label}
    </Badge>
  );
}
