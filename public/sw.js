// Frontiers3D service worker — deliberately conservative.
//
// Scope: served from /sw.js (root) so it controls "/". It caches ONLY a
// small same-origin static allowlist (Vite hashed /assets, PWA icons,
// manifest, offline page) decided by f3dClassifyRequest() in
// sw-cache-policy.js. Navigations are network-first with a branded offline
// fallback; the HTML is never stored. Non-GET, cross-origin, auth/API/
// personalized requests are passed straight to the network and never
// cached. No tours / live sessions / map data are implied to work offline.
//
// No Workbox: a small audited worker fits the Vite/TanStack/Cloudflare
// setup without another dependency.

/* global importScripts, f3dClassifyRequest */
importScripts("/sw-cache-policy.js");

// Bump CACHE_VERSION on any change to the precache list or SW behavior.
// activate deletes every cache whose name is not in the current set.
var CACHE_VERSION = "v1";
var PRECACHE = "f3d-precache-" + CACHE_VERSION;
var RUNTIME = "f3d-runtime-" + CACHE_VERSION;
var CURRENT_CACHES = [PRECACHE, RUNTIME];

var OFFLINE_URL = "/offline.html";
var PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png",
];

self.addEventListener("install", function (event) {
  // Precache the offline fallback + stable PWA assets. Do NOT skipWaiting
  // here — the new worker waits until the user confirms the update (see
  // the SKIP_WAITING message handler), so we never strand an active tab on
  // a swapped-out app version.
  event.waitUntil(
    caches.open(PRECACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            if (CURRENT_CACHES.indexOf(name) === -1) return caches.delete(name);
            return undefined;
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

// The page asks the waiting worker to take over after the user confirms.
self.addEventListener("message", function (event) {
  if (event && event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function classify(request) {
  var url;
  try {
    url = new URL(request.url);
  } catch (_e) {
    return "passthrough";
  }
  var sameOrigin = url.origin === self.location.origin;
  var isNavigate =
    request.mode === "navigate" ||
    (request.headers &&
      typeof request.headers.get === "function" &&
      (request.headers.get("accept") || "").indexOf("text/html") !== -1 &&
      request.method === "GET");
  return f3dClassifyRequest({
    method: request.method,
    sameOrigin: sameOrigin,
    pathname: url.pathname,
    isNavigate: isNavigate,
  });
}

// Network-first navigation with an offline fallback. The HTML response is
// returned to the page but never written to the cache (it can be
// personalized SSR).
function handleNavigation(event) {
  return fetch(event.request).catch(function () {
    return caches.match(OFFLINE_URL).then(function (cached) {
      return (
        cached ||
        new Response("Offline", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        })
      );
    });
  });
}

// Stale-while-revalidate for the static allowlist (hashed + immutable, so
// staleness is safe; the background refresh keeps non-hashed allowlisted
// files current).
function handleAsset(event) {
  return caches.open(RUNTIME).then(function (cache) {
    return cache.match(event.request).then(function (cached) {
      var network = fetch(event.request)
        .then(function (response) {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var kind = classify(event.request);
  if (kind === "passthrough") return; // let the browser handle it
  if (kind === "navigation") {
    event.respondWith(handleNavigation(event));
    return;
  }
  if (kind === "asset") {
    event.respondWith(handleAsset(event));
  }
});
