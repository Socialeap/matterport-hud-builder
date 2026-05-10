import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type StripeEnv, verifyWebhook, createStripeClient } from "../_shared/stripe.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Atomic idempotency claim. Inserts a row into `processed_webhook_events`
 * keyed by the Stripe event id; returns `true` only when this is the first
 * time we've seen the event. Subsequent retries return `false` and the
 * caller short-circuits before mutating any application tables.
 *
 * Stripe retries any non-2xx response and may also retry on its own
 * timeout heuristics, so handlers MUST be guarded by this check or risk
 * double-applying the same payment, subscription update, or onboarding
 * flag.
 */
async function claimEvent(
  eventId: string,
  eventType: string,
  env: StripeEnv,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("processed_webhook_events")
    .upsert(
      {
        event_id: eventId,
        source: "stripe",
        event_type: eventType,
        env,
      },
      { onConflict: "event_id", ignoreDuplicates: true },
    )
    .select("event_id");

  if (error) {
    // Don't swallow real DB errors — let the caller return 500 so Stripe
    // retries (and we get to try the idempotency claim again).
    throw error;
  }
  return Array.isArray(data) && data.length > 0;
}

/**
 * Best-effort release of the idempotency row when a downstream handler
 * fails. Without this, the next Stripe retry would see the row, treat
 * the event as a duplicate, and return 200 — leaving the system in a
 * partial-update state. We swallow errors here because the caller is
 * already on the failure path; if the delete itself fails the row will
 * leak, but the operator can inspect `processed_webhook_events` for
 * recently-stuck rows.
 */
async function releaseEvent(eventId: string): Promise<void> {
  try {
    await supabase
      .from("processed_webhook_events")
      .delete()
      .eq("event_id", eventId);
  } catch (err) {
    console.error("Failed to release idempotency row for", eventId, err);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // env is derived from which webhook secret verified the signature —
    // NOT from the request URL or body. See _shared/stripe.ts for the
    // trust model.
    const { event, env } = await verifyWebhook(req);
    console.log(
      "Received event:",
      event.type,
      "id:",
      event.id,
      "env:",
      env,
      "livemode:",
      event.livemode,
    );

    // Idempotency: short-circuit if this event id has been processed
    // before. Stripe retries on timeout, on 5xx, and at its own
    // discretion; without this guard, every retry would re-apply the
    // tier flip / license update / order notification.
    const isFirstDelivery = await claimEvent(event.id, event.type, env);
    if (!isFirstDelivery) {
      console.log("Duplicate webhook, skipping handlers:", event.id, event.type);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const connectedAccountId = event.account;

    try {
      switch (event.type) {
        case "checkout.session.completed":
          if (connectedAccountId) {
            await handleConnectCheckoutCompleted(event.data.object, connectedAccountId);
          } else {
            await handleCheckoutCompleted(event.data.object, env);
          }
          break;

        case "customer.subscription.created":
          await handleSubscriptionCreated(event.data.object, env);
          break;

        case "customer.subscription.updated":
          await handleSubscriptionUpdated(event.data.object, env);
          break;

        case "customer.subscription.deleted":
          await handleSubscriptionDeleted(event.data.object, env);
          break;

        case "invoice.payment_succeeded":
          await handleInvoicePaymentSucceeded(event.data.object, env);
          break;

        case "account.updated":
          if (connectedAccountId) {
            await handleAccountUpdated(event.data.object, connectedAccountId);
          }
          break;

        default:
          console.log("Unhandled event:", event.type);
      }
    } catch (handlerErr) {
      // Handler failed AFTER the idempotency claim succeeded. Release
      // the claim so Stripe's retry can re-enter the handler instead of
      // being silently bounced as a duplicate. Then re-throw so the
      // outer catch returns 5xx.
      await releaseEvent(event.id);
      throw handlerErr;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    // Any failure (signature mismatch, idempotency-table outage, handler
    // throw) is logged and surfaced as 4xx/5xx so Stripe retries.
    console.error("Webhook error:", e);
    const isVerifyError =
      e instanceof Error &&
      /signature|livemode|webhook secret|timestamp/i.test(e.message);
    return new Response(
      isVerifyError ? "Webhook signature error" : "Webhook handler error",
      { status: isVerifyError ? 400 : 500 },
    );
  }
});

// ── Connect checkout (client paying provider) ──────────────────────
async function handleConnectCheckoutCompleted(session: any, connectedAccountId: string) {
  console.log("Connect checkout completed:", session.id, "account:", connectedAccountId);

  const modelId = session.metadata?.modelId;
  const providerId = session.metadata?.providerId;
  const clientId = session.metadata?.clientId;

  if (!modelId) {
    console.error("No modelId in connect checkout session metadata");
    return;
  }

  const { error: modelError } = await supabase
    .from("saved_models")
    .update({ status: "paid", is_released: true, amount_cents: session.amount_total || 0 })
    .eq("id", modelId);

  if (modelError) {
    console.error("Failed to update saved_model:", modelError);
    return;
  }

  if (providerId) {
    await supabase
      .from("order_notifications")
      .update({ status: "paid" })
      .eq("model_id", modelId)
      .eq("provider_id", providerId);
  }

  if (clientId) {
    await supabase
      .from("user_roles")
      .upsert({ user_id: clientId, role: "client" }, { onConflict: "user_id,role" });
  }

  console.log(`Connect payment: model=${modelId}, provider=${providerId}, client=${clientId}, amount=${session.amount_total}`);
}

// ── Account updated (Connect onboarding) ───────────────────────────
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

// ── Platform checkout (one-time legacy fallback) ───────────────────
async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  console.log("Checkout completed:", session.id, "mode:", session.mode);
  // For subscriptions the subscription.created event handles license creation
  if (session.mode === "subscription") {
    console.log("Subscription checkout — license handled by subscription.created event");
    return;
  }
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

  let resolvedProductId = 'unknown';
  if (priceId === 'starter_onetime') resolvedProductId = 'starter_tier';
  else if (priceId === 'pro_onetime') resolvedProductId = 'pro_tier';
  else if (priceId === 'pro_upgrade_onetime') resolvedProductId = 'pro_upgrade';

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

  const newTier = resolvedProductId === 'starter_tier' ? 'starter' : 'pro';

  if (newTier === 'pro') {
    await supabase.from("branding_settings").update({ tier: 'pro' }).eq("provider_id", userId);
  } else {
    const { data: existing } = await supabase
      .from("branding_settings")
      .select("tier")
      .eq("provider_id", userId)
      .single();

    if (!existing) {
      await supabase.from("branding_settings").insert({ provider_id: userId, tier: 'starter' });
    }
  }

  console.log(`Purchase recorded: user=${userId}, tier=${newTier}, product=${resolvedProductId}`);
}

