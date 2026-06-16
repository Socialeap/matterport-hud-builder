// Presentation package/runtime versioning — the single source of truth for
// ALL generated Frontiers3D packages (Atlas curated showcases AND Builder
// portal exports), their manifests, and the Upgrade Center's
// outdated-package detection + family routing.
//
// Kept on the historical `atlas-runtime-version.mjs` filename: the values
// are shared across families, not Atlas-specific, and the public builders
// below take a `family` argument. A rename to presentation-runtime-version
// .mjs would be a separate no-behavior-change commit (it churns the sibling
// .d.mts, the import-string test, and node:test imports for zero benefit).
//
// Plain .mjs on the same dual-import pattern as ask-runtime-transformer:
// imported as TS by the server-side generators via the sibling .d.mts,
// and imported directly by the node:test suites. It is NOT injected into
// generated HTML — only its VALUES travel (as manifest fields and <meta>
// markers), so normal module syntax is fine here.
//
// Bump rules:
//   ATLAS_PACKAGE_SCHEMA  — structural shape of the package folder
//     (file set, manifest layout). Bump only on breaking layout changes.
//   ATLAS_RUNTIME_VERSION — semver of the inlined live-tour runtime
//     (controller + glue + CSS). Bump on every behavior change; the
//     Upgrade Center compares this value to decide "outdated".
const ATLAS_PACKAGE_SCHEMA = 2;
// 2.2.5: Shared-annotation persistence across View Sync. Both runtimes
// (Builder + Atlas) previously called wipeAnnotations() on EVERY sync — in
// attemptSendLocation() on a successful send and in applyTeleport() on an
// inbound sync/follow — treating a View Sync as an annotation-scene reset. In a
// shared session that erased the peer's committed marks the moment anyone
// re-synced, so alternating Host/Guest annotation appeared to "disappear". Fix:
// a View Sync is NOT a wipe. attemptSendLocation/applyTeleport now only CONVERGE
// currentViewKey (so outbound packets are stamped with the live view and the
// receive filter still drops genuinely stale frames) and PRESERVE committed
// strokes. Clear (broadcast) and the Eraser remain the only ways to remove
// marks in a shared scene; session teardown still wipes. Tool changes never
// wiped (unchanged). Empty-key strokes drawn before the first sync stay accepted
// on both ends (the viewKey filter only drops when both keys are non-empty and
// differ), so establishing the first key never orphans earlier marks. Desktop-
// only; no Matterport SDK; no mobile collaboration; no backend. Packages at
// <= 2.2.4 wipe annotations on sync — that is what makes them "outdated".
// 2.2.4: View Sync clipboard — LEGACY readText-is-source-of-truth mechanism
// restored (Builder runtime). The 2.2.2/2.2.3 Permissions-API approach (gate
// ambient reads on a cached clipboard-read state) re-prompted on every
// Matterport "Copy" whenever a browser did not persist the grant, and failed
// product acceptance. 2.2.4 matches the pre-marker May-2026 behavior: a one-time
// readText() pre-fire inside the Start/Join click raises the browser's own
// permission prompt at the natural opt-in moment (Chromium then persists it so
// later ambient reads are silent); ambient triggers (focus / visibilitychange /
// pointerenter / clipboardchange) call readText() directly with NO
// permissions.query() and NO cached-permission gate — readText success/failure
// is the source of truth and a rejected read stays quiet and retries on the next
// trigger. Dedupe is unchanged (lastReadClipText text dedupe + ss|sr key dedupe).
// Saved/bookmark stop clicks send known coordinates directly (no clipboard read).
// The pill is informational only (no clickable enable). An acceptance-only debug
// log sits behind window.__F3D_VIEW_SYNC_DEBUG__ (off by default). Desktop-only;
// no Matterport SDK; no mobile collaboration; no backend. Packages at <= 2.2.3
// carry the rejected permission-gated path — that is what makes them "outdated".
// 2.2.3: View Sync clipboard permission — explicit hybrid model (Builder
// runtime). 2.2.2 gated ambient reads on a "granted" state but still treated a
// stale JS "granted" flag as authoritative, so on browsers that do not PERSIST
// clipboard-read a lapsed grant re-prompted on every Matterport "Copy". 2.2.3
// makes enabling explicit and self-healing: a single clear "Enable View Sync"
// gesture (fired from Start/Join and, as a retry, from a click/Enter on the
// loc-sync pill) is the ONLY path that calls readText() while permission is
// prompt/unknown; once granted, ambient reads (focus / visibilitychange /
// pointerenter / clipboardchange) run silently so U + Copy auto-syncs the peer;
// if an ambient read is rejected (the grant lapsed) the state flips back and the
// pill returns to an actionable "Enable View Sync" instead of re-prompting.
// Saved/bookmark stop clicks send known coordinates directly (never read the
// clipboard). Desktop-only; no Matterport SDK; no mobile collaboration; no
// backend. Packages at <= 2.2.2 carry the over-eager/re-prompting clipboard
// path — that is what makes them "outdated" to the Upgrade Center.
// 2.2.2: Builder runtime clipboard-permission isolation — brought to parity
// with the Atlas runtime. The Builder live-tour glue previously called
// navigator.clipboard.readText() on EVERY ambient trigger (focus /
// visibilitychange / letterbox pointerenter / clipboardchange) with no
// permission-state gate, so on a not-yet-granted environment ordinary pointer
// movement, saved/bookmark stop clicks, and a Matterport "Copy to clipboard"
// each raised a clipboard-read prompt — and view sync only worked after the
// sender approved that prompt. Fix: track navigator.permissions.query({ name:
// "clipboard-read" }) WITHOUT calling readText (clipPermissionState +
// onchange); ambient polls read silently ONLY when state is "granted"; the
// single not-yet-granted readText() probe stays inside the Start/Join click
// gesture (pre-grant), which also flips the state to "granted" on success so
// later ambient reads are silent. Desktop-only; no mobile change; no Matterport
// SDK. Packages at <= 2.2.1 carry the over-eager polling — that is what makes
// them "outdated" to the Upgrade Center.
// 2.2.1: P0 fix — Explore Together host→guest direction. Three latent
// defects made the host→guest half of a session fail while guest→host
// kept working: (1) the glue and the transport controller each kept
// their own current-view key with no way to converge after the host
// followed a guest's location share, so every host annotation packet
// (strokes, Eraser deletes, clear, nav_lock floor heartbeats) was
// stamped with a key the guest's stale-view filter rejected; (2) a
// blanket clipboard==currentViewKey echo guard silently swallowed the
// host's INTENTIONAL U + Copy re-sync of the view it was standing in —
// flashing success while sending nothing — and the receive path wrote
// the sent-dedupe vars, eating re-shares for 5s more; (3) a duplicate
// inbound PeerJS connection replaced the host's data channel before
// ever opening, leaving isConnected=true with dead outbound sends while
// the old handlers kept delivering inbound traffic. Fix: the controller
// send methods own the sender-side view key (shareLocationWithAgent now
// stamps it like teleportVisitor); a new noteCurrentView(ss, sr)
// controller API lets the glue report locally applied views
// (applyTeleport); echo suppression is provenance-aware (only the
// short-lived automatic echo of a remotely applied location is
// swallowed; last-sender-wins and the stale-view filter are unchanged);
// candidate inbound connections are adopted only on "open", closing the
// previous channel on adoption. Desktop-only; no mobile change.
// 2.2.0: Shared sequential annotation + Eraser for desktop Live Tour
// (PRs #160–#162). Both families now draw on the SAME synced scene in
// turn — a gesture-scoped "annotation floor" (reusing nav_lock) grants
// one participant the pen at a time, so two people can co-annotate
// without a restart or a clear. New idempotent `stroke_delete` transport
// message backs an Eraser tool (point-to-polyline hit test, committed
// strokes only; either peer erases either's stroke). The floor is held
// for the whole of a long gesture by a watchdog that re-arms on owned
// pointer movement, and the peer's REMOTE watchdog is kept alive by a
// throttled nav_lock(true) heartbeat (FLOOR_HEARTBEAT_MS ≈ FLOOR_SAFETY_MS
// /3) so a >8s Eraser drag — even over blank space, which emits no
// stroke_delete — never lets the other side start a competing gesture;
// a stationary/abandoned gesture stops beating and both sides release via
// the safety timeout. Desktop-only; no mobile capability added. Packages
// at <= 2.1.0 lack the Eraser + shared-floor heartbeat — that is what
// makes them "outdated" to the Upgrade Center.
// 2.1.0: Live Tour / Explore Together is DESKTOP-ONLY (product decision,
// 2026-06-09). Both families gate collaboration behind the shared
// fail-closed annoCollabEligible() predicate: ineligible devices (phones,
// tablets, iPad even with a keyboard/trackpad, ambiguous touch-first
// environments) get every collaboration affordance removed at startup and
// never load PeerJS, construct a session, request the mic, or run
// clipboard sync. The PeerJS dep span ships an INERT loader config (same
// pin + SRI) and the glue lazy-loads it on first Host/Join intent, desktop
// only. The PR #159 mobile sync UX (explicit tap, manual paste fallback,
// transient pill states) is removed; web-share iframe delegation for SOLO
// mobile sharing is kept. Packages at <= 2.0.3 still expose collaboration
// UI on mobile — that is what makes them "outdated" to the Upgrade Center.
// 2.0.3: emit `f3d:interaction-active` to the parent Atlas app on Draw /
// Focus Rope / pointer selection and on live-session connect, so the
// embedding modal can drop native Device fullscreen into Maximize on iPad
// (iPadOS swipe-exit collapses native fullscreen mid-draw). Parent half
// shipped in the app shell; this emit activates only after regeneration.
// 2.0.2: P0 iPad connect-crash hardening — wrapper gesture CSS made
// conditional on tool-active (Matterport navigation untouched
// otherwise); lazy annotation-canvas allocation (nothing allocated at
// PIN connect); iOS DPR cap 1.5 + backing-pixel budget; deferred voice
// on iOS (no auto getUserMedia/AudioContext/media call — explicit
// Enable voice gesture); sessionStorage diagnostic milestones.
// 2.0.1: iOS clipboard isolation — ambient readText() disabled on
// iOS/iPadOS WebKit (Paste-callout interruption fix) + stage-scoped
// WebKit gesture defenses.
const ATLAS_RUNTIME_VERSION = "2.2.5";

