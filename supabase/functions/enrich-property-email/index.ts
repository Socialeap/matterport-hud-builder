import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================================
// Frontiers3D — B5: Website Contact Enrichment (public email discovery)
//
// Operator-only, COST-FREE (no paid APIs / vendor secrets) enrichment for
// ONE property at a time. Reads property_contacts.website_url (captured by
// Google Places details), fetches the homepage + a small bounded set of
// same-domain likely-contact pages, extracts PUBLIC business emails
// (mailto: links, visible text, common obfuscations like "name [at] domain
// [dot] com"), prefers the business domain, filters low-quality addresses,
// writes the best email to property_contacts.email, and records full
// provenance in property_enrichment.signals.
//
// It does NOT promote to beacon, send outreach, batch-scrape, use cron,
// touch billing/Stripe/Track A, or B4. One explicit admin call per property.
//
// SAFETY: admin/service-role only; same-domain only; bounded pages / bytes /
// timeout; one level deep (homepage -> contact pages, no recursion); visited
// set (no loops); SSRF guard (no localhost/private/metadata hosts).
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ── Hard limits ─────────────────────────────────────────────────────
const MAX_PAGES = 5;            // homepage + up to 4 contact pages
const MAX_CONTACT_PAGES = 4;
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 600_000;      // per page (streamed cap)
const UA = "Frontiers3D-MapOracle-Enrichment/1.0 (+contact discovery; respects robots intent)";

const CONTACT_HINT = /\/(contact|contact-us|contactus|about|about-us|aboutus|team|staff|people|connect|reach|company|get-in-touch|support|info|location|locations)\b/i;
const LOWQ = /^(no-?reply|donotreply|do-?not-?reply|abuse|postmaster|hostmaster|privacy|legal|dmca|compliance|unsubscribe|mailer-daemon|bounce)([._\-+]|@)/i;
const JUNK_DOMAINS = new Set([
  "example.com","example.org","example.net","sentry.io","wixpress.com","wix.com",
  "squarespace.com","godaddy.com","domain.com","email.com","yourdomain.com",
  "yourcompany.com","company.com","name.com","sentry-cdn.com","schema.org","w3.org",
]);
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|mjs|json|xml|ico|woff2?|ttf|pdf)$/i;
const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g;

const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const apex = (host: string): string => {
  const p = host.toLowerCase().replace(/^www\./, "").split(".");
  return p.length <= 2 ? p.join(".") : p.slice(-2).join(".");
};

function hostIsPublic(host: string): boolean {
  const h = host.toLowerCase();
  if (!h || h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return false;
  if (h === "169.254.169.254" || h === "metadata.google.internal") return false;
  if (h === "::1" || h === "[::1]") return false;
  return true;
}

async function fetchTextBounded(url: string): Promise<{ ok: boolean; text: string; finalUrl: string; note?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,*/*" },
    });
    const finalUrl = res.url || url;
    if (!res.ok) { try { await res.body?.cancel(); } catch { /* ignore */ } return { ok: false, text: "", finalUrl, note: `http ${res.status}` }; }
    const ct = res.headers.get("content-type") || "";
    if (!/text\/html|text\/plain|application\/xhtml/i.test(ct)) { try { await res.body?.cancel(); } catch { /* ignore */ } return { ok: false, text: "", finalUrl, note: "non-html" }; }
    const reader = res.body?.getReader();
    if (!reader) return { ok: true, text: (await res.text()).slice(0, MAX_BYTES), finalUrl };
    const chunks: Uint8Array[] = []; let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const buf = new Uint8Array(Math.min(received, MAX_BYTES)); let off = 0;
    for (const c of chunks) { if (off >= buf.length) break; buf.set(c.subarray(0, buf.length - off), off); off += c.length; }
    return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(buf), finalUrl };
  } catch (e) {
    return { ok: false, text: "", finalUrl: url, note: e instanceof Error ? e.message : String(e) };
  } finally { clearTimeout(timer); }
}

