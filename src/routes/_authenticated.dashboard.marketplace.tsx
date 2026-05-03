import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles, Lock } from "lucide-react";
import { toast } from "sonner";
import { useMspAccess } from "@/hooks/use-msp-access";
import { LeadCard, type MarketplaceLead } from "@/components/marketplace/LeadCard";

export const Route = createFileRoute("/_authenticated/dashboard/marketplace")({
  component: MarketplacePage,
});

function MarketplacePage() {
  const { hasPaid } = useMspAccess();
  const [rows, setRows] = useState<MarketplaceLead[] | null>(null);
  const [loading, setLoading] = useState(true);

  const isLocked = !hasPaid;

  useEffect(() => {
    if (isLocked) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc(
        "get_my_matched_beacons",
      );
      if (cancelled) return;

      if (rpcError) {
        toast.error("Could not load your marketplace contacts");
        setLoading(false);
        return;
      }

      // RPC return shape was extended in PR2 with exclusive_until,
      // contacted_at, is_currently_exclusive. The auto-generated
      // Database types lag the migration; cast through unknown.
      setRows((data as unknown as MarketplaceLead[]) ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLocked]);

  // Bucket leads into the three sections derived from the
  // exclusive-window state.
  //
  //   Active            : currently mine and the window is open,
  //                       no contact yet
  //   Awaiting Response : I contacted them; waiting on the agent
  //                       (PR3 will populate this via the composer
  //                       — in PR2 it's almost always empty)
  //   Past              : window closed without contact, or I was
  //                       re-pooled past in favor of another Pro
  const buckets = useMemo(() => {
    const active: MarketplaceLead[] = [];
    const awaiting: MarketplaceLead[] = [];
    const past: MarketplaceLead[] = [];
    const now = Date.now();
    for (const row of rows ?? []) {
      const exp = row.exclusive_until ? new Date(row.exclusive_until).getTime() : null;
      const windowOpen =
        row.is_currently_exclusive && exp !== null && exp > now;
      if (row.contacted_at) {
        awaiting.push(row);
      } else if (windowOpen) {
        active.push(row);
      } else {
        past.push(row);
      }
    }
    return { active, awaiting, past };
  }, [rows]);

  const sampleBeacons: MarketplaceLead[] = [
    {
      id: "sample-1",
      name: "Jane Doe",
      email: "jane.d@brokerage.com",
      brokerage: "Coastal Realty Group",
      city: "Your City",
      region: "CA",
      zip: "90210",
      status: "matched",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
      exclusive_until: new Date(Date.now() + 1000 * 60 * 60 * 60).toISOString(),
      contacted_at: null,
      is_currently_exclusive: true,
    },
    {
      id: "sample-2",
      name: "Marcus Lee",
      email: "marcus@listingpros.com",
      brokerage: "Listing Pros",
      city: "Your City",
      region: "CA",
      zip: "90211",
      status: "matched",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      exclusive_until: new Date(Date.now() + 1000 * 60 * 60 * 18).toISOString(),
      contacted_at: null,
      is_currently_exclusive: true,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace Leads</h1>
          <p className="text-sm text-muted-foreground">
            Each lead is yours <em>exclusively</em> for 72 hours. If you don't
            reach out before the window closes, the lead automatically
            re-pools to the next Pro in your area.
          </p>
        </div>
        <Link to="/dashboard/branding">
          <Button variant="outline" size="sm" disabled={isLocked}>
            Configure Listing
          </Button>
        </Link>
      </div>

      {isLocked ? (
        <div className="relative">
          <div
            aria-hidden
            className="space-y-3 pointer-events-none select-none opacity-60 blur-[2px]"
          >
            {sampleBeacons.map((row) => (
              <LeadCard key={row.id} lead={row} />
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Card className="max-w-md shadow-lg">
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <Lock className="size-8 text-muted-foreground" />
                <div>
                  <h3 className="text-base font-semibold">
                    Unlock real agent contacts with Pro
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upgrade to Pro to receive — and exclusively own for 72
                    hours — leads from agents in your service area.
                  </p>
                </div>
                <Link to="/dashboard/upgrade">
                  <Button size="sm" className="mt-1">
                    View Plans
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (rows?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Sparkles className="size-8 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold">No leads yet</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Once your listing is public and an agent in your service area
                joins the waitlist, they'll appear here. Make sure your{" "}
                <Link to="/dashboard/branding" className="text-primary underline">
                  Marketplace Listing
                </Link>{" "}
                is enabled with your city, state, and service area configured.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <Section
            title="Active Leads"
            description="Yours exclusively. Reach out before the countdown ends."
            empty="No open windows right now. New leads will appear here automatically."
            leads={buckets.active}
          />
          <Section
            title="Awaiting Your Response"
            description="You've reached out — waiting on the agent."
            empty="Nothing waiting on a reply yet. Once you contact a lead, it shows up here."
            leads={buckets.awaiting}
          />
          <Section
            title="Past Leads"
            description="Windows that closed without contact, or that re-pooled to another Pro."
            empty="No past leads yet."
            leads={buckets.past}
            collapsedByDefault
          />
        </div>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">A note on outreach</CardTitle>
          <CardDescription>
            Each agent below explicitly opted in to be contacted by a local Pro
            Partner when one becomes active. Your 72-hour exclusive window
            means no other Pro is being shown the same lead — make it count.
            Be specific about your local market and the value of a 3D
            presentation for their listings.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

interface SectionProps {
  title: string;
  description: string;
  empty: string;
  leads: MarketplaceLead[];
  collapsedByDefault?: boolean;
}

function Section({
  title,
  description,
  empty,
  leads,
  collapsedByDefault = false,
}: SectionProps) {
  const [expanded, setExpanded] = useState(!collapsedByDefault);

  return (
    <section className="space-y-3">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {leads.length}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        {collapsedByDefault && leads.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Hide" : "Show"}
          </Button>
        )}
      </header>

      {leads.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
          {empty}
        </p>
      ) : expanded ? (
        <div className="space-y-3">
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
