import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ArrowLeft,
  Building2,
  CheckCircle2,
  Clock,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buildStudioUrl } from "@/lib/public-url";
import type { Database } from "@/integrations/supabase/types";

type MarketplaceSpecialty = Database["public"]["Enums"]["marketplace_specialty"];

interface InviteRow {
  invite_id: string;
  provider_id: string;
  brand_name: string | null;
  slug: string | null;
  logo_url: string | null;
  tier: "starter" | "pro" | null;
  rank_at_invite: number | null;
  response_status:
    | "invited"
    | "available"
    | "not_available"
    | "expired"
    | "not_selected"
    | "withdrawn";
  responded_at: string | null;
  respond_by: string;
  provider_note: string | null;
  directory_phone: string | null;
  directory_website_url: string | null;
  directory_contact_email: string | null;
  standing_score: number;
}

interface WorkOrderDetail {
  id: string;
  created_at: string;
  status:
    | "pending"
    | "confirmed"
    | "completed"
    | "incomplete"
    | "cancelled"
    | "expired";
  priority_window_until: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string | null;
  zip: string | null;
  property_type: string;
  size_band: string;
  available_from: string;
  available_to: string;
  notes: string | null;
  essential_services: MarketplaceSpecialty[];
  preferable_services: MarketplaceSpecialty[];
  confirmed_provider_id: string | null;
  confirmed_at: string | null;
  pii_released_at: string | null;
  completion: "complete" | "incomplete" | null;
  completion_at: string | null;
  invites: InviteRow[];
}

const RESPONSE_LABELS: Record<InviteRow["response_status"], { label: string; color: string }> = {
  invited: { label: "Awaiting", color: "bg-amber-300/15 text-amber-700 ring-amber-300/30 dark:text-amber-200" },
  available: { label: "Available", color: "bg-emerald-400/15 text-emerald-700 ring-emerald-300/30 dark:text-emerald-200" },
  not_available: { label: "Not Available", color: "bg-slate-400/15 text-slate-700 ring-slate-300/30 dark:text-slate-200" },
  expired: { label: "No response", color: "bg-orange-400/15 text-orange-700 ring-orange-300/30 dark:text-orange-200" },
  not_selected: { label: "Not selected", color: "bg-slate-400/10 text-slate-600 ring-slate-300/20 dark:text-slate-300" },
  withdrawn: { label: "Withdrawn", color: "bg-slate-400/10 text-slate-600 ring-slate-300/20 dark:text-slate-300" },
};

const standingLabel = (score: number) =>
  score >= 1.5 ? "Excellent" : score >= 0.7 ? "Good" : "At Risk";

