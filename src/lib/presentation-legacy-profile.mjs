// Legacy Profile Inspector (Legacy Bootstrap L1) — pure, inert-text recognition
// of ONE exact pre-marker Builder generation so it can be bootstrapped to the
// current versioned contract by the deterministic adapter (L2/L3).
//
// SCOPE: exactly the `builder-may2026-f8f68f0` profile — the 2026-05-25 Builder
// export family produced by portal.functions.ts @ f8f68f0 (pre-sentinel,
// pre-anno-input). NOT a universal legacy matcher. A file is recognized ONLY
// when EVERY pinned anchor occurs exactly once in canonical order, every
// runtime dependency the current runtime needs is present in the preserved
// chrome, there are zero f3d markers, and the protected/iframe structure
// matches. Anything else → rejected with precise reasons. No regex fallback.
//
// INERT: never renders, executes, iframes, imports, or DOM-loads the input.
// String scans only. Anchors are exact byte strings, never line numbers.

// ── Pinned profile id ───────────────────────────────────────────────────────
const LEGACY_PROFILE_ID = "builder-may2026-f8f68f0";

// ── Mutation-region anchors (exact, unique, canonical order) ────────────────
// Each "replace" region is bounded by a start anchor and an end anchor (the
// first preserved byte AFTER the region). "rewrite" regions are a single exact
// tag. The metadata block is a zero-length-source insertion after a fixed head
// anchor. Anchors are the SAME static text the f8f68f0 generator emitted around
// each runtime region; the per-presentation content lives OUTSIDE them.
const PEERJS_TAG =
  '<script src="https://unpkg.com/peerjs@1.5/dist/peerjs.min.js" crossorigin="anonymous" defer></script>';

const IFRAME_MP =
  '<iframe id="matterport-frame" allowfullscreen allow="xr-spatial-tracking; fullscreen"></iframe>';
const IFRAME_MP_GHOST =
  '<iframe id="matterport-frame-ghost" allowfullscreen allow="xr-spatial-tracking; fullscreen" aria-hidden="true" tabindex="-1"></iframe>';

const META_INSERT_ANCHOR =
  '<meta name="viewport" content="width=device-width, initial-scale=1.0">';

// Region anchor table. `start`/`end` are unique substrings that begin their
// line; the region runs from the start of `start` to the start of `end`.
// `tail` regions end at the END of an exact closing token.
const REGION_ANCHORS = {
  css: {
    start: "/* ── Live Tour annotation overlay ",
    end: "/* ── Shared modal backdrop ",
  },
  markup: {
    start: '    <div id="live-tour-navlock" aria-hidden="true"></div>',
    // the anno-toolbar close immediately after the (unique) exit button:
    afterToken: 'aria-label="Exit annotation mode">&times;</button>\n    </div>',
  },
  kernel: {
    start: "// ── Live Guided Tour PeerJS controller. Inlined verbatim from",
    end: "// ── Unified Ask pipeline: fans out across the host-curated qaDatabase",
  },
  glue: {
    start: "(function initLiveGuide(){",
    // last statement + matching IIFE close:
    endToken: "session.subscribe(onState);\n})();",
  },
};

// ── Dependency-closure contract (audited 2026-06-15) ────────────────────────
// Every DOM id the CURRENT canonical markup/kernel/glue reference that is NOT
// supplied by a replacement region must exist exactly once in the preserved
// chrome, or the file is rejected (the upgraded runtime would reference missing
// nodes). The markup span supplies the anno-* / live-tour-navlock / remote-
// pointer ids; the peerjs span supplies f3d-peerjs-loader; the kernel has no
// DOM refs. These are the remaining EXTERNAL dependencies.
const REQUIRED_CHROME_IDS = Object.freeze([
  "anno-letterbox-wrap",
  "drawer-live-guide",
  "hud-live-tour-btn",
  "lg-agent",
  "lg-agent-active",
  "lg-agent-prejoin",
  "lg-agent-status",
  "lg-audio",
  "lg-join-btn",
  "lg-pin-input",
  "lg-pin-value",
  "lg-start-btn",
  "lg-stops",
  "lg-toggle-agent",
  "lg-toggle-visitor",
  "lg-visitor",
  "lg-visitor-status",
  "live-tour-control-drawer",
  "live-tour-inner",
  "loc-sync",
  "loc-sync-tips",
  "lt-leave-btn",
  "ltcd-live-guide-slot",
]);

// Window helpers the current glue calls that the preserved chrome must define.
const REQUIRED_WINDOW_HELPERS = Object.freeze([
  "window.__closeLiveTour",
  "window.__lgOnPropertyChange",
  "window.__setHudVisible",
  "window.__snapPrimaryActive",
]);

