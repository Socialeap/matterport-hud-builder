import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";
import { loadConnectAndInitialize } from "@stripe/connect-js";
import {
  ConnectComponentsProvider,
  ConnectPayouts,
  ConnectBalances,
  ConnectPayoutsList,
} from "@stripe/react-connect-js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Banknote, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/payouts")({
  component: PayoutsPage,
});

function PayoutsPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [feeBps, setFeeBps] = useState(150);
  const [stripeConnectInstance, setStripeConnectInstance] = useState<ReturnType<typeof loadConnectAndInitialize> | null>(null);
  const initRef = useRef(false);

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;

    const init = async () => {
      try {
        const { data: branding, error: brandingErr } = await supabase
          .from("branding_settings")
          .select("stripe_onboarding_complete, accent_color, instant_payout_fee_bps")
          .eq("provider_id", user.id)
          .maybeSingle();

        if (brandingErr) throw brandingErr;

        if (!branding?.stripe_onboarding_complete) {
          setOnboardingComplete(false);
          setLoading(false);
          return;
        }

        setOnboardingComplete(true);
        setFeeBps((branding as any).instant_payout_fee_bps ?? 150);

        const publishableKey = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
        if (!publishableKey) throw new Error("Stripe publishable key not configured");

        const accent = branding.accent_color || "#2563EB";

        const instance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret: async () => {
            const { data, error } = await supabase.functions.invoke("stripe-connect-account-session", {
              body: { environment: getStripeEnvironment() },
            });
            if (error) throw new Error((data as any)?.error || error.message);
            if ((data as any)?.error) throw new Error((data as any).error);
            return (data as any).client_secret as string;
          },
          appearance: {
            overlays: "dialog",
            variables: {
              colorPrimary: accent,
            },
          },
        });

        setStripeConnectInstance(instance);
        setLoading(false);
      } catch (err: any) {
        console.error("Payouts init error:", err);
        setError(err?.message || "Failed to initialize payouts");
        toast.error(err?.message || "Failed to initialize payouts");
        setLoading(false);
      }
    };

    init();
  }, [user]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!onboardingComplete) {
    return (
      <div className="container max-w-2xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Payouts</h1>
          <p className="text-muted-foreground">Manage your earnings and instant payouts.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-5" />
              Connect Stripe to receive payouts
            </CardTitle>
            <CardDescription>
              You need to complete Stripe Connect onboarding before you can view balances or initiate payouts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/dashboard/branding">
                Go to Stripe Connect setup <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !stripeConnectInstance) {
    return (
      <div className="container max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-bold">Payouts</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-destructive">{error || "Unable to load payouts."}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Payouts</h1>
        <p className="text-muted-foreground">
          View your balance, manage payout schedule, and request instant payouts.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Instant Payout fee: <span className="font-medium">{(feeBps / 100).toFixed(2)}%</span> (set by platform)
        </p>
      </div>

      <ConnectComponentsProvider connectInstance={stripeConnectInstance}>
        <Card>
          <CardHeader>
            <CardTitle>Balance</CardTitle>
            <CardDescription>Available funds and instant-eligible balance</CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectBalances />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payouts</CardTitle>
            <CardDescription>
              Initiate instant payouts (typically arrive within 30 minutes) or manage your standard payout schedule.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ConnectPayouts />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payout History</CardTitle>
          </CardHeader>
          <CardContent>
            <ConnectPayoutsList />
          </CardContent>
        </Card>
      </ConnectComponentsProvider>
    </div>
  );
}
