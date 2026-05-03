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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc(
        "get_my_matched_beacons",
      );
      if (cancelled) return;

      if (rpcError) {
        // The RPC raises specific RAISE EXCEPTIONs that surface as PostgREST
        // errors. We don't expose the SQL message verbatim — translate to
        // friendly copy.
        const msg =
          rpcError.message?.toLowerCase() ?? "";
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
  }, []);

  // Pro-license gate. The RPC enforces this server-side too — this is just
  // for nicer UX so the user understands why they don't see contacts.
  if (error === "pro_required" || (!loading && !hasPaid)) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Marketplace Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Agents waiting in your service area.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <Lock className="size-8 text-muted-foreground" />
            <div>
              <h3 className="text-base font-semibold">Marketplace contacts are a Pro feature</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Activate a Pro license to see — and reach out to — agents
                who've requested a local Pro Partner in your service area.
              </p>
            </div>
            <Link to="/dashboard/upgrade">
              <Button size="sm" className="mt-2">
                View Plans
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

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
