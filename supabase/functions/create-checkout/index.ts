import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

// Setup fees in cents
const SETUP_FEES: Record<string, number> = {
  starter_annual: 14900, // $149
  pro_annual: 29900,     // $299
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { priceId, customerEmail, userId, returnUrl, environment } = await req.json();
    if (!priceId || typeof priceId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(priceId)) {
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

    // Resolve human-readable price ID via lookup_keys
    const prices = await stripe.prices.list({ lookup_keys: [priceId] });
    if (!prices.data.length) {
      console.error(`[create-checkout] Price not found for lookup_key: ${priceId}`);
      return new Response(JSON.stringify({ error: "Price not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const stripePrice = prices.data[0];
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
      ...(customerEmail && { customer_email: customerEmail }),
    };

    // For subscriptions, attach metadata and setup fee via invoice
    if (isRecurring) {
      sessionParams.subscription_data = {
        metadata: { userId: userId || "", priceId, tier: priceId === 'pro_annual' ? 'pro' : 'starter' },
      };
      // Add setup fee as an invoice item via subscription_data
      if (setupFeeCents > 0) {
        sessionParams.subscription_data.invoice_settings = {
          issuer: { type: 'self' },
        };
        // Use invoice_creation for adding one-time setup fee line
        sessionParams.invoice_creation = undefined; // not available in sub mode
        // Instead, use a one-time price_data line item alongside the subscription
        lineItems.push({
          price_data: {
            currency: stripePrice.currency || 'usd',
            product_data: { name: `${priceId === 'pro_annual' ? 'Pro' : 'Starter'} Studio Setup Fee` },
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
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
