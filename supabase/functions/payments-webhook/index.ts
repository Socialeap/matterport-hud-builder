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

// ── Frontiers3D platform-fee ledger settlement ─────────────────────
/**
 * Marks the platform_fee_ledger row for a completed checkout as
 * `collected`. The pending row is written by create-connect-checkout
 * keyed on the Stripe checkout session id; here we flip it to collected
 * and attach the PaymentIntent. If the pending row is missing (e.g. the
 * pre-insert failed), we reconstruct it from the session metadata so the
 * platform-fee record is never lost.
 *
 * Idempotent in practice: this only runs once per checkout completion
 * because the outer handler is guarded by claimEvent().
 */
async function settlePlatformFeeLedger(
  session: any,
  path: "provider_connected" | "platform_direct",
): Promise<void> {
  const sessionId: string | undefined = session.id;
  if (!sessionId) return;

  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const nowIso = new Date().toISOString();

  const { data: updated, error: updErr } = await supabase
    .from("platform_fee_ledger")
    .update({
      status: "collected",
      checkout_path: path,
      stripe_payment_intent_id: paymentIntentId,
      collected_at: nowIso,
    })
    .eq("stripe_checkout_session_id", sessionId)
    .select("id");

  if (updErr) {
    console.error("Failed to settle platform_fee_ledger:", updErr);
    throw updErr;
  }

  if (Array.isArray(updated) && updated.length > 0) return;

  // No pending row — reconstruct from metadata so revenue isn't lost.
  const m = session.metadata ?? {};
  const modelCount = parseInt(m.modelCount, 10);
  const feeCents = parseInt(m.feeCents, 10);
  if (!m.modelId || !m.feeScheduleId || !Number.isFinite(modelCount) || !Number.isFinite(feeCents)) {
    console.error("Cannot reconstruct platform_fee_ledger for session", sessionId, "missing metadata");
    return;
  }
  const { error: insErr } = await supabase.from("platform_fee_ledger").insert({
    saved_model_id: m.modelId,
    client_id: m.clientId ?? null,
    provider_id: m.providerId ?? null,
    acquisition_source: m.acquisitionSource,
    model_count: modelCount,
    platform_fee_cents: feeCents,
    fee_schedule_id: m.feeScheduleId,
    checkout_path: path,
    stripe_checkout_session_id: sessionId,
    stripe_payment_intent_id: paymentIntentId,
    status: "collected",
    collected_at: nowIso,
  });
  if (insErr) console.error("Failed to reconstruct platform_fee_ledger:", insErr);
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

        case "charge.refunded":
          await handleChargeRefunded(event.data.object);
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

  // Frontiers3D platform fee (Phase 3.1) rides on the connected charge as
  // an application fee. Keep saved_models.amount_cents the PROVIDER RETAIL
  // portion by subtracting the platform fee from the gross amount_total.
  // Sessions created before Phase 3.1 carry no feeCents metadata and no
  // fee line item, so they fall back to amount_total (retail-only) — no
  // behavior change for in-flight legacy checkouts.
  const amountTotal = session.amount_total || 0;
  const feeCents = parseInt(session.metadata?.feeCents ?? "", 10);
  const retailCents = Number.isFinite(feeCents)
    ? Math.max(0, amountTotal - feeCents)
    : amountTotal;

  const { error: modelError } = await supabase
    .from("saved_models")
    .update({ status: "paid", is_released: true, amount_cents: retailCents })
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

  // Settle the platform-fee ledger (only when this checkout carried a fee).
  if (Number.isFinite(feeCents)) {
    await settlePlatformFeeLedger(session, "provider_connected");
  }

  console.log(`Connect payment: model=${modelId}, provider=${providerId}, client=${clientId}, gross=${amountTotal}, retail=${retailCents}, fee=${Number.isFinite(feeCents) ? feeCents : "n/a"}`);
}

