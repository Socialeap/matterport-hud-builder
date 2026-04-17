import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard/pricing")({
  component: PricingPage,
});

const tiers = [
  {
    id: "starter",
    name: "Starter Studio",
    setupPrice: "$149",
    annualPrice: "$49",
    priceId: "starter_annual",
    description: "Get started with co-branded studio.",
    features: [
      { text: 'Co-branded HUD output ("Powered by Transcendence Media")', included: true },
      { text: "Full builder access", included: true },
      { text: "Client invitation management", included: true },
      { text: "Music & tour behavior config", included: true },
      { text: "AI-powered property Q&A*", included: true },
      { text: "Easy Stripe-Connect payout options", included: true },
      { text: "Per-pricing for multiple property tours", included: true },
      { text: "Custom domain", included: false },
      { text: "Full whitelabel (remove co-branding)", included: false },
      { text: "AI Lead Generation for Clients*", included: false },
    ],
    note: "Upgrade to Pro Studio later for just $199 — not the full $299.",
  },
  {
    id: "pro",
    name: "Pro Studio",
    setupPrice: "$299",
    annualPrice: "$49",
    priceId: "pro_annual",
    popular: true,
    description: "Full whitelabel studio and more.",
    features: [
      { text: "100% whitelabel — no co-branding", included: true },
      { text: "Full builder access", included: true },
      { text: "Client invitation management", included: true },
      { text: "Music & tour behavior config", included: true },
      { text: "AI-powered property Q&A*", included: true },
      { text: "Easy Stripe-Connect payout options", included: true },
      { text: "Per-pricing for multiple property tours", included: true },
      { text: "Custom domain support", included: true },
      { text: "AI Lead Generation for Clients*", included: true },
      { text: "Priority support", included: true },
    ],
  },
] as const;

type Tier = {
  id: string;
  name: string;
  setupPrice: string;
  annualPrice: string;
  priceId: string;
  description: string;
  features: readonly { text: string; included: boolean }[];
  popular?: boolean;
  note?: string;
};

function PricingPage() {
  const { user } = useAuth();
  const { openCheckout, closeCheckout, isOpen, CheckoutForm } = useStripeCheckout();

  const handlePurchase = (priceId: string) => {
    openCheckout({
      priceId,
      customerEmail: user?.email ?? undefined,
      userId: user?.id ?? "",
      returnUrl: `${window.location.origin}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PaymentTestModeBanner />

      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Purchase Your Studio
        </h1>
        <p className="mt-2 text-muted-foreground">
          One-time setup fee · then $49/year upkeep license (first year free).
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {(tiers as unknown as Tier[]).map((tier) => (
          <Card
            key={tier.id}
            className={`relative flex flex-col ${tier.popular ? "border-primary shadow-lg" : ""}`}
          >
            {tier.popular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Most Popular
              </Badge>
            )}
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{tier.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{tier.description}</p>
              <div className="mt-4 space-y-1">
                <div>
                  <span className="text-4xl font-bold text-foreground">{tier.setupPrice}</span>
                  <span className="text-sm text-muted-foreground"> setup</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground">{tier.annualPrice}</span>/year upkeep license -{" "}
                  First year <span className="font-bold text-primary">FREE!</span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-6">
              <ul className="space-y-3">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {feature.included ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className={feature.included ? "text-foreground" : "text-muted-foreground"}>
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>
              {tier.note && (
                <p className="text-xs text-muted-foreground italic">{tier.note}</p>
              )}
              <Button
                className="w-full"
                variant={tier.popular ? "default" : "outline"}
                onClick={() => handlePurchase(tier.priceId)}
              >
                Get {tier.name}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="text-center text-xs text-muted-foreground">
        *All AI supported features require an active annual upkeep license to function.
        <br />
        Your studio setup (builder, branding, saved presentations) is permanent and never expires.
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => !open && closeCheckout()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Complete Your Purchase</DialogTitle>
          {CheckoutForm && <CheckoutForm />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