// SUPPORTED-CURRENT capabilities — what freshly generated packages
// advertise. Live Tour / Explore Together is desktop-only (2026-06-09), so
// no mobile collaboration capability will be advertised by current
// generators; this list ships EMPTY and stays empty unless a future,
// explicitly accepted capability is delivered. Generated packages must
// never advertise a capability that has not been delivered.
const ATLAS_RUNTIME_CAPABILITIES = [];

// RECOGNIZED-HISTORICAL capability registry — every capability string the
// Upgrade Center's inspector must be able to parse out of an older or
// experimental package's f3d-capabilities marker / manifest. The mobile_*
// entries are retired by the desktop-only decision and will never be
// advertised again, but they remain REGISTERED so a legacy package
// carrying them is classified instead of rejected as corrupt. Tests assert
// the published list stays a subset of this registry so a typo can't
// silently mint a new capability.
const ATLAS_KNOWN_CAPABILITIES = [
  "mobile_annotations_v2",
  "mobile_voice_v2",
  "mobile_view_sync_v2",
];

// Which generator/adapter produced a package. Travels as the
// `f3d-package-family` <meta> marker and the `package_family` manifest
// field so the Upgrade Center can route a package to the correct migration
// adapter from the HTML alone:
//   "atlas"   — curated showcase (atlas-curation-server + atlas-live-tour)
//   "builder" — portal presentation export (portal.functions.ts)
//   "legacy"  — recognized pre-marker package (assigned by the upgrader on
//               detection; never emitted by a current generator)
// Families a CURRENT generator may stamp into a package.
const GENERATED_FAMILIES = ["atlas", "builder"];
// Every family the Upgrade Center recognizes. "legacy" is a future U1
// INSPECTION classification for pre-marker packages — it is NEVER emitted by
// a generator, so the builders below reject it as an explicit argument.
const PRESENTATION_FAMILIES = ["atlas", "builder", "legacy"];
const F3D_PACKAGE_FAMILY_DEFAULT = "atlas";
// Fail closed. An OMITTED family defaults to atlas (back-compat with the
// zero-arg Atlas call sites). Any EXPLICIT value that is not a generated
// family — "", null, "legacy", or a typo — THROWS, so a generator can never
// silently stamp a bogus or non-generated family.
function _resolveGeneratedFamily(family) {
  if (family === undefined) return F3D_PACKAGE_FAMILY_DEFAULT;
  if (GENERATED_FAMILIES.indexOf(family) !== -1) return family;
  throw new Error(
    "f3d package family must be one of " +
      GENERATED_FAMILIES.join("|") +
      " (got " +
      JSON.stringify(family) +
      ")",
  );
}