// ── Platform-direct fee checkout (Frontiers3D as merchant of record) ─
// Provider waived their retail fee; the client paid only the mandatory
// platform fee directly to the platform account. Release the model and
// settle the ledger. saved_models.amount_cents stays 0 — the provider
// earned nothing; the platform fee lives in platform_fee_ledger.
async function handlePlatformFeeCheckout(session: any) {
  console.log("Platform-direct fee checkout completed:", session.id);

  const modelId = session.metadata?.modelId;
  const providerId = session.metadata?.providerId;
  const clientId = session.metadata?.clientId;

  if (!modelId) {
    console.error("No modelId in platform-direct checkout session metadata");
    return;
  }

  const { error: modelError } = await supabase
    .from("saved_models")
    .update({ status: "paid", is_released: true, amount_cents: 0 })
    .eq("id", modelId);

  if (modelError) {
    console.error("Failed to release saved_model (platform_direct):", modelError);
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

  await settlePlatformFeeLedger(session, "platform_direct");

  console.log(`Platform-direct fee collected: model=${modelId}, provider=${providerId}, client=${clientId}, amount=${session.amount_total}`);
}

// ── Refund → reverse / flag the platform-fee ledger row ────────────
// v1 refund policy (see BACKEND_ACTIVATION_TRACK_A3.md "Refund handling
// (v1 policy)"). `charge.refunded` fires for BOTH full and partial
// refunds, and — critically — a customer charge refund does NOT
// automatically reverse a Connect `application_fee_amount`. So we only
// mark the ledger row `refunded` when we can be CERTAIN the platform fee
// itself came back; otherwise we leave it `collected` and flag it for
// manual review. Matches on the PaymentIntent id (stable across Connect
// and platform charges). No-op for non-fee charges (e.g. tier purchases).
async function handleChargeRefunded(charge: any) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id ?? null;
  if (!paymentIntentId) {
    console.log("charge.refunded without payment_intent — skipping ledger reversal");
    return;
  }

  // Load the platform-fee ledger row(s) for this charge. We need
  // checkout_path to apply the policy. No row = a non-fee charge.
  const { data: rows, error: selErr } = await supabase
    .from("platform_fee_ledger")
    .select("id, checkout_path, platform_fee_cents")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .neq("status", "refunded");

  if (selErr) {
    console.error("Failed to load platform_fee_ledger for refund:", selErr);
    throw selErr;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log(`charge.refunded: no platform_fee_ledger row for pi=${paymentIntentId} (non-fee charge)`);
    return;
  }

  // Full vs partial. Stripe sets charge.refunded=true ONLY on a full
  // refund; partial refunds leave it false with amount_refunded < amount.
  const amount = Number(charge.amount ?? 0);
  const amountRefunded = Number(charge.amount_refunded ?? 0);
  const isFullRefund =
    charge.refunded === true || (amount > 0 && amountRefunded >= amount);
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    // Mark `refunded` ONLY when the platform fee provably came back:
    //   platform_direct + full refund → the fee WAS the entire charge.
    // Conservative review (left `collected`, flagged in notes) otherwise:
    //   * any PARTIAL refund — v1 does not prorate per-fee, and
    //   * any provider_connected refund — the fee rode as an
    //     application_fee_amount that Stripe does NOT auto-reverse on a
    //     charge refund, so a customer refund does not imply the platform
    //     fee was returned. Exact application-fee refund accounting is a
    //     deferred follow-up; until then these need a human to confirm.
    const certainFeeReturned =
      isFullRefund && row.checkout_path === "platform_direct";

    if (certainFeeReturned) {
      const { error } = await supabase
        .from("platform_fee_ledger")
        .update({ status: "refunded", refunded_at: nowIso })
        .eq("id", row.id)
        .neq("status", "refunded");
      if (error) {
        console.error("Failed to mark platform_fee_ledger refunded:", error);
        throw error;
      }
      console.log(`Platform fee refunded (platform_direct, full): pi=${paymentIntentId}, ledger=${row.id}`);
    } else {
      const reason = !isFullRefund
        ? `partial_refund_pending_review: charge refunded ${amountRefunded} of ${amount} cents; platform fee (${row.platform_fee_cents}) not auto-reversed — manual review`
        : `full_refund_pending_review: ${row.checkout_path} application fee not auto-reversed by charge refund — verify application_fee refund before marking refunded`;
      const { error } = await supabase
        .from("platform_fee_ledger")
        .update({ notes: reason })
        .eq("id", row.id);
      if (error) {
        console.error("Failed to flag platform_fee_ledger for refund review:", error);
        throw error;
      }
      console.log(`Platform fee refund flagged for review: pi=${paymentIntentId}, ledger=${row.id}, path=${row.checkout_path}, full=${isFullRefund}`);
    }
  }
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

  // Frontiers3D platform-direct fee checkout (Phase 3.1). Distinct from
  // tier purchases below; identified by metadata.path. Handle and return
  // before the tier-purchase logic so the two never collide.
  if (session.metadata?.path === "platform_direct") {
    await handlePlatformFeeCheckout(session);
    return;
  }

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

  // Strict priceId → product/tier mapping. Anything unknown is logged and
  // skipped so we never silently default Pro entitlements on misconfigured
  // prices. Recurring lookup keys (starter_annual / pro_annual) are
  // included because the live Stripe prices for those keys are actually
  // one-time, so they arrive here via mode=payment instead of through
  // the subscription handlers.
  let resolvedProductId: 'starter_tier' | 'pro_tier' | 'pro_upgrade' | null = null;
  let newTier: 'starter' | 'pro' | null = null;
  if (priceId === 'starter_onetime' || priceId === 'starter_annual') {
    resolvedProductId = 'starter_tier';
    newTier = 'starter';
  } else if (priceId === 'pro_onetime' || priceId === 'pro_annual') {
    resolvedProductId = 'pro_tier';
    newTier = 'pro';
  } else if (priceId === 'pro_upgrade_onetime') {
    resolvedProductId = 'pro_upgrade';
    newTier = 'pro';
  }

  if (!resolvedProductId || !newTier) {
    console.error(`Unknown priceId on one-time checkout (skipping entitlement): ${priceId}`);
    return;
  }

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

  // Upsert branding_settings so the tier denormalization stays in sync
  // even when no row existed before checkout.
  const { error: bsErr } = await supabase
    .from("branding_settings")
    .upsert(
      { provider_id: userId, tier: newTier },
      { onConflict: "provider_id" }
    );
  if (bsErr) console.error("branding_settings upsert failed:", bsErr);

  // Upsert the license — this is the source of truth used by
  // get_license_info / useLusLicense for tier gating. One-time purchases
  // are lifetime (no expiry, no Stripe subscription id).
  const { error: licErr } = await supabase.from("licenses").upsert(
    {
      user_id: userId,
      tier: newTier,
      license_status: 'active',
      license_expiry: null,
      stripe_subscription_id: null,
    },
    { onConflict: "user_id" }
  );
  if (licErr) console.error("licenses upsert failed:", licErr);

  // Mirror handleSubscriptionCreated: ensure the user has the provider role.
  await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role: "provider" }, { onConflict: "user_id,role" });

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
