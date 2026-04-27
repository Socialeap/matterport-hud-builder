// validate-byok
// ─────────────
// Authenticated edge function that:
//   1. Accepts a Gemini API key from the dashboard UI (POST body).
//   2. Probes the key against Gemini's listModels endpoint.
//   3. On success: encrypts the key under BYOK_MASTER_KEY,
//      upserts provider_byok_keys, sets active=true, and flips
//      ask_quota_counters.byok_active for every (saved_model,
//      property) belonging to this provider's MSP.
//   4. On failure: stores the failure reason on the row but DOES
//      NOT mark active.
//
// The plaintext key is never persisted unencrypted, never echoed
// back to the browser, and never written to logs.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

import {
  encryptKey,
  fingerprintFor,
  probeGeminiKey,
} from "../_shared/byok-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

interface ValidateBody {
  api_key?: string;
  vendor?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Convert Uint8Array -> bytea hex literal that Postgres accepts via the
// JSON->bytea cast performed by supabase-js.
function bytesToHex(bytes: Uint8Array): string {
  let s = "\\x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST" && req.method !== "DELETE") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const userId = userData.user.id;
  const service = createClient(SUPABASE_URL, SERVICE_KEY);

  // DELETE removes the BYOK key and reverts byok_active to false on
  // every quota counter row for the provider.
  if (req.method === "DELETE") {
    await service
      .from("provider_byok_keys")
      .delete()
      .eq("provider_id", userId)
      .eq("vendor", "gemini");
    await service.rpc("set_provider_byok_active", {
      p_provider_id: userId,
      p_active: false,
    });
    return jsonResponse({ ok: true, deleted: true });
  }

  let body: ValidateBody;
  try {
    body = (await req.json()) as ValidateBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const apiKey = (body.api_key ?? "").trim();
  const vendor = (body.vendor ?? "gemini").trim();
  if (!apiKey) return jsonResponse({ error: "missing_api_key" }, 400);
  if (vendor !== "gemini") {
    return jsonResponse({ error: "unsupported_vendor", vendor }, 400);
  }
  // Cheap shape check before we burn a probe call.
  if (apiKey.length < 20 || apiKey.length > 256) {
    return jsonResponse({ error: "invalid_key_shape" }, 400);
  }

  // Probe the key against Gemini.
  const probe = await probeGeminiKey(apiKey);
  if (!probe.ok) {
    // Persist the failure reason so the dashboard can surface it.
    await service
      .from("provider_byok_keys")
      .upsert(
        {
          provider_id: userId,
          vendor: "gemini",
          ciphertext: bytesToHex(new Uint8Array(0)) as unknown as never,
          iv: bytesToHex(crypto.getRandomValues(new Uint8Array(12))) as unknown as never,
          fingerprint: fingerprintFor(apiKey),
          active: false,
          validated_at: null,
          validation_error: probe.reason,
        },
        { onConflict: "provider_id,vendor" },
      );
    return jsonResponse(
      { ok: false, valid: false, reason: probe.reason },
      400,
    );
  }

  // Encrypt and persist.
  let encrypted;
  try {
    encrypted = await encryptKey(apiKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[validate-byok] encrypt failed:", msg);
    return jsonResponse({ error: "encrypt_failed", detail: msg }, 500);
  }

  const { error: upErr } = await service
    .from("provider_byok_keys")
    .upsert(
      {
        provider_id: userId,
        vendor: "gemini",
        ciphertext: bytesToHex(encrypted.ciphertext) as unknown as never,
        iv: bytesToHex(encrypted.iv) as unknown as never,
        fingerprint: fingerprintFor(apiKey),
        active: true,
        validated_at: new Date().toISOString(),
        validation_error: null,
        rotated_at: new Date().toISOString(),
      },
      { onConflict: "provider_id,vendor" },
    );
  if (upErr) {
    console.error("[validate-byok] upsert failed:", upErr);
    return jsonResponse({ error: "persist_failed", detail: upErr.message }, 500);
  }

  // Flip byok_active for every (saved_model, property) under this
  // provider so synthesize-answer immediately stops decrementing the
  // TM subsidy. Per Q7: no re-export needed.
  const { error: rpcErr } = await service.rpc("set_provider_byok_active", {
    p_provider_id: userId,
    p_active: true,
  });
  if (rpcErr) {
    console.warn("[validate-byok] set_provider_byok_active warned:", rpcErr);
  }

  return jsonResponse({
    ok: true,
    valid: true,
    fingerprint: fingerprintFor(apiKey),
    active: true,
  });
});
