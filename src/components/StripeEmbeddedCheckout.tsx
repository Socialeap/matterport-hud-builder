import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StripeEmbeddedCheckoutProps {
  priceId: string;
  customerEmail?: string;
  userId?: string;
  returnUrl?: string;
  onError?: (error: string) => void;
}

export function StripeEmbeddedCheckout({
  priceId,
  customerEmail,
  userId,
  returnUrl,
  onError,
}: StripeEmbeddedCheckoutProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const createSession = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("create-checkout", {
        body: { priceId, customerEmail, userId, returnUrl, environment: getStripeEnvironment() },
      });

      if (fnError) {
        throw new Error(fnError.message || "Failed to create checkout session");
      }

      // Handle structured error responses (edge function returned 200 with ok:false or error field)
      if (data?.error) {
        throw new Error(data.error);
      }

      if (!data?.clientSecret) {
        throw new Error("No client secret returned from server");
      }

      setClientSecret(data.clientSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare checkout";
      setError(message);
      onError?.(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Preparing secure checkout…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <AlertCircle className="size-10 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium text-foreground">Checkout unavailable</p>
          <p className="text-sm text-muted-foreground max-w-sm">{error}</p>
        </div>
        <Button variant="outline" onClick={createSession}>
          Try Again
        </Button>
      </div>
    );
  }

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ clientSecret: clientSecret! }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