export const Route = createFileRoute("/_authenticated/agent-dashboard/work-orders/$id")({
  head: () => ({
    meta: [
      { title: "Work Order — 3DPS Marketplace" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WorkOrderDetailPage,
});

function WorkOrderDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [wo, setWo] = useState<WorkOrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const reload = async () => {
    const { data, error } = await supabase.rpc("get_work_order_detail_for_agent", {
      p_work_order_id: id,
    });
    if (error || !data) {
      toast.error("Could not load this work order.");
      setWo(null);
      return;
    }
    setWo(data as unknown as WorkOrderDetail);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sortedInvites = useMemo(() => {
    if (!wo) return [];
    return [...wo.invites].sort((a, b) => {
      const order: Record<InviteRow["response_status"], number> = {
        available: 0,
        invited: 1,
        not_available: 2,
        expired: 3,
        not_selected: 4,
        withdrawn: 5,
      };
      const diff = order[a.response_status] - order[b.response_status];
      if (diff !== 0) return diff;
      return (a.rank_at_invite ?? 99) - (b.rank_at_invite ?? 99);
    });
  }, [wo]);

  const handleConfirm = async (providerId: string) => {
    setConfirming(providerId);
    const { error } = await supabase.rpc("confirm_work_order_msp", {
      p_work_order_id: id,
      p_provider_id: providerId,
    });
    setConfirming(null);
    if (error) {
      toast.error(error.message || "Could not confirm this MSP.");
      return;
    }
    toast.success(
      "MSP confirmed. They've been emailed your contact info and full address.",
    );
    await reload();
  };

  const handleCancel = async () => {
    setCancelling(true);
    const { error } = await supabase.rpc("cancel_work_order", {
      p_work_order_id: id,
    });
    setCancelling(false);
    if (error) {
      toast.error(error.message || "Could not cancel this work order.");
      return;
    }
    toast.success("Work order cancelled.");
    await reload();
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" /> Loading work order…
      </div>
    );
  }
  if (!wo) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-center">
        <p className="text-base font-semibold">Work order not found</p>
        <Link to="/agent-dashboard/work-orders" className="mt-3 inline-block">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-1 size-4" /> Back to Work Orders
          </Button>
        </Link>
      </div>
    );
  }

  const isPending = wo.status === "pending";

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="mb-5 flex items-center justify-between gap-3">
        <Link to="/agent-dashboard/work-orders" className="inline-flex items-center text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="mr-1 size-4" /> Back to Work Orders
        </Link>
        {isPending && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={cancelling}>
                Cancel work order
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancel this work order?</AlertDialogTitle>
                <AlertDialogDescription>
                  All pending invites will be withdrawn. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep open</AlertDialogCancel>
                <AlertDialogAction onClick={handleCancel}>
                  Cancel work order
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </header>

      <Card className="mb-5">
        <CardContent className="grid gap-3 p-5 sm:grid-cols-2">
          <Detail label="Status" value={<StatusPill status={wo.status} />} />
          <Detail
            label="Submitted"
            value={new Date(wo.created_at).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          />
          <Detail
            label="Property"
            value={
              <span>
                {wo.property_type} · {wo.size_band.replace("_", "–").replace("under", "&lt;").replace("over", "&gt;")}
              </span>
            }
          />
          <Detail
            label="Location (anonymized)"
            value={
              <span className="flex items-center gap-1">
                <MapPin className="size-3.5" />
                {wo.city}
                {wo.region ? `, ${wo.region}` : ""}
                {wo.zip ? ` · ${wo.zip}` : ""}
              </span>
            }
          />
          <Detail
            label="Available window"
            value={
              <>
                {new Date(wo.available_from).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}{" "}
                →{" "}
                {new Date(wo.available_to).toLocaleString(undefined, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </>
            }
          />
          {wo.confirmed_provider_id && (
            <Detail
              label="Confirmed MSP"
              value={
                <span className="text-cyan-700 dark:text-cyan-300">
                  Address &amp; your contact info shared
                </span>
              }
            />
          )}
          {wo.notes && (
            <div className="sm:col-span-2 mt-1 rounded-md bg-muted/40 p-3 text-sm">
              <span className="font-medium">Notes:</span> {wo.notes}
            </div>
          )}
        </CardContent>
      </Card>

      <h2 className="mb-3 text-base font-semibold">
        {isPending
          ? "Responses"
          : wo.status === "confirmed"
            ? "Confirmed MSP"
            : "Invite history"}
      </h2>

      <div className="grid gap-3">
        {sortedInvites.map((inv) => (
          <InviteCard
            key={inv.invite_id}
            inv={inv}
            confirming={confirming === inv.provider_id}
            canConfirm={isPending && inv.response_status === "available"}
            isConfirmed={wo.confirmed_provider_id === inv.provider_id}
            onConfirm={() => handleConfirm(inv.provider_id)}
          />
        ))}
        {sortedInvites.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              No MSPs were invited.
            </CardContent>
          </Card>
        )}
      </div>

      {wo.status === "completed" && (
        <Card className="mt-5 border-emerald-300/30 bg-emerald-300/5">
          <CardContent className="flex items-start gap-3 p-5">
            <CheckCircle2 className="mt-0.5 size-5 text-emerald-300" />
            <div>
              <p className="font-semibold">Job marked complete</p>
              <p className="text-sm text-muted-foreground">
                We've emailed you a 1-5 ★ rating link for this MSP.
                Check your inbox.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {wo.status === "incomplete" && (
        <Card className="mt-5 border-orange-300/30 bg-orange-300/5">
          <CardContent className="flex items-start gap-3 p-5">
            <XCircle className="mt-0.5 size-5 text-orange-300" />
            <div>
              <p className="font-semibold">MSP marked the job incomplete</p>
              <p className="text-sm text-muted-foreground">
                Get in touch with the MSP directly to resolve. No rating
                request was sent.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {wo.confirmed_provider_id && wo.status === "confirmed" && (
        <p
          className="mt-6 text-xs text-muted-foreground"
          onClick={(e) => navigate({ to: e.currentTarget.dataset.href as never })}
        >
          Waiting for the MSP to mark the job complete. Once they do, we'll
          email you a rating link.
        </p>
      )}
    </div>
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

function StatusPill({ status }: { status: WorkOrderDetail["status"] }) {
  const map: Record<WorkOrderDetail["status"], { label: string; color: string }> = {
    pending: { label: "Awaiting responses", color: "bg-amber-300/15 text-amber-700 ring-amber-300/30 dark:text-amber-200" },
    confirmed: { label: "Confirmed", color: "bg-cyan-400/15 text-cyan-700 ring-cyan-300/30 dark:text-cyan-200" },
    completed: { label: "Completed", color: "bg-emerald-400/15 text-emerald-700 ring-emerald-300/30 dark:text-emerald-200" },
    incomplete: { label: "Incomplete", color: "bg-orange-400/15 text-orange-700 ring-orange-300/30 dark:text-orange-200" },
    cancelled: { label: "Cancelled", color: "bg-slate-400/15 text-slate-700 ring-slate-300/30 dark:text-slate-200" },
    expired: { label: "Expired", color: "bg-red-400/15 text-red-700 ring-red-300/30 dark:text-red-200" },
  };
  const v = map[status];
  return <Badge className={`ring-1 ${v.color}`}>{v.label}</Badge>;
}

function InviteCard({
  inv,
  confirming,
  canConfirm,
  isConfirmed,
  onConfirm,
}: {
  inv: InviteRow;
  confirming: boolean;
  canConfirm: boolean;
  isConfirmed: boolean;
  onConfirm: () => void;
}) {
  const studioUrl = inv.slug
    ? buildStudioUrl(inv.slug, { tier: inv.tier ?? "starter", customDomain: null })
    : null;
  const status = RESPONSE_LABELS[inv.response_status];
  const respondsByDt = new Date(inv.respond_by);
  const respondedDt = inv.responded_at ? new Date(inv.responded_at) : null;

  return (
    <Card className={isConfirmed ? "border-cyan-300/40 ring-1 ring-cyan-300/30" : undefined}>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
        <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 text-white">
          {inv.logo_url ? (
            <img
              src={inv.logo_url}
              alt={`${inv.brand_name} logo`}
              className="size-full object-contain"
              loading="lazy"
            />
          ) : (
            <Building2 className="size-5" />
          )}
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">{inv.brand_name ?? "Unknown studio"}</p>
            <Badge className={`ring-1 ${status.color}`}>{status.label}</Badge>
            {inv.tier === "pro" && (
              <Badge className="bg-cyan-400/15 text-cyan-700 ring-1 ring-cyan-300/30 dark:text-cyan-200">
                Pro
              </Badge>
            )}
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <Star className="size-3" /> {standingLabel(inv.standing_score)}
            </span>
          </div>
          {inv.response_status === "invited" && (
            <p className="text-xs text-muted-foreground">
              <Clock className="mr-0.5 inline size-3" /> Responds by{" "}
              {respondsByDt.toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
          {respondedDt && (
            <p className="text-xs text-muted-foreground">
              Responded{" "}
              {respondedDt.toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
          {inv.provider_note && (
            <p className="rounded-md bg-muted/40 p-2 text-xs">
              <span className="font-medium">From MSP:</span> {inv.provider_note}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {studioUrl && (
            <a href={studioUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                Studio
              </Button>
            </a>
          )}
          {inv.directory_website_url && (
            <a href={inv.directory_website_url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline" className="gap-1">
                <Globe className="size-3.5" />
              </Button>
            </a>
          )}
          {inv.directory_contact_email && (
            <a href={`mailto:${inv.directory_contact_email}`}>
              <Button size="sm" variant="outline" className="gap-1">
                <Mail className="size-3.5" />
              </Button>
            </a>
          )}
          {inv.directory_phone && (
            <a href={`tel:${inv.directory_phone.replace(/[^\d+]/g, "")}`}>
              <Button size="sm" variant="outline" className="gap-1">
                <Phone className="size-3.5" />
              </Button>
            </a>
          )}
          {canConfirm && (
            <Button size="sm" onClick={onConfirm} disabled={confirming} className="gap-1">
              {confirming ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Confirm
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
