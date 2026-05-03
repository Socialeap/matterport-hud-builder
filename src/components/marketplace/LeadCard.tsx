/**
 * Card representation of a single matched beacon (lead) for the
 * marketplace dashboard. Renders the agent's contact info plus a
 * countdown-aware status badge derived from `exclusive_until`.
 *
 * The card itself is presentation-only — bucketing into the
 * Active / Awaiting Response / Past sections is the parent's job.
 */
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Mail, MapPin } from "lucide-react";

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

export function LeadCard({ lead }: { lead: MarketplaceLead }) {
  // Tick once per minute so the countdown stays roughly fresh
  // without being a render-loop hot path.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!lead.exclusive_until || !lead.is_currently_exclusive) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [lead.exclusive_until, lead.is_currently_exclusive]);

  const expiresAt = lead.exclusive_until ? new Date(lead.exclusive_until) : null;
  const isActive =
    lead.is_currently_exclusive && expiresAt !== null && expiresAt > now;
  const remainingMs = expiresAt ? expiresAt.getTime() - now.getTime() : 0;
  const isUrgent = isActive && remainingMs <= URGENCY_WINDOW_MS;

  return (
    <Card className={isUrgent ? "border-amber-300 dark:border-amber-700" : ""}>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              {lead.name || "Anonymous agent"}
            </h3>

            {isActive && expiresAt && (
              <Badge
                variant={isUrgent ? "destructive" : "default"}
                className="text-[10px]"
              >
                {formatRemaining(expiresAt, now)}
              </Badge>
            )}

            {!isActive && lead.contacted_at && (
              <Badge variant="secondary" className="text-[10px]">
                Contacted {formatDate(lead.contacted_at)}
              </Badge>
            )}

            {!isActive && !lead.contacted_at && lead.exclusive_until && (
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
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isActive ? (
            <a href={`mailto:${lead.email}`}>
              <Button size="sm" className="gap-1.5">
                <Mail className="size-3.5" />
                {lead.email}
              </Button>
            </a>
          ) : (
            <span className="text-xs text-muted-foreground">
              {lead.email}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default LeadCard;
