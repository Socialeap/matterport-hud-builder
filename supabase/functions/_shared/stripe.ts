import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

export type StripeEnv = 'sandbox' | 'live';

export function getConnectionApiKey(env: StripeEnv): string {
  const key = env === 'sandbox'
    ? Deno.env.get('STRIPE_SANDBOX_API_KEY')
    : Deno.env.get('STRIPE_LIVE_API_KEY');
  if (!key) throw new Error(`STRIPE_${env.toUpperCase()}_API_KEY is not configured`);
  return key;
}

import Stripe from "https://esm.sh/stripe@18.5.0";

const GATEWAY_STRIPE_BASE = 'https://connector-gateway.lovable.dev/stripe';

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!lovableApiKey) throw new Error('LOVABLE_API_KEY is not configured');

  return new Stripe(connectionApiKey, {
    httpClient: Stripe.createFetchHttpClient((url: string | URL, init?: RequestInit) => {
      const gatewayUrl = url.toString().replace('https://api.stripe.com', GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          'X-Connection-Api-Key': connectionApiKey,
          'Lovable-API-Key': lovableApiKey,
        },
      });
    }),
  });
}

export function isStripeCredentialError(error: unknown): boolean {
  const stripeError = error as { code?: string; raw?: { code?: string }; message?: string };
  const code = stripeError?.code || stripeError?.raw?.code;
  const message = stripeError?.message || "";
  return code === "api_key_expired" || message.includes("Expired API Key provided");
}

export function stripeCredentialResponse(env: StripeEnv, corsHeaders: Record<string, string>): Response {
  const label = env === "live" ? "live" : "test";
  return new Response(
    JSON.stringify({
      error: `The Stripe ${label} environment credential has expired. Reconnect Stripe in Lovable to refresh the stored ${label} key.`,
      code: "stripe_credentials_expired",
      environment: env,
    }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

export interface VerifiedStripeEvent {
  /** Raw Stripe event id, e.g. `evt_…` — used for webhook idempotency. */
  id: string;
  type: string;
  /** Stripe sets this on every event; `true` in live mode, `false` in test/sandbox. */
  livemode: boolean;
  data: { object: any };
  /** Connect events carry the connected account id at the top level. */
  account?: string;
}

export interface VerifiedWebhook {
  event: VerifiedStripeEvent;
  /** Derived purely from which webhook secret verified the signature, NEVER from caller-supplied input. */
  env: StripeEnv;
}

/**
 * Verify a Stripe webhook signature without trusting any caller-supplied
 * env hint. The pre-fix version of this function selected the webhook
 * secret based on a `?env=` query parameter — an attacker who knew (or
 * guessed) one secret could post a sandbox-signed event to `?env=live`
 * and have it routed through the live handlers.
 *
 * The post-fix contract:
 *   1. Parse the `Stripe-Signature` header once.
 *   2. Try the sandbox secret first, then the live secret. Whichever one
 *      verifies determines the resolved `env`. Constant runtime — both
 *      branches do an HMAC-SHA256 sign + compare.
 *   3. As defense-in-depth, cross-check `event.livemode` against the
 *      env we just derived. A live secret should never verify a
 *      sandbox-mode event and vice-versa; if it does, reject.
 *   4. Caller never sees `env` until verification succeeds, so URL/body
 *      tampering can't influence which secret was tried.
 */
export async function verifyWebhook(req: Request): Promise<VerifiedWebhook> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  if (!signature || !body) throw new Error("Missing signature or body");

  const sandboxSecret = Deno.env.get('PAYMENTS_SANDBOX_WEBHOOK_SECRET');
  const liveSecret = Deno.env.get('PAYMENTS_LIVE_WEBHOOK_SECRET');
  if (!sandboxSecret && !liveSecret) {
    throw new Error('No webhook secret environment variables are configured');
  }

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }

  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const tryVerify = async (secret: string): Promise<boolean> => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${body}`),
    );
    const expected = new TextDecoder().decode(encode(new Uint8Array(signed)));
    return v1Signatures.includes(expected);
  };

  let env: StripeEnv | null = null;
  if (sandboxSecret && (await tryVerify(sandboxSecret))) {
    env = 'sandbox';
  } else if (liveSecret && (await tryVerify(liveSecret))) {
    env = 'live';
  }

  if (!env) {
    throw new Error("Invalid webhook signature");
  }

  const event = JSON.parse(body) as VerifiedStripeEvent;

  // Defense-in-depth: a live webhook secret should never verify a
  // sandbox event. If it does, refuse to dispatch — that combination
  // should be impossible from a legitimate Stripe sender and indicates
  // secret/route confusion that we don't want to silently process.
  if (typeof event?.livemode === 'boolean') {
    const expectLive = env === 'live';
    if (event.livemode !== expectLive) {
      throw new Error(
        `Webhook livemode/env mismatch: env=${env} livemode=${event.livemode}`,
      );
    }
  }

  return { event, env };
}
