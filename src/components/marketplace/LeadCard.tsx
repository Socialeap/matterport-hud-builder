/**
 * Card representation of a single matched beacon (lead) for the
 * marketplace dashboard. Renders the agent's contact info plus a
 * countdown-aware status badge derived from `exclusive_until`.
 *
 * Presentation-only — bucketing into Active / Awaiting / Past is
 * the parent's job. Card-level affordances vary by state:
 *   * Active + no outreach → "Compose Outreach" button
 *   * Awaiting (contacted, no disposition) → [Won][Lost][Unresponsive]
 *   * Past with disposition → disposition stamp
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Mail, MapPin, MessageSquare, CheckCircle2, XCircle, Clock4 } from "lucide-react";

export type BeaconDisposition = "won" | "lost" | "unresponsive";

export interface MarketplaceLead {
  id: string;
  name: string | null;
  email: string;
  brokerage: string | null;
  city: string;
  region: string | null;
  zip: string | null;
  status: "waiting" | "matched" | "unsubscribed" | "expired";
  created_at: string;
  exclusive_until: string | null;
  contacted_at: string | null;
  is_currently_exclusive: boolean;
  disposition: BeaconDisposition | null;
  has_outreach: boolean;
}

const HOUR_MS = 60 * 60 * 1000;
const URGENCY_WINDOW_MS = 24 * HOUR_MS;

function formatRemaining(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / HOUR_MS);
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h left`;
  if (hours >= 1) return `${hours}h left`;
  const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
  return `${minutes}m left`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface LeadCardProps {
  lead: MarketplaceLead;
  onCompose?: (lead: MarketplaceLead) => void;
  onDisposition?: (lead: MarketplaceLead, disposition: BeaconDisposition) => void;
  /** True while a disposition mutation is in-flight for this lead. */
  pendingDisposition?: boolean;
}

const DISPOSITION_LABEL: Record<BeaconDisposition, string> = {
  won: "Won",
  lost: "Lost",
  unresponsive: "Unresponsive",
};

export function LeadCard({
  lead,
  onCompose,
  onDisposition,
  pendingDisposition = false,
}: LeadCardProps) {
  // Tick once per minute so the countdown stays roughly fresh
  // without being a render-loop hot path.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!lead.exclusive_until || !lead.is_currently_exclusive) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [lead.exclusive_until, lead.is_currently_exclusive]);

  const expiresAt = lead.exclusive_until ? new Date(lead.exclusive_until) : null;
  const windowOpen =
    lead.is_currently_exclusive && expiresAt !== null && expiresAt > now;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const isUrgent = windowOpen && remainingMs <= URGENCY_WINDOW_MS;

  const isAwaiting = !!lead.contacted_at && !lead.disposition;
  const showCompose = windowOpen && !lead.has_outreach && !!onCompose;

  return (
    <Card className={isUrgent ? "border-amber-300 dark:border-amber-700" : ""}>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              {lead.name || "Anonymous agent"}
            </h3>

            {windowOpen && expiresAt && (
              <Badge
                variant={isUrgent ? "destructive" : "default"}
                className="text-[10px]"
              >
                {formatRemaining(expiresAt, now)}
              </Badge>
            )}

            {lead.disposition && (
              <Badge
                variant={lead.disposition === "won" ? "default" : "outline"}
                className="text-[10px]"
              >
                {DISPOSITION_LABEL[lead.disposition]}
              </Badge>
            )}

            {!windowOpen && lead.contacted_at && !lead.disposition && (
              <Badge variant="secondary" className="text-[10px]">
                Contacted {formatDate(lead.contacted_at)}
              </Badge>
            )}

            {!windowOpen && !lead.contacted_at && lead.exclusive_until && (
              <Badge variant="outline" className="text-[10px]">
                Re-pooled
              </Badge>
            )}
          </div>

          {lead.brokerage && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3" />
              {lead.brokerage}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="size-3" />
              {lead.city}
              {lead.region ? `, ${lead.region}` : ""}
              {lead.zip ? ` · ${lead.zip}` : ""}
            </span>
            <span>Joined {formatDate(lead.created_at)}</span>
          </div>

          {isAwaiting && onDisposition && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Disposition
              </span>
              <Button
                size="sm"
                variant="default"
                className="h-7 px-2 text-xs"
                disabled={pendingDisposition}
                onClick={() => onDisposition(lead, "won")}
              >
                <CheckCircle2 className="mr-1 size-3" /> Won
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={pendingDisposition}
                onClick={() => onDisposition(lead, "lost")}
              >
                <XCircle className="mr-1 size-3" /> Lost
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={pendingDisposition}
                onClick={() => onDisposition(lead, "unresponsive")}
              >
                <Clock4 className="mr-1 size-3" /> Unresponsive
              </Button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          {windowOpen ? (
            <span className="text-xs text-muted-foreground">{lead.email}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{lead.email}</span>
          )}

          {showCompose ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => onCompose && onCompose(lead)}
            >
              <MessageSquare className="size-3.5" />
              Compose Outreach
            </Button>
          ) : windowOpen && lead.has_outreach ? (
            <a href={`mailto:${lead.email}`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Mail className="size-3.5" />
                Reply directly
              </Button>
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export default LeadCard;
