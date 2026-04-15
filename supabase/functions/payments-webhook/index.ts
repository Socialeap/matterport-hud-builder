import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type StripeEnv, verifyWebhook, createStripeClient } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(req.url);
  const env = (url.searchParams.get('env') || 'sandbox') as StripeEnv;

  try {
    const event = await verifyWebhook(req, env);
    console.log("Received event:", event.type, "env:", env, "account:", (event as any).account);

    // Check if this is a connected account event
    const connectedAccountId = (event as any).account;

    switch (event.type) {
      case "checkout.session.completed":
        if (connectedAccountId) {
          await handleConnectCheckoutCompleted(event.data.object, connectedAccountId);
        } else {
          await handleCheckoutCompleted(event.data.object, env);
        }
        break;
      case "account.updated":
        if (connectedAccountId) {
          await handleAccountUpdated(event.data.object, connectedAccountId);
        }
        break;
      default:
        console.log("Unhandled event:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Webhook error:", e);
    return new Response("Webhook error", { status: 400 });
  }
});

// Handle checkout from a connected MSP account (client paying for presentation)
async function handleConnectCheckoutCompleted(session: any, connectedAccountId: string) {
  console.log("Connect checkout completed:", session.id, "account:", connectedAccountId);

  const modelId = session.metadata?.modelId;
  const providerId = session.metadata?.providerId;
  const clientId = session.metadata?.clientId;

  if (!modelId) {
    console.error("No modelId in connect checkout session metadata");
    return;
  }

  // Update saved_models: mark as paid and released
  const { error: modelError } = await supabase
    .from("saved_models")
    .update({
      status: "paid",
      is_released: true,
      amount_cents: session.amount_total || 0,
    })
    .eq("id", modelId);

  if (modelError) {
    console.error("Failed to update saved_model:", modelError);
    return;
  }

  // Update order notification
  if (providerId) {
    await supabase
      .from("order_notifications")
      .update({ status: "paid" })
      .eq("model_id", modelId)
      .eq("provider_id", providerId);
  }

  console.log(`Connect payment: model=${modelId}, provider=${providerId}, client=${clientId}, amount=${session.amount_total}`);
}

// Handle account status updates (onboarding completion)
async function handleAccountUpdated(account: any, connectedAccountId: string) {
  if (account.charges_enabled && account.details_submitted) {
    // Mark onboarding complete for this MSP
    const { error } = await supabase
      .from("branding_settings")
      .update({ stripe_onboarding_complete: true })
      .eq("stripe_connect_id", connectedAccountId);

    if (error) {
      console.error("Failed to update onboarding status:", error);
    } else {
      console.log(`Onboarding complete for account: ${connectedAccountId}`);
    }
  }
}

// Handle platform checkout (MSP buying tier upgrades)
async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  console.log("Checkout completed:", session.id, "mode:", session.mode);

  if (session.mode !== "payment") return;

  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  // Retrieve the line items to get product/price info
  const stripe = createStripeClient(env);
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
  const item = lineItems.data[0];
  if (!item) {
    console.error("No line items found for session:", session.id);
    return;
  }

  const priceId = item.price?.metadata?.lovable_external_id || item.price?.lookup_key || item.price?.id;
  
  // Determine the tier product_id from the price lookup key
  let resolvedProductId = 'unknown';
  if (priceId === 'starter_onetime') resolvedProductId = 'starter_tier';
  else if (priceId === 'pro_onetime') resolvedProductId = 'pro_tier';
  else if (priceId === 'pro_upgrade_onetime') resolvedProductId = 'pro_upgrade';

  // Record the purchase
  const { error } = await supabase.from("purchases").upsert(
    {
      user_id: userId,
      stripe_session_id: session.id,
      stripe_customer_id: session.customer,
      product_id: resolvedProductId,
      price_id: priceId || '',
      amount_cents: session.amount_total || 0,
      currency: session.currency || 'usd',
      status: 'completed',
      environment: env,
    },
    { onConflict: "stripe_session_id" }
  );

  if (error) {
    console.error("Failed to record purchase:", error);
    return;
  }

  // Update the provider's branding_settings tier
  const newTier = resolvedProductId === 'starter_tier' ? 'starter' : 'pro';
  
  // Only upgrade, never downgrade
  if (newTier === 'pro') {
    await supabase
      .from("branding_settings")
      .update({ tier: 'pro' })
      .eq("provider_id", userId);
  } else {
    // For starter, only set if no branding_settings exists yet
    const { data: existing } = await supabase
      .from("branding_settings")
      .select("tier")
      .eq("provider_id", userId)
      .single();
    
    if (!existing) {
      await supabase.from("branding_settings").insert({
        provider_id: userId,
        tier: 'starter',
      });
    }
  }

  console.log(`Purchase recorded: user=${userId}, tier=${newTier}, product=${resolvedProductId}`);
}
