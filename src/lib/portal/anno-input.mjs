// Shared mobile-input hardening for the live-tour annotation canvas.
//
// Injected (via ?raw + stripExports, same as live-session.mjs) BETWEEN the
// live-session controller and the surface glue inside the generated HTML
// IIFE, so the glue can call these helpers as plain locals. Designed to be
// consumed by BOTH glue surfaces (atlas-live-tour-runtime.mjs today, the
// portal export glue when it adopts the v2 input path) so the input state
// machine never forks.
//
// Same browser-safety constraints as the sibling runtime .mjs modules
// (enforced by scripts/verify-portal-html.mjs and the node:test gates):
// no imports, no TypeScript syntax, no single-quote string literals,
// ES5-ish style, ONE trailing export block stripped at injection time.
//
// What this fixes on iOS/iPadOS (each helper is independent):
//   - multi-touch corrupting strokes (single-owner pointer guard)
//   - palm-then-Pencil input fighting (pen takeover with clean commit)
//   - stuck strokes/ropes after system gestures (cancel-aware ownership)
//   - jagged 120Hz Pencil ink (coalesced pointer events)
//   - oversized canvas buffers on 3x phones (device-pixel-ratio clamp)
//   - misaligned canvas after URL-bar collapse / rotation (visualViewport
//     + orientationchange bindings)

// Normalize a pointerId for comparison. Real ids may legitimately be 0
// (Firefox mouse), so null is the only "no owner" sentinel; an undefined
// id (exotic synthetic events) maps to -1 so claim/owns stay consistent.
function _annoPointerId(e) {
  if (!e) return -1;
  var id = e.pointerId;
  return id === undefined || id === null ? -1 : id;
}

// Single-owner gesture guard for the annotation canvas.
//
// Rules:
//   - Only one pointer may own a gesture at a time.
//   - A non-primary touch can never START a gesture (second finger).
//   - A pen arriving while a touch owns the gesture takes over (palm
//     rejection): `onTakeover` fires FIRST so the caller can commit the
//     in-flight touch stroke cleanly, then the pen claims ownership.
//   - Everything else while a gesture is active is rejected.
//
// options:
//   onTakeover: function — called synchronously before a pen steals
//     ownership from a touch. Must leave the surface gesture-free.
function createAnnoPointerGuard(options) {
  var opts = options || {};
  var onTakeover = typeof opts.onTakeover === "function" ? opts.onTakeover : null;
  var activeId = null;
  var activeType = "";

  function claim(e) {
    if (!e) return false;
    var id = _annoPointerId(e);
    var type = typeof e.pointerType === "string" ? e.pointerType : "";
    if (activeId === null) {
      if (type === "touch" && e.isPrimary === false) return false;
      activeId = id;
      activeType = type;
      return true;
    }
    if (type === "pen" && activeType === "touch") {
      if (onTakeover) {
        try {
          onTakeover();
        } catch (_e) {
          // the takeover hook must never block the pen from claiming
        }
      }
      activeId = id;
      activeType = type;
      return true;
    }
    return false;
  }

  function owns(e) {
    return activeId !== null && !!e && _annoPointerId(e) === activeId;
  }

  function release(e) {
    if (!owns(e)) return false;
    activeId = null;
    activeType = "";
    return true;
  }

  function reset() {
    activeId = null;
    activeType = "";
  }

  function isActive() {
    return activeId !== null;
  }

  function activePointerType() {
    return activeType;
  }

  return {
    claim: claim,
    owns: owns,
    release: release,
    reset: reset,
    isActive: isActive,
    activePointerType: activePointerType,
  };
}

// Map a pointermove (plus its coalesced history, when the browser exposes
// one) through `mapFn`, oldest first. A 120Hz Pencil delivers several raw
// samples per rendered frame; using only the dispatched event drops them
// and produces visibly segmented ink. Falls back to the single event.
function annoCollectPoints(e, mapFn) {
  if (!e || typeof mapFn !== "function") return [];
  var list = null;
  try {
    if (typeof e.getCoalescedEvents === "function") list = e.getCoalescedEvents();
  } catch (_e) {
    list = null;
  }
  var out = [];
  if (list && list.length > 0) {
    for (var i = 0; i < list.length; i++) {
      var p = mapFn(list[i]);
      if (p) out.push(p);
    }
  }
  if (out.length === 0) {
    var single = mapFn(e);
    if (single) out.push(single);
  }
  return out;
}

