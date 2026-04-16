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

    const connectedAccountId = (event as any).account;

    switch (event.type) {
      case "checkout.session.completed":
        if (connectedAccountId) {
          await handleConnectCheckoutCompleted(event.data.object, connectedAccountId);
        } else {
          await handleCheckoutCompleted(event.data.object, env);
        }
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
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

  // Belt-and-suspenders: assign client role if not already present
  if (clientId) {
    await supabase
      .from("user_roles")
      .upsert(
        { user_id: clientId, role: "client" },
        { onConflict: "user_id,role" }
      );
  }

  console.log(`Connect payment: model=${modelId}, provider=${providerId}, client=${clientId}, amount=${session.amount_total}`);
}

async function handleAccountUpdated(account: any, connectedAccountId: string) {
  if (account.charges_enabled && account.details_submitted) {
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

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  console.log("Checkout completed:", session.id, "mode:", session.mode);

  if (session.mode !== "payment") return;

  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  const stripe = createStripeClient(env);
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
  const item = lineItems.data[0];
  if (!item) {
    console.error("No line items found for session:", session.id);
    return;
  }

  const priceId = item.price?.metadata?.lovable_external_id || item.price?.lookup_key || item.price?.id;

  // Map price lookup keys to product IDs (supports both old and new naming)
  let resolvedProductId = 'unknown';
  if (priceId === 'starter_onetime' || priceId === 'starter_setup') resolvedProductId = 'starter_tier';
  else if (priceId === 'pro_onetime' || priceId === 'pro_setup') resolvedProductId = 'pro_tier';
  else if (priceId === 'pro_upgrade_onetime' || priceId === 'pro_upgrade_setup') resolvedProductId = 'pro_upgrade';

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
  const isUpgrade = resolvedProductId === 'pro_upgrade';

  if (newTier === 'pro') {
    await supabase
      .from("branding_settings")
      .update({ tier: 'pro' })
      .eq("provider_id", userId);
  } else {
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

  // ── Franchise License: create annual subscription ───────────────────
  // Only create a new subscription for initial setup purchases (not upgrades,
  // since upgrade users already have a subscription from their original purchase).
  if (!isUpgrade && session.customer) {
    try {
      // Resolve the annual_license recurring price
      const annualPrices = await stripe.prices.list({ lookup_keys: ['annual_license'] });
      const annualPrice = annualPrices.data[0];

      if (annualPrice) {
        // Create subscription with 1-year trial (first $49 charge in Year 2)
        const trialEnd = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
        const subscription = await stripe.subscriptions.create({
          customer: session.customer,
          items: [{ price: annualPrice.id }],
          trial_end: trialEnd,
          metadata: { userId, tier: newTier },
        });

        // Set license active with 1-year expiry
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);

        await supabase
          .from("branding_settings")
          .update({
            stripe_subscription_id: subscription.id,
            license_status: 'active',
            license_expiry_date: expiryDate.toISOString(),
          })
          .eq("provider_id", userId);

        console.log(`Subscription created: ${subscription.id} for user=${userId}, trial until ${expiryDate.toISOString()}`);
      } else {
        console.warn("annual_license price not found — subscription not created");
        // Still set license active (graceful degradation)
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 1);
        await supabase
          .from("branding_settings")
          .update({
            license_status: 'active',
            license_expiry_date: expiryDate.toISOString(),
          })
          .eq("provider_id", userId);
      }
    } catch (subErr) {
      console.error("Failed to create subscription:", subErr);
      // Still set license active (don't block the user over subscription failure)
      const expiryDate = new Date();
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);
      await supabase
        .from("branding_settings")
        .update({
          license_status: 'active',
          license_expiry_date: expiryDate.toISOString(),
        })
        .eq("provider_id", userId);
    }
  }

  console.log(`Purchase recorded: user=${userId}, tier=${newTier}, product=${resolvedProductId}`);
}

// ── Annual license renewal ──────────────────────────────────────────────

async function handleInvoicePaid(invoice: any) {
  // Only handle subscription invoices (not one-time payment invoices)
  if (!invoice.subscription) return;

  // Skip the initial $0 trial invoice — only extend license on real renewals
  if (invoice.amount_paid === 0) {
    console.log(`Skipping $0 trial invoice for subscription: ${invoice.subscription}`);
    return;
  }

  const subscriptionId = invoice.subscription;

  const { data: branding } = await supabase
    .from("branding_settings")
    .select("provider_id")
    .eq("stripe_subscription_id", subscriptionId)
    .single();

  if (!branding) {
    console.log(`No branding_settings found for subscription: ${subscriptionId}`);
    return;
  }

  // Extend license by 1 year from now
  const newExpiry = new Date();
  newExpiry.setFullYear(newExpiry.getFullYear() + 1);

  await supabase
    .from("branding_settings")
    .update({
      license_status: 'active',
      license_expiry_date: newExpiry.toISOString(),
    })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`License renewed: provider=${branding.provider_id}, new expiry=${newExpiry.toISOString()}`);
}

// ── Subscription canceled (failed retries) ──────────────────────────────

async function handleSubscriptionDeleted(subscription: any) {
  const subscriptionId = subscription.id;

  const { data: branding } = await supabase
    .from("branding_settings")
    .select("provider_id")
    .eq("stripe_subscription_id", subscriptionId)
    .single();

  if (!branding) {
    console.log(`No branding_settings found for subscription: ${subscriptionId}`);
    return;
  }

  await supabase
    .from("branding_settings")
    .update({ license_status: 'expired' })
    .eq("stripe_subscription_id", subscriptionId);

  console.log(`License expired: provider=${branding.provider_id}, subscription=${subscriptionId}`);
}
