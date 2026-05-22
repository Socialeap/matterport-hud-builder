import { loadStripe, Stripe } from "@stripe/stripe-js";
import { supabase } from "@/integrations/supabase/client";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN;
// TEMPORARY: Lovable's sandbox Stripe connector (std_01kp9q23fdfm68nz4we5dpqp0s)
// has an expired upstream secret that the Disable→Enable cycle is not rotating.
// Pin every client+server call to 'live' so nothing routes to the broken connector.
// Restore the auto-detect line below once Lovable repairs the sandbox connector.
//   const environment = clientToken?.startsWith('pk_test_') ? 'sandbox' : 'live';
const environment: 'sandbox' | 'live' = 'live';

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    if (!clientToken) {
      throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
    }
    stripePromise = loadStripe(clientToken);
  }
  return stripePromise;
}

/** Returns a Stripe instance configured for a connected account (not cached). */
export function getStripeForConnect(stripeAccount: string): Promise<Stripe | null> {
  if (!clientToken) {
    throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");
  }
  return loadStripe(clientToken, { stripeAccount });
}

export async function getStripePriceId(priceId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("get-stripe-price", {
    body: { priceId, environment },
  });
  if (error || !data?.stripeId) {
    throw new Error(`Failed to resolve price: ${priceId}`);
  }
  return data.stripeId;
}

export function getStripeEnvironment(): string {
  return environment;
}
