import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface LockedFeatureCardProps {
  featureName: string;
  description?: string;
}

/**
 * Friendly "purchase to unlock" placeholder. Used as the page body for
 * Special Components (Clients, Payouts, Production Vault) when the MSP
 * has not yet purchased Starter or Pro.
 */
export function LockedFeatureCard({ featureName, description }: LockedFeatureCardProps) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <Card className="border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/15">
            <Lock className="size-6 text-primary" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">
              {featureName} is unlocked after purchase
            </h2>
            <p className="text-sm text-muted-foreground">
              {description ??
                "Choose a Starter or Pro plan to enable this feature for your Studio."}
            </p>
          </div>
          <Button asChild>
            <Link to="/dashboard/upgrade">Choose a plan</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
