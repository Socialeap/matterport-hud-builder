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
    priceId: "starter_setup",
    description: "Launch your branded studio with co-branded output.",
    features: [
      { text: 'Co-branded HUD output ("Powered by Transcendence Media")', included: true },
      { text: "Full builder access", included: true },
      { text: "Client invitation management", included: true },
      { text: "Music & tour behavior config", included: true },
      { text: "Custom domain", included: false },
      { text: "Full whitelabel (remove co-branding)", included: false },
    ],
  },
  {
    id: "pro",
    name: "Pro Studio",
    setupPrice: "$299",
    priceId: "pro_setup",
    popular: true,
    description: "Full whitelabel studio with your own branding everywhere.",
    features: [
      { text: "100% whitelabel — no co-branding", included: true },
      { text: "Full builder access", included: true },
      { text: "Client invitation management", included: true },
      { text: "Music & tour behavior config", included: true },
      { text: "Custom domain support", included: true },
      { text: "Priority support", included: true },
    ],
  },
  {
    id: "upgrade",
    name: "Pro Upgrade",
    setupPrice: "$189",
    priceId: "pro_upgrade_setup",
    description: "Already on Starter? Upgrade to Pro for a one-time fee.",
    features: [
      { text: "Removes co-branding from all output", included: true },
      { text: "Unlocks custom domain support", included: true },
      { text: "Retroactive — applies to existing tours", included: true },
    ],
    upgradeOnly: true,
  },
];

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
    <div className="mx-auto max-w-5xl space-y-8">
      <PaymentTestModeBanner />

      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Purchase Your Dedicated 3D Studio.</h1>
        <p className="mt-2 max-w-2xl mx-auto text-muted-foreground">
          A one-time license fee grants you access to setup and brand your own Studio.
          Your first year of white-label hosting, transactions, AI data-generation (for clients),
          is all FREE! After that it's just $49/year to maintain those features while improving/developing new ones.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <Card
            key={tier.id}
            className={`relative flex flex-col ${tier.popular ? "border-primary shadow-lg" : ""}`}
          >
            {tier.popular && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                Most Popular
              </Badge>
            )}
            {tier.upgradeOnly && (
              <Badge variant="secondary" className="absolute -top-3 left-1/2 -translate-x-1/2">
                Upgrade Path
              </Badge>
            )}
            <CardHeader className="text-center">
              <CardTitle className="text-xl">{tier.name}</CardTitle>
              <p className="text-sm text-muted-foreground">{tier.description}</p>
              <div className="mt-4">
                <span className="text-4xl font-bold text-foreground">{tier.setupPrice}</span>
                <span className="text-sm text-muted-foreground">
                  {tier.upgradeOnly ? " one-time upgrade" : " Studio Setup Fee"}
                </span>
                {!tier.upgradeOnly && (
                  <div className="mt-1">
                    <span className="text-lg font-semibold text-foreground">$49</span>
                    <span className="text-sm text-muted-foreground">/year starting Year 2</span>
                  </div>
                )}
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
              <Button
                className="w-full"
                variant={tier.popular ? "default" : "outline"}
                onClick={() => handlePurchase(tier.priceId)}
              >
                {tier.upgradeOnly ? `Upgrade to Pro — ${tier.setupPrice}` : "Open Your Studio"}
              </Button>
            </CardContent>
          </Card>
        ))}
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
