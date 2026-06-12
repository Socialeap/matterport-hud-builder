#!/usr/bin/env node

// U0 — Builder/portal presentation export parity with the versioned runtime.
// Asserts that generatePresentation() (src/lib/portal.functions.ts) now:
//   - injects the SHARED anno-input.mjs input kernel and routes its handlers
//     through the hardened guards (no forked input state machine),
//   - emits all four f3d-* markers + the runtime manifest fields (family
//     "builder"), with capabilities still empty (acceptance-gated),
//   - pins PeerJS to an exact version with an SRI hash,
//   - wraps the runtime spans in bounded sentinels (markup excludes the
//     Matterport iframe), and
//   - preserves the presentation content/config/token plumbing.
// Wiring assertions are text-level against the TS generator (it pulls Vite
// `?raw` imports + server-fn machinery node:test cannot resolve) — the same
// pattern as tests/atlas-runtime-version.test.mjs and atlas-live-tour.test.mjs.
//
// P2: the five f3d:runtime spans live in src/lib/portal/builder-runtime-spans.mjs
// and portal.functions.ts interpolates the builders. Span-content assertions
// therefore scan RUNTIME (generator + canonical span module, the full shipped
// corpus); generator-structure assertions stay on PORTAL. Exactly-once call-site
// ordering + byte identity are pinned by tests/builder-runtime-spans.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildRuntimeMetaTags,
  buildRuntimeManifestFields,
  ATLAS_RUNTIME_CAPABILITIES,
} from "../src/lib/atlas-runtime-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");
const PORTAL = read("src", "lib", "portal.functions.ts");
const SPANS_MODULE = read("src", "lib", "portal", "builder-runtime-spans.mjs");
const RUNTIME = PORTAL + "\n" + SPANS_MODULE;

// ── 1. Shared input kernel is injected (not forked) ──────────────────────
test("Builder injects the shared anno-input kernel via the dedicated loader", () => {
  assert.ok(
    PORTAL.includes(`from "./portal/anno-input-source"`),
    "must import getAnnoInputRuntimeJS from the dedicated source loader",
  );
  assert.ok(PORTAL.includes("getAnnoInputRuntimeJS()"), "must build the kernel blob once per process");
  assert.ok(
    SPANS_MODULE.includes("${ANNO_INPUT_RUNTIME_JS}"),
    "the kernel span template must interpolate the kernel into the runtime IIFE",
  );
  assert.ok(
    PORTAL.includes("annoInputJs: ANNO_INPUT_RUNTIME_JS"),
    "the generator must pass the kernel blob to the kernel span builder",
  );
});

test("Builder routes annotation input through the hardened guards", () => {
  for (const helper of [
    "createAnnoPointerGuard",
    "annoCollectPoints",
    "annoClampDpr",
    "annoBudgetDpr",
    "annoBindViewportEvents",
    "annoIsIosWebKit",
  ]) {
    assert.ok(RUNTIME.includes(helper + "("), `runtime must call ${helper}()`);
  }
  assert.ok(RUNTIME.includes("onTakeover:finalizeActiveGesture"), "pen-takeover hook wired");
  assert.ok(RUNTIME.includes('addEventListener("pointercancel"'), "pointercancel recovery wired");
  assert.ok(
    RUNTIME.includes("annoGuard.claim(e)") && RUNTIME.includes("annoGuard.owns(e)"),
    "single-owner ownership gating wired",
  );
});

// ── 2. Fail-closed when the kernel is absent ─────────────────────────────
test("Builder fails closed: Draw/Rope refuse without the input kernel", () => {
  assert.ok(RUNTIME.includes("var ANNO_INPUT_OK="), "computes the kernel-availability gate");
  assert.ok(
    RUNTIME.includes('if((mode==="draw"||mode==="rope")&&!ANNO_INPUT_OK) return;'),
    "setToolMode must refuse Draw/Rope when the kernel is missing",
  );
});

// ── 3. iOS clipboard isolation (the Apple Paste fix) ─────────────────────
test("Builder gates ambient clipboard reads off iOS WebKit and active tools", () => {
  assert.ok(RUNTIME.includes("function ambientClipboardAllowed()"), "defines the ambient-read gate");
  assert.ok(RUNTIME.includes("if(IS_IOS_WEBKIT) return false;"), "iOS never reads ambiently");
  assert.ok(
    RUNTIME.includes("if(!IS_IOS_WEBKIT&&navigator&&navigator.clipboard&&typeof navigator.clipboard.readText"),
    "Join/Start pre-fire readText must be disabled on iOS",
  );
});

// ── 4. Memory hardening: lazy canvas + DPR budget ────────────────────────
test("Builder allocates the annotation canvas lazily with a DPR budget", () => {
  assert.ok(RUNTIME.includes("function ensureAnnoCanvasAllocated()"), "lazy allocation helper present");
  assert.ok(
    !RUNTIME.includes(`var annoCtx=annoCanvas?annoCanvas.getContext("2d"):null;`),
    "eager getContext at IIFE init must be gone (allocation is now lazy)",
  );
  assert.ok(RUNTIME.includes("annoBudgetDpr(w,h,dpr"), "backing-store budget applied on resize");
});

