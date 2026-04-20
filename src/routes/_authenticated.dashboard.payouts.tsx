import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
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
  const [connecting, setConnecting] = useState(false);
  const initRef = useRef(false);

  const loadStatus = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data: branding, error: brandingErr } = await supabase
        .from("branding_settings")
        .select("stripe_onboarding_complete, accent_color, instant_payout_fee_bps")
        .eq("provider_id", user.id)
        .maybeSingle();

      if (brandingErr) throw brandingErr;

      const accent = branding?.accent_color || "#2563EB";
      setFeeBps((branding as any)?.instant_payout_fee_bps ?? 150);

      if (!branding?.stripe_onboarding_complete) {
        setOnboardingComplete(false);
        setStripeConnectInstance(null);
        setLoading(false);
        return;
      }

      setOnboardingComplete(true);

      const publishableKey = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
      if (!publishableKey) throw new Error("Stripe publishable key not configured");

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
          variables: { colorPrimary: accent },
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
  }, [user]);

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;
    loadStatus();
  }, [user, loadStatus]);

  // Handle return from Stripe Connect onboarding
  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const hasReturn = url.searchParams.has("stripe_connect_return");
    const hasSuccess = url.searchParams.get("stripe_connect_success") === "true";
    if (hasReturn || hasSuccess) {
      supabase.functions
        .invoke("stripe-connect-status", {
          body: { environment: getStripeEnvironment() },
        })
        .then(({ data }) => {
          if (data?.onboarding_complete) {
            toast.success("Stripe account connected successfully!");
            loadStatus();
          } else {
            toast.info("Stripe onboarding not yet complete. Finish all required steps in Stripe.");
          }
        });
      url.searchParams.delete("stripe_connect_return");
      url.searchParams.delete("stripe_connect_success");
      window.history.replaceState({}, "", url.toString());
    }
  }, [user, loadStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-connect-onboard", {
        body: {
          returnUrl: window.location.href,
          environment: getStripeEnvironment(),
        },
      });
      if (error) throw new Error((data as any)?.error || error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      if (!data?.url) throw new Error("Failed to start onboarding");
      window.location.href = data.url;
    } catch (err: any) {
      console.error("Stripe Connect error:", err);
      toast.error(err?.message || "Failed to connect Stripe. Please try again.");
      setConnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const header = (
    <div>
      <h1 className="text-2xl font-bold">Payouts</h1>
      <p className="text-muted-foreground">
        Connect Stripe, view your balance, and manage payouts to your bank account.
      </p>
    </div>
  );

  if (!onboardingComplete) {
    return (
      <div className="container max-w-3xl space-y-6 p-6">
        {header}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Stripe Connect</CardTitle>
                <CardDescription>
                  Connect your Stripe account to accept payments from clients and receive payouts.
                </CardDescription>
              </div>
              <Button size="sm" onClick={handleConnect} disabled={connecting}>
                {connecting ? "Connecting…" : "Connect with Stripe"}
              </Button>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Client Pricing</CardTitle>
                <CardDescription>
                  Set what your clients pay per Presentation Portal — based on the
                  number of 3D property models — in the dedicated Pricing tab.
                </CardDescription>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/dashboard/pricing">Open Pricing →</Link>
              </Button>
            </div>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (error || !stripeConnectInstance) {
    return (
      <div className="container max-w-3xl space-y-6 p-6">
        {header}
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
      {header}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Stripe Connect</CardTitle>
              <CardDescription>
                Your Stripe account is connected. Instant Payout fee:{" "}
                <span className="font-medium">{(feeBps / 100).toFixed(2)}%</span> (set by platform).
              </CardDescription>
            </div>
            <Badge className="bg-green-600 text-white">Stripe Connected ✅</Badge>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Client Pricing</CardTitle>
              <CardDescription>
                Set what your clients pay per Presentation Portal in the dedicated Pricing tab.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/pricing">Open Pricing →</Link>
            </Button>
          </div>
        </CardHeader>
      </Card>

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