interface Cand { email: string; method: "mailto" | "text" | "deobfuscated"; source_url: string; }

function extractEmails(html: string, sourceUrl: string): Cand[] {
  const out: Cand[] = [];
  const push = (raw: string, method: Cand["method"]) => {
    const e = raw.trim().toLowerCase().replace(/^mailto:/, "").split("?")[0];
    if (e) out.push({ email: e, method, source_url: sourceUrl });
  };
  // mailto:
  for (const m of html.matchAll(/mailto:([^"'?>\s)]+)/gi)) push(decodeURIComponent(m[1]), "mailto");
  // visible text
  for (const m of html.matchAll(EMAIL_RE)) push(m[0], "text");
  // common obfuscations -> normalize then re-extract
  const deob = html
    .replace(/\s*(?:\[at\]|\(at\)|\{at\}|&#64;|\sat\s)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\}|\sdot\s)\s*/gi, ".");
  for (const m of deob.matchAll(EMAIL_RE)) push(m[0], "deobfuscated");
  return out;
}

function isJunk(email: string): boolean {
  const at = email.indexOf("@");
  if (at < 1) return true;
  const dom = email.slice(at + 1);
  if (!dom.includes(".") || dom.length > 100 || email.length > 120) return true;
  if (email.includes("..") || email.startsWith(".")) return true;
  if (ASSET_EXT.test(email)) return true;
  if (JUNK_DOMAINS.has(dom)) return true;
  if (/^(you|your|sample|placeholder|firstname|lastname)@/.test(email)) return true;
  return false;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // Admin / service-role only.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Unauthorized" });
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(401, { error: "Unauthorized" });
  const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (isAdmin !== true) return json(403, { error: "Forbidden — enrichment is operator (admin) only." });

  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const propertyId: string | undefined = typeof body.property_id === "string" ? body.property_id : undefined;
  const dryRun = body.dryRun === true;
  const overwrite = body.overwrite === true;
  if (!propertyId) return json(400, { error: "Missing 'property_id'" });

  // Read the property's website + existing email.
  const { data: contact, error: cErr } = await supabaseAdmin
    .from("property_contacts").select("property_id, website_url, email").eq("property_id", propertyId).maybeSingle();
  if (cErr) return json(500, { error: "Failed to read property_contacts", detail: cErr.message });
  const websiteUrl: string | null = contact?.website_url ?? null;
  if (!websiteUrl) return json(200, { property_id: propertyId, enriched: false, reason: "no website_url to enrich" });

  // Normalize + SSRF guard.
  let home: URL;
  try { home = new URL(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`); }
  catch { return json(400, { error: `Invalid website_url: ${websiteUrl}` }); }
  if (!/^https?:$/.test(home.protocol) || !hostIsPublic(home.hostname)) {
    return json(400, { error: "website_url host is not a public http(s) host", code: "blocked_host" });
  }
  const siteApex = apex(home.hostname);

  // ── Fetch homepage, discover same-domain contact pages, fetch them ──
  const visited = new Set<string>();
  const pagesFetched: string[] = [];
  const cands: Cand[] = [];

  const homeRes = await fetchTextBounded(home.toString());
  visited.add(home.toString()); pagesFetched.push(home.toString());
  if (homeRes.ok) {
    cands.push(...extractEmails(homeRes.text, homeRes.finalUrl));
    // discover same-site contact links (one level deep, bounded)
    const links: string[] = [];
    for (const m of homeRes.text.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
      if (links.length >= 40) break;
      try {
        const u = new URL(m[1], home);
        if (!/^https?:$/.test(u.protocol)) continue;
        if (apex(u.hostname) !== siteApex || !hostIsPublic(u.hostname)) continue;
        u.hash = "";
        if (CONTACT_HINT.test(u.pathname) && !visited.has(u.toString())) links.push(u.toString());
      } catch { /* ignore bad href */ }
    }
    const uniqueLinks = [...new Set(links)].slice(0, MAX_CONTACT_PAGES);
    for (const link of uniqueLinks) {
      if (pagesFetched.length >= MAX_PAGES) break;
      if (visited.has(link)) continue;
      visited.add(link); pagesFetched.push(link);
      const r = await fetchTextBounded(link);
      if (r.ok) cands.push(...extractEmails(r.text, r.finalUrl));
    }
  }

  // ── Dedupe + filter + score ─────────────────────────────────────────
  const seen = new Map<string, Cand>();
  for (const c of cands) if (!seen.has(c.email)) seen.set(c.email, c);
  const scored = [...seen.values()]
    .filter((c) => !isJunk(c.email))
    .map((c) => {
      const dom = c.email.slice(c.email.indexOf("@") + 1);
      const domainMatch = apex(dom) === siteApex;
      const lowQuality = LOWQ.test(c.email);
      const onContact = CONTACT_HINT.test(new URL(c.source_url).pathname);
      let score = 0;
      if (domainMatch) score += 3;
      if (c.method === "mailto") score += 2;
      if (onContact) score += 1;
      if (lowQuality) score -= 4;
      return { email: c.email, method: c.method, source_url: c.source_url, domain_match: domainMatch, low_quality: lowQuality, score };
    })
    .sort((a, b) => b.score - a.score || (a.low_quality ? 1 : 0) - (b.low_quality ? 1 : 0));

  const best = scored[0] ?? null;
  const confidence = !best ? "none" : best.score >= 4 ? "high" : best.score >= 2 ? "medium" : "low";

  // ── Provenance signal ───────────────────────────────────────────────
  const enrichment = {
    version: "v1",
    fetched_at: new Date().toISOString(),
    website_url: websiteUrl,
    business_domain: siteApex,
    pages_fetched: pagesFetched,
    candidates: scored,
    chosen_email: best?.email ?? null,
    chosen_confidence: confidence,
    written: false as boolean,
    dry_run: dryRun,
    notes: best ? undefined : "no public email discovered",
  };

  if (dryRun) {
    return json(200, { property_id: propertyId, enriched: false, dryRun: true, ...enrichment });
  }

  // ── Write best email (if empty or overwrite) + provenance ───────────
  const willWrite = !!best && (overwrite || !contact?.email);
  if (willWrite && best) {
    const { error: upErr } = await supabaseAdmin
      .from("property_contacts").upsert({ property_id: propertyId, email: best.email, updated_at: new Date().toISOString() }, { onConflict: "property_id" });
    if (upErr) return json(500, { error: "Failed to write property_contacts.email", detail: upErr.message });
    enrichment.written = true;
  }

  // Merge into property_enrichment.signals (don't clobber other signal keys).
  const { data: existing } = await supabaseAdmin
    .from("property_enrichment").select("signals, domain").eq("property_id", propertyId).maybeSingle();
  const mergedSignals = { ...(existing?.signals ?? {}), email_enrichment: enrichment };
  const { error: peErr } = await supabaseAdmin.from("property_enrichment").upsert({
    property_id: propertyId,
    signals: mergedSignals,
    domain: existing?.domain ?? siteApex,
    enrichment_source: "website_email_enrichment",
    enriched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "property_id" });
  if (peErr) console.error("[enrich-property-email] property_enrichment upsert failed:", peErr);

  return json(200, {
    property_id: propertyId,
    enriched: enrichment.written,
    chosen_email: best?.email ?? null,
    chosen_confidence: confidence,
    candidate_count: scored.length,
    pages_fetched: pagesFetched.length,
    wrote_email: enrichment.written,
    note: best ? (enrichment.written ? "email written" : "email found but property_contacts.email already set (pass overwrite:true to replace)") : "no public email discovered",
  });
});
