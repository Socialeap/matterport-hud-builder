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
    name: "Starter",
    price: "$149",
    priceId: "starter_onetime",
    description: "Get started with the platform at a lower price point.",
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
    name: "Pro",
    price: "$299",
    priceId: "pro_onetime",
    popular: true,
    description: "Full whitelabel with your own branding everywhere.",
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
    price: "$199",
    priceId: "pro_upgrade_onetime",
    description: "Already on Starter? Upgrade to Pro for the difference.",
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
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Choose Your Plan</h1>
        <p className="mt-2 text-muted-foreground">One-time payment. No recurring fees. Lifetime access.</p>
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
                <span className="text-4xl font-bold text-foreground">{tier.price}</span>
                <span className="text-sm text-muted-foreground"> one-time</span>
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
                {tier.upgradeOnly ? "Upgrade Now" : `Get ${tier.name}`}
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