// Clamp the device pixel ratio used for canvas buffer sizing. A 3x phone
// triples the backing-store pixels per CSS pixel in each axis (9x memory
// + redraw cost) for no visible gain on annotation strokes; 2.5 keeps
// retina-class sharpness with a bounded buffer. Callers pass a tighter
// cap (1.5) on iOS, where the WebKit process runs under jetsam limits
// alongside the Matterport WebGL context.
function annoClampDpr(raw, max) {
  var dpr = typeof raw === "number" && isFinite(raw) && raw > 0 ? raw : 1;
  var cap = typeof max === "number" && isFinite(max) && max > 0 ? max : 2.5;
  return Math.min(dpr, cap);
}

// Enforce an absolute backing-store pixel budget on top of the DPR clamp:
// given the CSS size and a candidate DPR, scale the DPR down so
// (w*dpr)*(h*dpr) never exceeds maxPixels (RGBA bytes = pixels * 4).
// Floors at 1 — below-native scaling trades too much stroke quality for
// memory that the realistic letterbox sizes never need anyway.
function annoBudgetDpr(cssW, cssH, dpr, maxPixels) {
  var w = typeof cssW === "number" && isFinite(cssW) && cssW > 0 ? cssW : 1;
  var h = typeof cssH === "number" && isFinite(cssH) && cssH > 0 ? cssH : 1;
  var d = typeof dpr === "number" && isFinite(dpr) && dpr > 0 ? dpr : 1;
  var budget = typeof maxPixels === "number" && isFinite(maxPixels) && maxPixels > 0 ? maxPixels : 4194304;
  if (w * d * (h * d) <= budget) return d;
  var scaled = Math.sqrt(budget / (w * h));
  if (!isFinite(scaled) || scaled <= 0) return 1;
  return Math.max(1, Math.min(d, scaled));
}

// iOS / iPadOS WebKit detection — every browser on iOS (Safari, Chrome,
// Edge, Firefox) is WebKit and shares its clipboard behavior: ANY
// navigator.clipboard.readText() raises the native Paste callout, which
// interrupts in-flight canvas gestures. Callers use this to disable all
// ambient clipboard reads on these devices. Covers:
//   - classic identifiers (platform/userAgent containing iPhone/iPad/iPod,
//     which iOS Chrome "CriOS" and Firefox "FxiOS" UAs also carry), and
//   - iPad "desktop mode", which masquerades as macOS:
//     platform === "MacIntel" with maxTouchPoints > 1.
// Fails closed to false (not iOS) — callers that need the safe direction
// for ambient reads must ALSO gate on the module being present at all.
function annoIsIosWebKit(nav) {
  try {
    var n = nav || (typeof navigator !== "undefined" ? navigator : null);
    if (!n) return false;
    var p = typeof n.platform === "string" ? n.platform : "";
    var ua = typeof n.userAgent === "string" ? n.userAgent : "";
    if (/iPhone|iPad|iPod/i.test(p)) return true;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    if (p === "MacIntel" && typeof n.maxTouchPoints === "number" && n.maxTouchPoints > 1) {
      return true;
    }
    return false;
  } catch (_e) {
    return false;
  }
}

// Best-effort coarse-pointer detection (touch-first devices). Used for
// runtime affordance sizing (e.g. the Focus Rope latch); the CSS side
// uses the equivalent @media (pointer: coarse) block.
function annoIsCoarsePointer(win) {
  try {
    var w = win || (typeof window !== "undefined" ? window : null);
    if (!w || typeof w.matchMedia !== "function") return false;
    var q = w.matchMedia("(pointer: coarse)");
    return !!(q && q.matches);
  } catch (_e) {
    return false;
  }
}

// Bind the viewport-geometry events that a plain window `resize` listener
// (and an element ResizeObserver) can miss on mobile: visualViewport
// resize (iOS URL-bar collapse, keyboard, pinch-zoom UI) and
// orientationchange. Returns an unbind function; binding failures are
// tolerated (the caller keeps its ResizeObserver path regardless).
function annoBindViewportEvents(win, cb) {
  var w = win || (typeof window !== "undefined" ? window : null);
  if (!w || typeof cb !== "function") {
    return function () {};
  }
  var bound = [];
  function on(target, ev) {
    if (!target || typeof target.addEventListener !== "function") return;
    try {
      target.addEventListener(ev, cb);
      bound.push([target, ev]);
    } catch (_e) {
      // tolerated — see header
    }
  }
  on(w.visualViewport, "resize");
  on(w, "orientationchange");
  return function () {
    for (var i = 0; i < bound.length; i++) {
      try {
        bound[i][0].removeEventListener(bound[i][1], cb);
      } catch (_e) {
        // already torn down
      }
    }
    bound.length = 0;
  };
}

export {
  createAnnoPointerGuard,
  annoCollectPoints,
  annoClampDpr,
  annoBudgetDpr,
  annoIsIosWebKit,
  annoIsCoarsePointer,
  annoBindViewportEvents,
};