// Branding recovery anchors — preserved chrome CSS OUTSIDE every runtime region.
// accent: the gate password focus border; hud bg: the agent drawer background.
// Both match the current generator's interpolation sites (escapeHtml(accentColor)
// / escapeHtml(hudBgColor)cc), so the recovered values rebuild the CSS span.
const BRANDING = {
  accent: { prefix: "#gate-password-input:focus{border-color:", suffix: "}" },
  hudBg: {
    prefix:
      "#agent-drawer{position:fixed;top:0;right:0;width:min(300px,88vw);height:100%;z-index:2000;overflow-y:auto;transform:translateX(100%);transition:transform 0.3s ease;background:",
    suffix: "cc",
  },
};

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Capability detection — inert substring presence (reported, not trusted for
// matching). The runtime feature set is fixed by the profile; these document
// what the specific file carries.
const CAPABILITY_PROBES = Object.freeze([
  { key: "live_tour", token: "(function initLiveGuide(){" },
  { key: "annotation", token: '<div id="anno-letterbox-wrap">' },
  { key: "ghost_iframe", token: 'id="matterport-frame-ghost"' },
  { key: "ask", token: "window.__QA_DATABASE__" },
  { key: "view_sync", token: 'id="loc-sync"' },
  { key: "protected", token: "window.__PROTECTED_BLOB__" },
  { key: "relative_assets", token: "assets/" },
]);

const F3D_TOKENS = ["f3d-", "f3d:runtime-"];

// ── tiny pure helpers ───────────────────────────────────────────────────────
function countOccurrences(haystack, needle) {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

function lineStartOf(html, index) {
  const nl = html.lastIndexOf("\n", index - 1);
  return nl + 1;
}

function recoverColor(html, anchor) {
  const at = html.indexOf(anchor.prefix);
  if (at === -1 || html.indexOf(anchor.prefix, at + anchor.prefix.length) !== -1) {
    return null; // missing or ambiguous
  }
  const from = at + anchor.prefix.length;
  const end = html.indexOf(anchor.suffix, from);
  if (end === -1) return null;
  const value = html.slice(from, end);
  return HEX_COLOR.test(value) ? value : null;
}

// ── inspector ────────────────────────────────────────────────────────────────
// inspectLegacyProfile(html) → structured result. Pure & deterministic.
function inspectLegacyProfile(html) {
  const report = {
    profileId: LEGACY_PROFILE_ID,
    recognized: false,
    supported: false,
    confidence: 0,
    reasons: [],
    capabilities: [],
    branding: null,
    protected: false,
    regions: null,
  };
  const reject = (reason) => {
    report.reasons.push(reason);
    report.recognized = false;
    report.supported = false;
    return report;
  };

  if (typeof html !== "string") return reject("input is not a string");
  if (html.trim().length === 0) return reject("input is empty");

  // 1. Must be pre-marker: zero f3d metadata/sentinels.
  for (const t of F3D_TOKENS) {
    const n = countOccurrences(html, t);
    if (n !== 0) return reject(`expected 0 ${t} markers (found ${n}) — not a pre-marker file`);
  }

  // 2. Every region anchor present exactly once.
  const need1 = (label, needle) => {
    const n = countOccurrences(html, needle);
    if (n !== 1) {
      reject(`anchor "${label}" must occur exactly once (found ${n})`);
      return false;
    }
    return true;
  };
  let ok = true;
  ok = need1("css.start", REGION_ANCHORS.css.start) && ok;
  ok = need1("css.end", REGION_ANCHORS.css.end) && ok;
  ok = need1("dep:peerjs", PEERJS_TAG) && ok;
  ok = need1("markup.start", REGION_ANCHORS.markup.start) && ok;
  ok = need1("markup.afterToken", REGION_ANCHORS.markup.afterToken) && ok;
  ok = need1("iframe.matterport-frame", IFRAME_MP) && ok;
  ok = need1("iframe.matterport-frame-ghost", IFRAME_MP_GHOST) && ok;
  ok = need1("kernel.start", REGION_ANCHORS.kernel.start) && ok;
  ok = need1("kernel.end", REGION_ANCHORS.kernel.end) && ok;
  ok = need1("glue.start", REGION_ANCHORS.glue.start) && ok;
  ok = need1("glue.endToken", REGION_ANCHORS.glue.endToken) && ok;
  ok = need1("meta-insert-anchor", META_INSERT_ANCHOR) && ok;
  if (!ok) return report;

  // 3. Compute region byte ranges and verify canonical order + non-overlap.
  const cssStart = lineStartOf(html, html.indexOf(REGION_ANCHORS.css.start));
  const cssEnd = lineStartOf(html, html.indexOf(REGION_ANCHORS.css.end));
  const peerStart = html.indexOf(PEERJS_TAG);
  const peerEnd = peerStart + PEERJS_TAG.length;
  const mfStart = html.indexOf(IFRAME_MP);
  const mfEnd = mfStart + IFRAME_MP.length;
  const ghostStart = html.indexOf(IFRAME_MP_GHOST);
  const ghostEnd = ghostStart + IFRAME_MP_GHOST.length;
  const markupStart = lineStartOf(html, html.indexOf(REGION_ANCHORS.markup.start));
  const markupEnd = html.indexOf(REGION_ANCHORS.markup.afterToken) + REGION_ANCHORS.markup.afterToken.length;
  const kernelStart = lineStartOf(html, html.indexOf(REGION_ANCHORS.kernel.start));
  const kernelEnd = lineStartOf(html, html.indexOf(REGION_ANCHORS.kernel.end));
  const glueStart = lineStartOf(html, html.indexOf(REGION_ANCHORS.glue.start));
  const glueEnd = html.indexOf(REGION_ANCHORS.glue.endToken) + REGION_ANCHORS.glue.endToken.length;
  const metaAt = html.indexOf(META_INSERT_ANCHOR) + META_INSERT_ANCHOR.length;

  const regions = [
    { key: "css", op: "replace", start: cssStart, end: cssEnd },
    { key: "dep:peerjs", op: "replace", start: peerStart, end: peerEnd },
    { key: "iframe:matterport-frame", op: "rewrite", start: mfStart, end: mfEnd },
    { key: "iframe:matterport-frame-ghost", op: "rewrite", start: ghostStart, end: ghostEnd },
    { key: "markup", op: "replace", start: markupStart, end: markupEnd },
    { key: "js:kernel", op: "replace", start: kernelStart, end: kernelEnd },
    { key: "js:glue", op: "replace", start: glueStart, end: glueEnd },
    { key: "meta", op: "insert", start: metaAt, end: metaAt },
  ];
  for (const r of regions) {
    if (r.start < 0 || r.end < r.start) return reject(`region ${r.key} has an invalid range`);
  }
  const ordered = regions.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i].start < ordered[i - 1].end) {
      return reject(`regions overlap: ${ordered[i - 1].key} and ${ordered[i].key}`);
    }
  }
  // Canonical document order (head metas → css → peerjs → iframes → markup →
  // kernel → glue) — protects against reordered/foreign anchors.
  const canonical = ["meta", "css", "dep:peerjs", "iframe:matterport-frame",
    "iframe:matterport-frame-ghost", "markup", "js:kernel", "js:glue"];
  const actualOrder = ordered.map((r) => r.key);
  if (canonical.join("|") !== actualOrder.join("|")) {
    return reject(`anchors are out of canonical order (${actualOrder.join(" → ")})`);
  }

  // 4. Dependency-closure: required chrome ids + window helpers present 1×.
  for (const id of REQUIRED_CHROME_IDS) {
    const n = countOccurrences(html, `id="${id}"`);
    if (n !== 1) return reject(`required runtime dependency id="${id}" must exist exactly once (found ${n})`);
  }
  for (const helper of REQUIRED_WINDOW_HELPERS) {
    if (countOccurrences(html, helper) < 1) return reject(`required window helper ${helper} is missing`);
  }

  // 5. Protected/structure fingerprints.
  report.protected = html.includes("window.__PROTECTED_BLOB__");
  if (!report.protected) return reject("expected a protected presentation (window.__PROTECTED_BLOB__ absent)");

  // 6. Branding recovery from preserved chrome (required to rebuild the CSS).
  const accentColor = recoverColor(html, BRANDING.accent);
  const hudBgColor = recoverColor(html, BRANDING.hudBg);
  if (!accentColor) return reject("could not recover accent color from preserved chrome anchors");
  if (!hudBgColor) return reject("could not recover hud background color from preserved chrome anchors");
  report.branding = { accentColor, hudBgColor };

  // 7. Capabilities (reported only).
  report.capabilities = CAPABILITY_PROBES.filter((p) => html.includes(p.token)).map((p) => p.key);

  report.regions = regions;
  report.recognized = true;
  report.supported = true;
  report.confidence = 1;
  report.reasons.push(`recognized exact legacy profile ${LEGACY_PROFILE_ID} (all anchors unique, ordered; dependency closure satisfied)`);
  return report;
}

export {
  LEGACY_PROFILE_ID,
  REGION_ANCHORS,
  PEERJS_TAG,
  IFRAME_MP,
  IFRAME_MP_GHOST,
  META_INSERT_ANCHOR,
  REQUIRED_CHROME_IDS,
  REQUIRED_WINDOW_HELPERS,
  BRANDING,
  inspectLegacyProfile,
};
