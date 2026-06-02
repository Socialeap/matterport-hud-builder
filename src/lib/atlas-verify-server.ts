/**
 * Atlas verification (server-only).
 *
 * Verification-first Atlas submission: a published Frontiers3D package carries
 * a root `atlas-manifest.json` holding an opaque `atlas_v1` token (issued at
 * export — see `presentation-token-server.ts`). This module fetches that
 * manifest from the live URL under SSRF protections, verifies the token
 * against `presentation_tokens` (hash-only at rest), confirms the token's
 * saved_model belongs to the caller, and only then activates an `atlas_entries`
 * row via the service-role client.
 *
 * IMPORTANT: server-only. Imports `node:dns`, the service-role Supabase client,
 * and reads `PRESENTATION_TOKEN_SECRET`. NEVER import from browser code — it is
 * reached exclusively via dynamic import inside a server-fn handler, so Vite
 * keeps it out of the client bundle.
 */
import { lookup } from "node:dns/promises";
import { createClient } from "@supabase/supabase-js";

import {
  bytesToHex,
  canonicalisePayload,
  hmacSha256,
  sha256,
  type PresentationTokenPayload,
} from "./presentation-token-canonical";
import type { AtlasEntry, AtlasVerifyState } from "./atlas-demo-data";

const MANIFEST_FILENAME = "atlas-manifest.json";
const FETCH_TIMEOUT_MS = 5000;
const MAX_MANIFEST_BYTES = 256 * 1024; // 256 KB — a token manifest is tiny.
const MAX_REDIRECTS = 3;

// ── Service / secret ─────────────────────────────────────────────────────────

function getSecret(): string {
  const v = process.env.PRESENTATION_TOKEN_SECRET;
  if (!v || v.length < 32) {
    throw new Error(
      "atlas-verify: PRESENTATION_TOKEN_SECRET must be set (>= 32 chars)",
    );
  }
  return v;
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "atlas-verify: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as unknown as any;
}

// ── SSRF guard ───────────────────────────────────────────────────────────────

/** True for loopback / private / link-local / reserved / metadata addresses. */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.trim().toLowerCase();

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — classify the embedded v4.
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIp(mapped[1]);

  if (addr.includes(":")) {
    // IPv6
    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    const head = addr.split(":")[0] ?? "";
    if (head.startsWith("fc") || head.startsWith("fd")) return true; // fc00::/7 ULA
    if (head.startsWith("fe8") || head.startsWith("fe9") || head.startsWith("fea") || head.startsWith("feb")) return true; // fe80::/10 link-local
    if (head.startsWith("ff")) return true; // multicast
    if (head.startsWith("fec")) return true; // deprecated site-local
    return false;
  }

  // IPv4
  const parts = addr.split(".").map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → block
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (test-net)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a === 198 && b === 51) return true; // 198.51.100/24 test-net
  if (a === 203 && b === 0) return true; // 203.0.113/24 test-net
  if (a >= 224) return true; // 224/4 multicast + 240/4 reserved + 255.255.255.255
  return false;
}

/**
 * Validate a URL for outbound fetch: https only, no embedded credentials,
 * default/443 port, and every resolved IP must be public. Throws on any
 * violation (caller maps the throw to `fetch_failed`).
 */
async function assertSafeUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("invalid url");
  }
  if (u.protocol !== "https:") throw new Error("non-https url blocked");
  if (u.username || u.password) throw new Error("credentials in url blocked");
  if (u.port && u.port !== "443") throw new Error("non-standard port blocked");

  const resolved = await lookup(u.hostname, { all: true });
  if (!resolved.length) throw new Error("dns resolution failed");
  for (const r of resolved) {
    if (isBlockedIp(r.address)) throw new Error(`blocked address ${r.address}`);
  }
  return u;
}

/** Derive `${baseDir}/atlas-manifest.json` from the pasted live URL. */
export function resolveManifestUrl(base: string): string {
  const u = new URL(base);
  let path = u.pathname;
  if (path.endsWith("/")) {
    path += MANIFEST_FILENAME;
  } else if (/\/[^/]*\.[^/]+$/.test(path)) {
    // ends in a filename (e.g. /tour/index.html) → swap to sibling manifest
    path = path.replace(/\/[^/]*$/, `/${MANIFEST_FILENAME}`);
  } else {
    path += `/${MANIFEST_FILENAME}`;
  }
  u.pathname = path;
  u.search = "";
  u.hash = "";
  return u.toString();
}

type FetchManifestResult =
  | { state: "ok"; manifest: unknown }
  | { state: "missing_manifest" }
  | { state: "fetch_failed"; detail?: string };

/** Read a response body with a hard byte cap (defends against huge payloads). */
async function readCapped(res: Response): Promise<string | null> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len && len > MAX_MANIFEST_BYTES) return null;
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_MANIFEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * SSRF-safe GET of the manifest. Follows up to MAX_REDIRECTS hops, re-validating
 * each target. JSON-only; never executes anything. 404 → missing_manifest.
 */
export async function fetchAtlasManifest(base: string): Promise<FetchManifestResult> {
  let target: string;
  try {
    target = resolveManifestUrl(base);
  } catch {
    return { state: "fetch_failed", detail: "invalid url" };
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let safe: URL;
    try {
      safe = await assertSafeUrl(target);
    } catch (err) {
      return { state: "fetch_failed", detail: err instanceof Error ? err.message : "blocked" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(safe.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "application/json,*/*" },
      });
    } catch (err) {
      clearTimeout(timer);
      return { state: "fetch_failed", detail: err instanceof Error ? err.message : "network error" };
    }
    clearTimeout(timer);

    // Manual redirect handling with per-hop SSRF re-validation.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { state: "fetch_failed", detail: "redirect without location" };
      try {
        target = new URL(loc, safe).toString();
      } catch {
        return { state: "fetch_failed", detail: "bad redirect target" };
      }
      continue;
    }

    if (res.status === 404) return { state: "missing_manifest" };
    if (!res.ok) return { state: "fetch_failed", detail: `http ${res.status}` };

    const text = await readCapped(res);
    if (text == null) return { state: "fetch_failed", detail: "response too large" };
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      return { state: "missing_manifest" }; // not a valid manifest
    }
    return { state: "ok", manifest };
  }
  return { state: "fetch_failed", detail: "too many redirects" };
}

