import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DollarSign, AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/pricing")({
  component: ClientPricingPage,
});

interface PricingState {
  priceA: string;
  priceB: string;
  priceC: string;
  flatPrice: string;
  useFlatRate: boolean;
}

function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toString();
}

function inputToCents(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ClientPricingPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stripeConnected, setStripeConnected] = useState(false);
  const [prices, setPrices] = useState<PricingState>({
    priceA: "",
    priceB: "",
    priceC: "",
    flatPrice: "",
    useFlatRate: false,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data, error } = await supabase
        .from("branding_settings")
        .select(
          "base_price_cents, additional_model_fee_cents, tier3_price_cents, stripe_onboarding_complete, flat_price_per_model_cents, use_flat_pricing"
        )
        .eq("provider_id", user.id)
        .maybeSingle();

      if (error) {
        console.error("Failed to load pricing:", error);
      }

      const row = data as {
        base_price_cents?: number | null;
        additional_model_fee_cents?: number | null;
        tier3_price_cents?: number | null;
        stripe_onboarding_complete?: boolean | null;
        flat_price_per_model_cents?: number | null;
        use_flat_pricing?: boolean | null;
      } | null;

      setPrices({
        priceA: centsToInput(row?.base_price_cents),
        priceB: centsToInput(row?.tier3_price_cents),
        priceC: centsToInput(row?.additional_model_fee_cents),
        flatPrice: centsToInput(row?.flat_price_per_model_cents),
        useFlatRate: Boolean(row?.use_flat_pricing),
      });
      setStripeConnected(Boolean(row?.stripe_onboarding_complete));
      setLoading(false);
    })();
  }, [user]);

  const aCents = inputToCents(prices.priceA);
  const bCents = inputToCents(prices.priceB);
  const cCents = inputToCents(prices.priceC);
  const flatCents = inputToCents(prices.flatPrice);

  const calcCents = (count: number): number => {
    if (prices.useFlatRate) {
      const f = flatCents ?? 0;
      return f * count;
    }
    const a = aCents ?? 0;
    const b = bCents;
    const c = cCents ?? 0;
    if (count <= 2) return a * count;
    if (count === 3) return b ?? a * 2 + c;
    return (b ?? a * 2 + c) + (count - 3) * c;
  };

  const handleSave = async () => {
    if (!user) return;
    if (prices.useFlatRate) {
      if (flatCents == null || flatCents <= 0) {
        toast.error("Please enter a valid single flat rate per model.");
        return;
      }
    } else {
      if (aCents == null) {
        toast.error("Please set a price for 1–2 property models.");
        return;
      }
    }
    setSaving(true);
    const { error } = await supabase
      .from("branding_settings")
      .upsert(
        {
          provider_id: user.id,
          base_price_cents: aCents,
          tier3_price_cents: bCents,
          additional_model_fee_cents: cCents,
          model_threshold: 2,
          flat_price_per_model_cents: flatCents,
          use_flat_pricing: prices.useFlatRate,
        } as never,
        { onConflict: "provider_id" }
      );
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Failed to save pricing.");
      return;
    }
    toast.success("Client pricing saved.");
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Client Pricing
        </h1>
        <p className="mt-2 text-muted-foreground">
          Set what your clients pay per Presentation download.  Cost is based on
          the number of 3D property models they include in their Presentation.
          No other charges are included.
        </p>
      </div>

      {!stripeConnected && (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Payouts not connected yet</AlertTitle>
          <AlertDescription>
            You can set prices now, but clients won't be able to check out
            until you connect your payout account.{" "}
            <Link to="/dashboard/payouts" className="underline font-medium">
              Connect Payouts →
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Single flat rate card (top-right alternative pricing mode) */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <DollarSign className="size-4 text-primary" />
                <CardTitle className="text-base">
                  Single flat rate per model
                </CardTitle>
              </div>
              <CardDescription className="mt-1">
                When ON, clients pay this rate × the number of models. Tiered
                pricing below is disabled.
              </CardDescription>
            </div>
            <div className="flex items-center gap-3 self-start">
              <Label
                htmlFor="useFlatRate"
                className="text-sm font-medium text-foreground"
              >
                Use this rate
              </Label>
              <Switch
                id="useFlatRate"
                checked={prices.useFlatRate}
                onCheckedChange={(v) =>
                  setPrices({ ...prices, useFlatRate: v })
                }
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <Label htmlFor="flatPrice" className="text-xs text-muted-foreground">
              Flat price per model (USD)
            </Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                $
              </span>
              <Input
                id="flatPrice"
                type="number"
                min={0}
                step="0.01"
                placeholder="150"
                className="pl-7"
                value={prices.flatPrice}
                onChange={(e) =>
                  setPrices({ ...prices, flatPrice: e.target.value })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tiered pricing cards — dim when flat rate is active */}
      <div className="relative">
        {prices.useFlatRate && (
          <div className="pointer-events-none absolute -top-2 right-0 z-10 rounded-md border border-border bg-background/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            Tier pricing disabled — single rate active
          </div>
        )}
        <div
          className={
            prices.useFlatRate
              ? "grid gap-4 opacity-50 pointer-events-none md:grid-cols-3"
              : "grid gap-4 md:grid-cols-3"
          }
          aria-disabled={prices.useFlatRate}
        >
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <DollarSign className="size-4 text-primary" />
                <CardTitle className="text-base">Per Model under 3</CardTitle>
              </div>
              <CardDescription>For 1 or 2 property models, each model is:</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="priceA" className="sr-only">
                Price A (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="priceA"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="200"
                  className="pl-7"
                  value={prices.priceA}
                  onChange={(e) =>
                    setPrices({ ...prices, priceA: e.target.value })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">Flat fee per model.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <DollarSign className="size-4 text-primary" />
                <CardTitle className="text-base">Per Bundle of 3</CardTitle>
              </div>
              <CardDescription>
                For exactly 3 property models. All 3 models for:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="priceB" className="sr-only">
                Price B (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="priceB"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="450"
                  className="pl-7"
                  value={prices.priceB}
                  onChange={(e) =>
                    setPrices({ ...prices, priceB: e.target.value })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This is usually a discounted bundle.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <DollarSign className="size-4 text-primary" />
                <CardTitle className="text-base">Per Model over 3</CardTitle>
              </div>
              <CardDescription>
                For more than 3 models, each model is:
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="priceC" className="sr-only">
                Price C (USD)
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  $
                </span>
                <Input
                  id="priceC"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="100"
                  className="pl-7"
                  value={prices.priceC}
                  onChange={(e) =>
                    setPrices({ ...prices, priceC: e.target.value })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Per-model fee for Presentations that have more than 3 models.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Example pricing</CardTitle>
          <CardDescription>
            What your clients will see at checkout for typical Portal sizes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="rounded-md border border-border bg-muted/30 p-3 text-center"
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {n} model{n === 1 ? "" : "s"}
                </div>
                <div className="mt-1 text-lg font-bold text-foreground">
                  {formatUSD(calcCents(n))}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save Pricing"
          )}
        </Button>
      </div>
    </div>
  );
}
