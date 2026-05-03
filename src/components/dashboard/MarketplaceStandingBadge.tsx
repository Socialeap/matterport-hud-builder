/**
 * Renders the Pro's Marketplace Standing label without exposing the
 * raw responsiveness score. Powered by get_my_marketplace_standing,
 * which returns one of 'excellent' | 'good' | 'at_risk'.
 *
 * Designed to be read at-a-glance in the marketplace dashboard
 * header — the label words are intentionally non-numeric so we can
 * tune the score thresholds in SQL without breaking the UI.
 */
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";

type Standing = "excellent" | "good" | "at_risk" | "loading" | null;

const COPY: Record<Exclude<Standing, "loading" | null>, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
}> = {
  excellent: { label: "Excellent", variant: "default" },
  good: { label: "Good", variant: "secondary" },
  at_risk: { label: "At Risk", variant: "destructive" },
};

export function MarketplaceStandingBadge() {
  const [standing, setStanding] = useState<Standing>("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc(
        "get_my_marketplace_standing",
      );
      if (cancelled) return;
      if (error || typeof data !== "string") {
        setStanding(null);
        return;
      }
      if (data === "excellent" || data === "good" || data === "at_risk") {
        setStanding(data);
      } else {
        setStanding(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (standing === "loading" || standing === null) return null;

  const meta = COPY[standing];
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Marketplace Standing</span>
      <Badge variant={meta.variant} className="text-[10px]">
        {meta.label}
      </Badge>
    </div>
  );
}

export default MarketplaceStandingBadge;