// ── 5. Versioned runtime contract: 4 markers + manifest, family=builder ──
test("Builder emits all four f3d markers (family=builder), capabilities empty", () => {
  assert.ok(PORTAL.includes(`${"$"}{buildRuntimeMetaTags("builder")}`), "splices the builder meta markers");
  assert.ok(PORTAL.includes(`...buildRuntimeManifestFields("builder")`), "spreads the builder manifest fields");
  const tags = buildRuntimeMetaTags("builder");
  assert.ok(tags.includes(`<meta name="f3d-package-family" content="builder" />`));
  assert.ok(
    tags.includes(`<meta name="f3d-capabilities" content="" />`),
    "capabilities ship empty (mobile_annotations_v2 is acceptance-gated)",
  );
  assert.equal(buildRuntimeManifestFields("builder").package_family, "builder");
  assert.equal(ATLAS_RUNTIME_CAPABILITIES.length, 0, "no capability is advertised yet");
});

// ── 6. PeerJS pinned to an exact version with SRI ────────────────────────
test("Builder PeerJS is pinned with an SRI hash (no floating @1.5)", () => {
  assert.match(
    RUNTIME,
    /https:\/\/unpkg\.com\/peerjs@\d+\.\d+\.\d+\/dist\/peerjs\.min\.js/,
    "PeerJS src must pin an exact x.y.z version",
  );
  assert.ok(!RUNTIME.includes("peerjs@1.5/dist"), "floating @1.5 tag must be gone");
  assert.match(RUNTIME, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, "PeerJS must carry a sha384 SRI hash");
});

// ── 7. Runtime sentinels come from the canonical module (P2) ──────────────
test("runtime spans live in the canonical module; the iframe stays outside markup", () => {
  for (const span of ["dep:peerjs", "css", "markup", "js:kernel", "js:glue"]) {
    assert.ok(SPANS_MODULE.includes(`f3d:runtime-${span} BEGIN v=1 family=builder`), `BEGIN ${span}`);
    assert.ok(SPANS_MODULE.includes(`f3d:runtime-${span} END`), `END ${span}`);
  }
  const begins = (SPANS_MODULE.match(/f3d:runtime-[\w:.-]+ BEGIN /g) || []).length;
  const ends = (SPANS_MODULE.match(/f3d:runtime-[\w:.-]+ END/g) || []).length;
  assert.equal(begins, ends, "BEGIN/END sentinels must balance");
  assert.equal(
    (PORTAL.match(/f3d:runtime-/g) || []).length,
    0,
    "the generator must emit sentinels only via the canonical builders",
  );
  // The markup span must NOT wrap the Matterport iframe (presentation
  // content): the iframe sits before the markup builder call site.
  const markupSite = PORTAL.indexOf("${BUILDER_MARKUP_SPAN}");
  const iframeIdx = PORTAL.indexOf(`<iframe id="matterport-frame"`);
  assert.ok(
    iframeIdx !== -1 && markupSite !== -1 && iframeIdx < markupSite,
    "the Matterport iframe must stay OUTSIDE (before) the markup span call site",
  );
});

// ── 8. Content preservation: load-bearing plumbing untouched ─────────────
test("Builder preserves the presentation content/config/token plumbing", () => {
  for (const token of [
    `id="matterport-frame"`,
    "frame.src=props[0].iframeUrl",
    "window.__PROTECTED_BLOB__",
    "window.__configReady",
    `id="gate-password-input"`,
    "subtle.deriveKey",
  ]) {
    assert.ok(PORTAL.includes(token), `preserved token missing: ${token}`);
  }
});

// ── 9. Runtime 2.0.3 interaction signal ported to the Builder adapter ─────
// So a Builder package can never advertise runtime 2.0.3 (the shared
// ATLAS_RUNTIME_VERSION, bumped by PR #154) without carrying 2.0.3's emit.
test("Builder carries the f3d:interaction-active emit (parent-only, direct-safe)", () => {
  assert.ok(RUNTIME.includes("function emitInteractionActive()"), "defines the interaction emit");
  assert.ok(
    RUNTIME.includes("if(!window.parent||window.parent===window) return;"),
    "no-op when opened directly (no distinct parent) — direct viewing unaffected",
  );
  assert.ok(
    RUNTIME.includes(`window.parent.postMessage({ type:"f3d:interaction-active" },"*")`),
    "posts f3d:interaction-active to the parent",
  );
  assert.ok(
    RUNTIME.includes(`if(mode==="pointer"||mode==="draw"||mode==="rope"||mode==="eraser") emitInteractionActive();`),
    "setToolMode signals on Pointer/Draw/Rope/Eraser",
  );
  assert.ok(
    (RUNTIME.match(/emitInteractionActive\(\)/g) || []).length >= 3,
    "wired at the definition + tool-select + first-connect",
  );
});
