import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Mail, MapPin, Sparkles, Building2, Lock } from "lucide-react";
import { toast } from "sonner";
import { useMspAccess } from "@/hooks/use-msp-access";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/dashboard/marketplace")({
  component: MarketplacePage,
});

type MatchedBeacon = Database["public"]["Functions"]["get_my_matched_beacons"]["Returns"][number];

function MarketplacePage() {
  const { hasPaid } = useMspAccess();
  const [rows, setRows] = useState<MatchedBeacon[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLocked = !hasPaid;

  useEffect(() => {
    // Don't hit the RPC for unpaid MSPs — it will 401/raise. Show preview instead.
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
        const msg = rpcError.message?.toLowerCase() ?? "";
        if (msg.includes("active pro license required")) {
          setError("pro_required");
        } else if (msg.includes("provider role required")) {
          setError("not_provider");
        } else {
          setError("unknown");
          toast.error("Could not load your marketplace contacts");
        }
        setLoading(false);
        return;
      }

      setRows(data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isLocked]);

  // Sample data shown to unpaid MSPs as a teaser of what Pro unlocks.
  const sampleBeacons: MatchedBeacon[] = [
    {
      id: "sample-1",
      name: "Jane Doe",
      email: "jane.d@brokerage.com",
      brokerage: "Coastal Realty Group",
      city: "Your City",
      region: "CA",
      zip: "90210",
      status: "waiting",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2).toISOString(),
      is_first_match_with_me: true,
    },
    {
      id: "sample-2",
      name: "Marcus Lee",
      email: "marcus@listingpros.com",
      brokerage: "Listing Pros",
      city: "Your City",
      region: "CA",
      zip: "90211",
      status: "waiting",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
      is_first_match_with_me: true,
    },
    {
      id: "sample-3",
      name: "Priya Patel",
      email: "priya.p@homefinders.io",
      brokerage: "HomeFinders",
      city: "Your City",
      region: "CA",
      zip: "90212",
      status: "matched",
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 9).toISOString(),
      is_first_match_with_me: false,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Agents who joined the waitlist for a Pro Partner in your service area.
          </p>
        </div>
        <Link to="/dashboard/branding">
          <Button variant="outline" size="sm">
            Configure Listing
          </Button>
        </Link>
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center p-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : rows && rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <BeaconCard key={row.id} beacon={row} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Sparkles className="size-8 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold">No contacts yet</h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Once your listing is public and an agent in your service area joins
                the waitlist, they'll appear here. Make sure your{" "}
                <Link to="/dashboard/branding" className="text-primary underline">
                  Marketplace Listing
                </Link>{" "}
                is enabled with your city, state, and service ZIPs configured.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">A note on outreach</CardTitle>
          <CardDescription>
            Each agent below explicitly opted in to be contacted by a local Pro
            Partner when one becomes active. Reach out via email — be specific
            about your local market and the value of a 3D presentation for
            their listings. Avoid mass-messaging.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function BeaconCard({ beacon }: { beacon: MatchedBeacon }) {
  const submittedAt = new Date(beacon.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex flex-1 flex-col gap-2 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">
              {beacon.name || "Anonymous agent"}
            </h3>
            {beacon.is_first_match_with_me && (
              <Badge variant="default" className="text-[10px]">
                Matched to you
              </Badge>
            )}
            {beacon.status === "matched" && !beacon.is_first_match_with_me && (
              <Badge variant="outline" className="text-[10px]">
                Matched elsewhere
              </Badge>
            )}
          </div>

          {beacon.brokerage && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="size-3" />
              {beacon.brokerage}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <MapPin className="size-3" />
              {beacon.city}
              {beacon.region ? `, ${beacon.region}` : ""}
              {beacon.zip ? ` · ${beacon.zip}` : ""}
            </span>
            <span>Joined {submittedAt}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <a href={`mailto:${beacon.email}`}>
            <Button size="sm" className="gap-1.5">
              <Mail className="size-3.5" />
              {beacon.email}
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
