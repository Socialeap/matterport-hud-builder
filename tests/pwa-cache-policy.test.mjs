#!/usr/bin/env node

// PR-PWA-1: service-worker cache policy. Loads the SAME pure classifier the
// SW uses (public/sw-cache-policy.js) by evaluating it against a fake
// `self`, then asserts the allow/deny matrix — proving no auth / API /
// cross-origin / personalized response is ever cached, navigations are
// network-first w/ offline fallback, and old caches are cleaned.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");

// Evaluate the real policy file against a fake scope (same pattern the repo
// uses for browser-safe .mjs). No drift: SW + tests share this file.
function loadPolicy() {
  const src = read("public", "sw-cache-policy.js");
  const scope = {};
  // eslint-disable-next-line no-new-func
  new Function("self", src + "\n;return self;")(scope);
  return scope;
}
const policy = loadPolicy();
const classify = policy.f3dClassifyRequest;

const GET = (pathname, extra) =>
  classify(Object.assign({ method: "GET", sameOrigin: true, pathname }, extra || {}));

// ── 1. Allowlist: only same-origin static app/PWA assets are cached ──────
test("hashed Vite assets and PWA assets classify as cacheable", () => {
  assert.equal(GET("/assets/index-abc123.js"), "asset");
  assert.equal(GET("/assets/main-deadbeef.css"), "asset");
  assert.equal(GET("/icons/icon-512.png"), "asset");
  assert.equal(GET("/manifest.webmanifest"), "asset");
  assert.equal(GET("/offline.html"), "asset");
  assert.equal(GET("/favicon.png"), "asset");
});

// ── 2. Denylist: auth / admin / dashboards / API / email / builder ───────
test("authenticated, API, and personalized same-origin paths are NEVER cached", () => {
  for (const p of [
    "/api/anything",
    "/admin",
    "/admin/atlas",
    "/dashboard",
    "/dashboard/account",
    "/agent-dashboard",
    "/login",
    "/forgot-password",
    "/email/receipt",
    "/p/some-slug",
    "/_serverFn/x",
  ]) {
    assert.equal(GET(p), "passthrough", `${p} must not be cached`);
  }
});

// ── 3. Navigations: network-first + offline fallback, HTML never stored ──
test("same-origin navigations classify as network-first navigation", () => {
  assert.equal(GET("/atlas", { isNavigate: true }), "navigation");
  assert.equal(GET("/", { isNavigate: true }), "navigation");
  // A navigation to an allowlisted-looking path is STILL a navigation
  // (so its HTML is never written to the asset cache).
  assert.equal(GET("/assets/x", { isNavigate: true }), "navigation");
});

// ── 4. Cross-origin + non-GET are passthrough (never intercepted) ────────
test("cross-origin requests are never cached (Matterport, Netlify, tiles, Stripe, Supabase)", () => {
  for (const pathname of ["/show/", "/tiles/1/2/3.png", "/v1/charges", "/rest/v1/atlas"]) {
    assert.equal(
      classify({ method: "GET", sameOrigin: false, pathname }),
      "passthrough",
      `cross-origin ${pathname} must passthrough`,
    );
  }
});

test("non-GET requests are always passthrough", () => {
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    assert.equal(
      classify({ method, sameOrigin: true, pathname: "/assets/x.js" }),
      "passthrough",
      `${method} must passthrough even for an allowlisted path`,
    );
  }
});

test("classifier fails safe on garbage input", () => {
  assert.equal(classify(undefined), "passthrough");
  assert.equal(classify({}), "passthrough");
  assert.equal(classify({ method: "GET", sameOrigin: true }), "passthrough");
});

// ── 5. SW itself: versioned caches, old-cache cleanup, no non-GET, offline ──
test("service worker versions caches and deletes obsolete ones on activate", () => {
  const sw = read("public", "sw.js");
  assert.ok(/CACHE_VERSION\s*=/.test(sw), "cache version constant present");
  assert.ok(sw.includes("CURRENT_CACHES.indexOf(name) === -1"), "non-current caches deleted");
  assert.ok(sw.includes("caches.delete(name)"), "delete obsolete caches");
  assert.ok(sw.includes("clients.claim()"), "claims clients on activate");
});

test("service worker imports the shared policy and never stores navigation HTML", () => {
  const sw = read("public", "sw.js");
  assert.ok(sw.includes(`importScripts("/sw-cache-policy.js")`), "shares the policy file");
  assert.ok(sw.includes("f3dClassifyRequest"), "uses the shared classifier");
  // Offline fallback exists and is precached.
  assert.ok(sw.includes("/offline.html"), "offline fallback referenced");
  assert.ok(sw.includes("PRECACHE_URLS"), "precache list present");
  // Update safety: waits for explicit SKIP_WAITING (no silent takeover).
  assert.ok(sw.includes("SKIP_WAITING") && sw.includes("self.skipWaiting()"), "gated update");
  assert.ok(!sw.includes("self.skipWaiting();\n}"), "does not skipWaiting on install unconditionally");
});

test("the SW navigation handler returns HTML to the page without caching it", () => {
  const sw = read("public", "sw.js");
  // handleNavigation does fetch().catch(offline) — no cache.put on the
  // navigation path (only handleAsset writes to the cache).
  const navFn = sw.slice(sw.indexOf("function handleNavigation"), sw.indexOf("function handleAsset"));
  assert.ok(navFn.includes("fetch(event.request)"), "navigation is network-first");
  assert.ok(!navFn.includes("cache.put"), "navigation HTML is never stored");
});
