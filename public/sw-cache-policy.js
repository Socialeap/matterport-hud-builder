// Frontiers3D service-worker cache policy — the single source of truth for
// what the SW may cache. Loaded by sw.js via importScripts() AND evaluated
// directly by tests/pwa-cache-policy.test.mjs (one definition, no drift).
//
// Attaches a pure classifier to the given scope. In the SW, `self` is the
// ServiceWorkerGlobalScope; in tests we pass a plain object.
//
// Deliberately conservative: the ALLOW set is a tiny same-origin static
// allowlist; everything else is passthrough (network, never stored). The
// explicit DENY set is defense-in-depth so a future allowlist widening
// cannot accidentally start caching auth/API/personalized responses.
(function attachCachePolicy(scope) {
  // Same-origin path prefixes that must NEVER be cached, even if a future
  // change widens the allowlist. Auth, admin/dashboards, API + server
  // functions, transactional email, and the builder/standalone
  // presentation routes (personalized SSR HTML).
  var DENY_PREFIXES = [
    "/api",
    "/admin",
    "/dashboard",
    "/agent-dashboard",
    "/login",
    "/forgot-password",
    "/email",
    "/p/",
    "/_serverFn",
    "/__server",
  ];

  // The only same-origin GET paths we proactively cache: Vite's hashed,
  // immutable build output and the explicit PWA asset list.
  var ALLOW_PREFIXES = ["/assets/", "/icons/"];
  var ALLOW_EXACT = [
    "/manifest.webmanifest",
    "/offline.html",
    "/favicon.png",
  ];

  function hasPrefix(pathname, list) {
    for (var i = 0; i < list.length; i++) {
      if (pathname.indexOf(list[i]) === 0) return true;
    }
    return false;
  }

  // Classify a request into one of:
  //   "passthrough"            — fetch from network, never touch the cache
  //   "navigation"             — network-first, fall back to offline.html
  //                              (the HTML itself is never stored)
  //   "asset"                  — cache (stale-while-revalidate / precache)
  //
  // input: { method, sameOrigin, pathname, isNavigate }
  function f3dClassifyRequest(input) {
    var method = input && input.method ? String(input.method).toUpperCase() : "GET";
    if (method !== "GET") return "passthrough";
    if (!input || input.sameOrigin !== true) return "passthrough";

    var pathname = typeof input.pathname === "string" ? input.pathname : "";

    // Navigations are network-first with an offline fallback; we never
    // store the (personalized SSR) HTML.
    if (input.isNavigate === true) return "navigation";

    // Denylisted same-origin paths are never cached.
    if (hasPrefix(pathname, DENY_PREFIXES)) return "passthrough";

    // Narrow static allowlist.
    if (hasPrefix(pathname, ALLOW_PREFIXES)) return "asset";
    for (var i = 0; i < ALLOW_EXACT.length; i++) {
      if (pathname === ALLOW_EXACT[i]) return "asset";
    }

    return "passthrough";
  }

  scope.f3dClassifyRequest = f3dClassifyRequest;
  scope.f3dCachePolicy = {
    DENY_PREFIXES: DENY_PREFIXES,
    ALLOW_PREFIXES: ALLOW_PREFIXES,
    ALLOW_EXACT: ALLOW_EXACT,
  };
})(typeof self !== "undefined" ? self : this);
