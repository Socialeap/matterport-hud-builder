import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  type StripeEnv,
  createStripeClient,
  isStripeCredentialError,
  stripeCredentialResponse,
} from "../_shared/stripe.ts";

// Setup fees in cents (Studio Setup & Franchise Fee)
const SETUP_FEES: Record<string, number> = {
  starter_annual: 14900, // $149
  pro_annual: 29900,     // $299
};

// Hardcoded live Stripe IDs so product-restricted coupons (e.g. AWw4lrRx)
// match exactly. Sandbox keeps lookup_key resolution since these prod_*/price_*
// IDs only exist in the live Stripe account.
const LIVE_STRIPE_IDS: Record<string, { productId: string; priceId: string }> = {
  starter_annual: {
    productId: "prod_ULJU4Nl5h77Jte",
    priceId: "price_1TMcs0CQXdxBxU8GqT6j5mUb",
  },
  pro_annual: {
    productId: "prod_ULJUtLfqo0icwT",
    priceId: "price_1TMcrzCQXdxBxU8GuhuqJidW",
  },
};

const ALLOWED_PRICE_IDS = new Set(["starter_annual", "pro_annual"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { priceId, customerEmail, userId, returnUrl, environment } = await req.json();
    if (!priceId || typeof priceId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(priceId) || !ALLOWED_PRICE_IDS.has(priceId)) {
      console.error("[create-checkout] Invalid priceId:", priceId);
      return new Response(JSON.stringify({ error: "Invalid priceId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const env = (environment || 'sandbox') as StripeEnv;
    console.log(`[create-checkout] env=${env}, priceId=${priceId}`);

    let stripe;
    try {
      stripe = createStripeClient(env);
    } catch (keyErr) {
      const msg = keyErr instanceof Error ? keyErr.message : String(keyErr);
      console.error("[create-checkout] Stripe client init failed:", msg);
      return new Response(JSON.stringify({ error: `Payment environment not configured: ${msg}` }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve price — live uses hardcoded IDs (deterministic, coupon-safe);
    // sandbox keeps lookup_key flow because those IDs don't exist there.
    let stripePrice;
    let resolvedProductId: string;
    if (env === 'live') {
      const ids = LIVE_STRIPE_IDS[priceId];
      try {
        stripePrice = await stripe.prices.retrieve(ids.priceId);
      } catch (err) {
        if (isStripeCredentialError(err)) {
          return stripeCredentialResponse(env, corsHeaders);
        }
        console.error(`[create-checkout] Failed to retrieve live price ${ids.priceId}:`, err);
        return new Response(JSON.stringify({ error: "Price not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      resolvedProductId = ids.productId;
    } else {
      const prices = await stripe.prices.list({ lookup_keys: [priceId] });
      if (!prices.data.length) {
        console.error(`[create-checkout] Price not found for lookup_key: ${priceId}`);
        return new Response(JSON.stringify({ error: "Price not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      stripePrice = prices.data[0];
      resolvedProductId = stripePrice.product as string;
    }

    const isRecurring = stripePrice.type === "recurring";

    // Determine setup fee for subscription products
    const setupFeeCents = SETUP_FEES[priceId] || 0;

    // Build line items — subscription line + optional one-time setup fee
    const lineItems: any[] = [{ price: stripePrice.id, quantity: 1 }];

    // Create the session
    const sessionParams: any = {
      line_items: lineItems,
      mode: isRecurring ? "subscription" : "payment",
      ui_mode: "embedded",
      return_url: returnUrl || `${req.headers.get("origin")}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      allow_promotion_codes: true,
      ...(customerEmail && { customer_email: customerEmail }),
    };

    // For subscriptions, attach metadata, 1-year free trial, and setup fee
    if (isRecurring) {
      const tierLabel = priceId === 'pro_annual' ? 'Pro' : 'Starter';
      sessionParams.subscription_data = {
        metadata: { userId: userId || "", priceId, tier: tierLabel.toLowerCase() },
        trial_period_days: 365, // First year free — $49 Starter / $79 Pro upkeep starts Year 2
      };
      // Add one-time setup fee as a line item, explicitly tied to the same
      // product as the subscription so product-restricted coupons apply.
      if (setupFeeCents > 0) {
        lineItems.push({
          price_data: {
            currency: stripePrice.currency || 'usd',
            product: resolvedProductId,
            unit_amount: setupFeeCents,
          },
          quantity: 1,
        });
      }
    } else {
      // One-time payment fallback
      if (userId) {
        sessionParams.metadata = { userId };
        sessionParams.payment_intent_data = {
          metadata: { userId, priceId },
        };
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    console.log(`[create-checkout] Session created: ${session.id}, mode: ${sessionParams.mode}`);
    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal server error";
    console.error("[create-checkout] Unhandled error:", msg);
    if (isStripeCredentialError(error)) {
      return stripeCredentialResponse("sandbox", corsHeaders);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