/** Pull the opaque token out of a manifest, validating the expected shape. */
export function extractManifestToken(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object") return null;
  const m = manifest as Record<string, unknown>;
  if (m.service !== "frontiers3d-atlas") return null;
  return typeof m.token === "string" && m.token.length > 0 ? m.token : null;
}

// ── Token verification ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64UrlDecode(s: string): Uint8Array {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4 !== 0) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

type TokenVerifyResult =
  | { ok: true; savedModelId: string }
  | { ok: false };

/**
 * Verify an `atlas_v1` token: split `id.signature`, recompute the HMAC over the
 * stored canonical payload, constant-time compare the signature, match the
 * stored sha256(signature), require scope `atlas_v1`, and reject revoked rows.
 */
export async function verifyAtlasToken(token: string): Promise<TokenVerifyResult> {
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === token.length - 1) return { ok: false };
  const id = token.slice(0, lastDot);
  const sigB64 = token.slice(lastDot + 1);
  if (!UUID_RE.test(id)) return { ok: false };

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(sigB64);
  } catch {
    return { ok: false };
  }

  const service = getServiceClient();
  const secret = getSecret();
  const { data: row } = await service
    .from("presentation_tokens")
    .select("id, saved_model_id, token_hash, payload, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (!row || row.revoked_at) return { ok: false };

  const payload = row.payload as PresentationTokenPayload | null;
  if (!payload || typeof payload !== "object" || !payload.saved_model_id) return { ok: false };
  if (payload.scope !== "atlas_v1") return { ok: false };

  const recomputed = await hmacSha256(secret, canonicalisePayload(payload));
  if (!constantTimeEqual(recomputed, signatureBytes)) return { ok: false };
  const recomputedHash = bytesToHex(await sha256(signatureBytes));
  if (recomputedHash !== row.token_hash) return { ok: false };

  return { ok: true, savedModelId: row.saved_model_id as string };
}

/**
 * Run the full verification pipeline for a pasted live URL — fetch the manifest
 * (SSRF-safe), verify the token, and confirm ownership — WITHOUT creating any
 * row. Shared by the verify-only pre-check and the final verify-and-submit, so
 * the final submit always re-verifies server-side (the client can't bypass it).
 * Returns the terminal state and, on success, the owning saved_model id.
 */
export async function runAtlasVerification(
  presentationUrl: string,
  userId: string,
): Promise<{ state: AtlasVerifyState; savedModelId: string | null }> {
  const fetched = await fetchAtlasManifest(presentationUrl);
  if (fetched.state === "fetch_failed") return { state: "fetch_failed", savedModelId: null };
  if (fetched.state === "missing_manifest") return { state: "missing_manifest", savedModelId: null };

  const token = extractManifestToken(fetched.manifest);
  if (!token) return { state: "missing_manifest", savedModelId: null };

  const tokenResult = await verifyAtlasToken(token);
  if (!tokenResult.ok) return { state: "token_mismatch", savedModelId: null };

  const owns = await userOwnsModel(tokenResult.savedModelId, userId);
  if (!owns) return { state: "unverified", savedModelId: null };

  return { state: "verified", savedModelId: tokenResult.savedModelId };
}

/** The verified token's saved_model must belong to the caller (client or provider). */
export async function userOwnsModel(savedModelId: string, userId: string): Promise<boolean> {
  const service = getServiceClient();
  const { data } = await service
    .from("saved_models")
    .select("id")
    .eq("id", savedModelId)
    .or(`client_id.eq.${userId},provider_id.eq.${userId}`)
    .maybeSingle();
  return Boolean(data);
}

// ── Activation (service-role write; bypasses owner-can't-self-activate RLS) ───

export interface VerifiedEntryFields {
  title: string;
  summary: string | null;
  category: string;
  tags: string[];
  hero_image_url: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Upsert the verified listing as `status='active'`. Keyed by
 * (owner_user_id, saved_model_id) for client_submitted rows so re-verifying
 * updates in place. Written with the service-role client because owners cannot
 * self-activate under RLS (they may only insert `pending_review`).
 */
export async function activateVerifiedEntry(args: {
  ownerUserId: string;
  savedModelId: string;
  presentationUrl: string;
  fields: VerifiedEntryFields;
}): Promise<AtlasEntry> {
  const service = getServiceClient();
  const nowIso = new Date().toISOString();
  const payload = {
    kind: "client_submitted" as const,
    status: "active" as const,
    owner_user_id: args.ownerUserId,
    saved_model_id: args.savedModelId,
    presentation_url: args.presentationUrl,
    submitted_at: nowIso,
    reviewed_at: nowIso,
    reviewed_by: null,
    rejection_reason: null,
    ...args.fields,
  };

  const { data: existing } = await service
    .from("atlas_entries")
    .select("id")
    .eq("owner_user_id", args.ownerUserId)
    .eq("kind", "client_submitted")
    .eq("saved_model_id", args.savedModelId)
    .maybeSingle();

  if (existing) {
    const { data: updated, error } = await service
      .from("atlas_entries")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return updated as AtlasEntry;
  }

  const { data: inserted, error } = await service
    .from("atlas_entries")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return inserted as AtlasEntry;
}