// Manifest fields spliced into the package manifest by buildShowcaseFiles()
// (Atlas) and the Builder manifest object (portal.functions.ts).
function buildRuntimeManifestFields(family) {
  return {
    package_schema: ATLAS_PACKAGE_SCHEMA,
    runtime_version: ATLAS_RUNTIME_VERSION,
    capabilities: ATLAS_RUNTIME_CAPABILITIES.slice(),
    package_family: _resolveGeneratedFamily(family),
  };
}

// Self-identifying <meta> markers for the generated index.html <head>.
// Lets a package be classified (family + schema + runtime version +
// delivered capabilities) from the HTML alone, without its manifest — the
// single-file upgrader's primary detection input. The capabilities marker
// is emitted even while empty so its ABSENCE distinguishes pre-v2 packages
// from a v2 package with no capabilities yet; the family marker is appended
// last (additive — existing packages without it read as pre-family). All
// markers and the manifest derive from the same constants, so they can
// never skew.
function buildRuntimeMetaTags(family) {
  return (
    `<meta name="f3d-package-schema" content="${ATLAS_PACKAGE_SCHEMA}" />\n` +
    `<meta name="f3d-runtime" content="${ATLAS_RUNTIME_VERSION}" />\n` +
    `<meta name="f3d-capabilities" content="${ATLAS_RUNTIME_CAPABILITIES.join(",")}" />\n` +
    `<meta name="f3d-package-family" content="${_resolveGeneratedFamily(family)}" />`
  );
}

export {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
  ATLAS_KNOWN_CAPABILITIES,
  GENERATED_FAMILIES,
  PRESENTATION_FAMILIES,
  F3D_PACKAGE_FAMILY_DEFAULT,
  buildRuntimeManifestFields,
  buildRuntimeMetaTags,
};