// ── Subscription created → insert license ──────────────────────────
async function handleSubscriptionCreated(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  const tier = subscription.metadata?.tier || 'starter';

  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }

  const periodEnd = subscription.current_period_end;
  const licenseExpiry = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  // Upsert license
  const { error: licError } = await supabase.from("licenses").upsert(
    {
      user_id: userId,
      tier: tier as 'starter' | 'pro',
      license_status: 'active',
      license_expiry: licenseExpiry,
      stripe_subscription_id: subscription.id,
    },
    { onConflict: "user_id" }
  );

  if (licError) {
    console.error("Failed to create license:", licError);
  }

  // Ensure branding_settings row exists with correct tier
  const { data: existing } = await supabase
    .from("branding_settings")
    .select("id")
    .eq("provider_id", userId)
    .single();

  if (existing) {
    await supabase.from("branding_settings").update({ tier }).eq("provider_id", userId);
  } else {
    await supabase.from("branding_settings").insert({ provider_id: userId, tier });
  }

  // Assign provider role
  await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role: "provider" }, { onConflict: "user_id,role" });

  console.log(`License created: user=${userId}, tier=${tier}, expiry=${licenseExpiry}, sub=${subscription.id}`);
}

// ── Subscription updated → sync status ─────────────────────────────
async function handleSubscriptionUpdated(subscription: any, env: StripeEnv) {
  const statusMap: Record<string, string> = {
    active: 'active',
    trialing: 'active',
    past_due: 'past_due',
    canceled: 'expired',
    unpaid: 'expired',
    incomplete: 'past_due',
    incomplete_expired: 'expired',
    paused: 'past_due',
  };

  const licenseStatus = statusMap[subscription.status] || 'expired';
  const periodEnd = subscription.current_period_end;
  const licenseExpiry = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  const { error } = await supabase
    .from("licenses")
    .update({
      license_status: licenseStatus as 'active' | 'past_due' | 'expired',
      license_expiry: licenseExpiry,
    })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("Failed to update license:", error);
  } else {
    console.log(`License updated: sub=${subscription.id}, status=${licenseStatus}`);
  }
}

// ── Subscription deleted → expire license ──────────────────────────
async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  const { error } = await supabase
    .from("licenses")
    .update({ license_status: 'expired' })
    .eq("stripe_subscription_id", subscription.id);

  if (error) {
    console.error("Failed to expire license:", error);
  } else {
    console.log(`License expired: sub=${subscription.id}`);
  }
}

// ── Invoice payment succeeded → extend expiry ──────────────────────
async function handleInvoicePaymentSucceeded(invoice: any, env: StripeEnv) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) {
    console.log("Invoice without subscription, skipping license extension");
    return;
  }

  // Fetch the subscription to get current_period_end
  const stripe = createStripeClient(env);
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const periodEnd = subscription.current_period_end;
  const licenseExpiry = periodEnd ? new Date(periodEnd * 1000).toISOString() : null;

  const { error } = await supabase
    .from("licenses")
    .update({
      license_status: 'active',
      license_expiry: licenseExpiry,
    })
    .eq("stripe_subscription_id", subscriptionId);

  if (error) {
    console.error("Failed to extend license:", error);
  } else {
    console.log(`License extended: sub=${subscriptionId}, new_expiry=${licenseExpiry}`);
  }
}
