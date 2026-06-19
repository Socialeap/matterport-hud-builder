#!/usr/bin/env node

// Atlas-managed showcase runtime-upgrade (republish) — the Atlas equivalent of
// the Builder Patch Tool. Pure-logic proofs for the upgrade-availability check
// and the republish guard/builders, plus boundary proofs that the single-file
// Presentation Upgrade Center still REJECTS family=atlas and that no GitHub/
// Netlify secret can reach the client through the new code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  parseRuntimeVersion,
  compareRuntimeVersions,
  computeShowcaseRuntimeStatus,
  evaluateRuntimeUpgradeGate,
  canRepublishShowcase,
  buildShowcaseInputFromJob,
  resolveRepublishSlug,
  buildRepublishJobUpdate,
} from "../src/lib/atlas-runtime-upgrade.mjs";
import {
  ATLAS_RUNTIME_VERSION,
  buildRuntimeManifestFields,
} from "../src/lib/atlas-runtime-version.mjs";
import {
  patchPresentationHtml,
  PATCH_OUTCOMES,
  REJECTION_CODES,
} from "../src/lib/presentation-upgrade-patcher.mjs";
import {
  describeDisposition,
  inspectPresentationHtml,
} from "../src/lib/presentation-upgrade-session.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");
// Strip comments so secret/static-import scans test CODE, not documentation that
// legitimately NAMES GitHub/Netlify (the helper's header comment does).
const codeOnly = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// A live, well-formed published showcase job (family=atlas by construction).
const publishedJob = Object.freeze({
  id: "11111111-1111-1111-1111-111111111111",
  extracted_matterport_id: "ABCdef12345", // 11 alphanumeric
  draft_payload: {
    title: "Opera Gallery",
    summary: "A curated walkthrough.",
    category: "gallery",
    city: "Paris",
    region: "Île-de-France",
    tags: ["art", "gallery"],
    hero_image_url: "https://example.com/hero.jpg",
  },
  showcase_slug: "opera-gallery",
  atlas_entry_id: "22222222-2222-2222-2222-222222222222",
  publish_status: "published",
  deployed_url: "https://frontiers3d-atlas-showcases.netlify.app/opera-gallery/",
});

// ── Runtime comparison ────────────────────────────────────────────────────────

test("U1 — detects a deployed runtime OLDER than current → upgrade_available", () => {
  const s = computeShowcaseRuntimeStatus("2.2.5", "2.2.6");
  assert.equal(s.status, "upgrade_available");
  assert.equal(s.upgradeAvailable, true);
  assert.equal(s.deployedRuntime, "2.2.5");
  assert.equal(s.currentRuntime, "2.2.6");
  // Robust against future bumps: 2.2.5 is older than whatever this build ships.
  assert.equal(computeShowcaseRuntimeStatus("2.2.5", ATLAS_RUNTIME_VERSION).upgradeAvailable, true);
});

test("U2 — hides/disables upgrade when already on the current runtime", () => {
  const s = computeShowcaseRuntimeStatus(ATLAS_RUNTIME_VERSION, ATLAS_RUNTIME_VERSION);
  assert.equal(s.status, "current");
  assert.equal(s.upgradeAvailable, false);
  assert.equal(s.reason, null);
});

test("U3 — a deployed runtime NEWER than this build is ahead_of_build, never a downgrade", () => {
  const s = computeShowcaseRuntimeStatus("9.9.9", "2.2.6");
  assert.equal(s.status, "ahead_of_build");
  assert.equal(s.upgradeAvailable, false);
});

test("U4 — unreadable/missing deployed runtime → unknown, no upgrade claimed", () => {
  assert.equal(computeShowcaseRuntimeStatus(null, "2.2.6").status, "unknown");
  assert.equal(computeShowcaseRuntimeStatus("", "2.2.6").status, "unknown");
  assert.equal(computeShowcaseRuntimeStatus("not-a-version", "2.2.6").status, "unknown");
  assert.equal(computeShowcaseRuntimeStatus("garbage", "2.2.6").upgradeAvailable, false);
});

test("U5 — compareRuntimeVersions is numeric (2.2.10 > 2.2.9), not lexicographic", () => {
  assert.equal(compareRuntimeVersions("2.2.10", "2.2.9"), 1);
  assert.equal(compareRuntimeVersions("2.2.9", "2.2.10"), -1);
  assert.equal(compareRuntimeVersions("2.2.6", "2.2.6"), 0);
  assert.equal(compareRuntimeVersions("3.0.0", "2.9.9"), 1);
  assert.equal(compareRuntimeVersions("2.2.6", "bad"), null);
  assert.deepEqual(parseRuntimeVersion("2.2.6"), [2, 2, 6]);
  assert.equal(parseRuntimeVersion("2.2"), null);
});

// ── Republish guard (Atlas-managed, in-place only) ────────────────────────────

test("U6 — a live published showcase with slug + entry + draft can be republished", () => {
  assert.deepEqual(canRepublishShowcase(publishedJob), { ok: true, reason: null });
  assert.equal(canRepublishShowcase({ ...publishedJob, publish_status: "pending_deploy" }).ok, true);
});

test("U7 — refuses republish when the showcase was never published (no slug)", () => {
  const r = canRepublishShowcase({ ...publishedJob, showcase_slug: "" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /never been published/i);
});

test("U8 — refuses republish unless status is published/pending_deploy", () => {
  for (const publish_status of ["none", "pr_open", "merged", "failed"]) {
    const r = canRepublishShowcase({ ...publishedJob, publish_status });
    assert.equal(r.ok, false, `status ${publish_status} must not be republishable`);
    assert.match(r.reason, /already-published/i);
  }
});

test("U9 — refuses republish when there is no Atlas listing to upgrade in place", () => {
  const r = canRepublishShowcase({ ...publishedJob, atlas_entry_id: null });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no Atlas listing/i);
});

test("U10 — refuses republish without a valid Matterport id or a draft title", () => {
  assert.equal(canRepublishShowcase({ ...publishedJob, extracted_matterport_id: "short" }).ok, false);
  assert.equal(
    canRepublishShowcase({ ...publishedJob, draft_payload: { ...publishedJob.draft_payload, title: "  " } }).ok,
    false,
  );
});

// ── Republish reuses existing curation data + slug; preserves listing/URL ──────

test("U11 — republish reuses the EXISTING slug/folder/path (never derives a new one)", () => {
  assert.equal(resolveRepublishSlug(publishedJob), "opera-gallery");
});

test("U12 — republish input is rebuilt from the stored curation draft (no re-derivation)", () => {
  const input = buildShowcaseInputFromJob(publishedJob);
  assert.equal(input.curationJobId, publishedJob.id);
  assert.equal(input.matterportId, "ABCdef12345");
  assert.equal(input.title, "Opera Gallery");
  assert.equal(input.summary, "A curated walkthrough.");
  assert.equal(input.category, "gallery");
  assert.equal(input.city, "Paris");
  assert.equal(input.region, "Île-de-France");
  assert.deepEqual(input.tags, ["art", "gallery"]);
  assert.equal(input.heroImageUrl, "https://example.com/hero.jpg");
});

test("U13 — republish always stamps the CURRENT runtime into the regenerated package", () => {
  // The generator (buildShowcaseFiles) splices buildRuntimeManifestFields("atlas")
  // into every package, so a republish PR deploys exactly ATLAS_RUNTIME_VERSION.
  const fields = buildRuntimeManifestFields("atlas");
  assert.equal(fields.runtime_version, ATLAS_RUNTIME_VERSION);
  assert.equal(fields.package_family, "atlas");
});

test("U14 — the PR-open job update preserves the live URL + listing until the new deploy verifies", () => {
  const update = buildRepublishJobUpdate({
    slug: "opera-gallery",
    prUrl: "https://github.com/Socialeap/frontiers3d-atlas-showcases/pull/42",
    prNumber: 42,
    branch: "curate/opera-gallery-1718",
  });
  assert.equal(update.publish_status, "pr_open"); // existing Approve & Publish finishes it
  assert.equal(update.showcase_slug, "opera-gallery");
  assert.equal(update.merged_at, null);
  assert.equal(update.publish_error, null);
  // Must NOT detach the live URL or touch the listing / its activation: the
  // existing deployed_url + presentation_url stay attached until verify.
  assert.ok(!("deployed_url" in update), "republish must not clear deployed_url");
  assert.ok(!("presentation_url" in update), "republish must not touch presentation_url");
  assert.ok(!("atlas_entry_id" in update), "republish must not touch the Atlas listing");
  assert.ok(!("status" in update), "republish must not change listing active/inactive status");
});

// ── Downgrade guard (authoritative, server-enforced) ──────────────────────────

test("U19 — the upgrade gate proceeds ONLY when the live runtime is strictly older", () => {
  const older = evaluateRuntimeUpgradeGate("2.2.5", "2.2.6");
  assert.equal(older.ok, true);
  assert.equal(older.status, "upgrade_available");

  const current = evaluateRuntimeUpgradeGate("2.2.6", "2.2.6");
  assert.equal(current.ok, false);
  assert.equal(current.status, "current");
  assert.match(current.reason, /nothing to upgrade/i);

  const ahead = evaluateRuntimeUpgradeGate("9.9.9", "2.2.6");
  assert.equal(ahead.ok, false);
  assert.equal(ahead.status, "ahead_of_build");
  assert.match(ahead.reason, /downgrade/i);

  for (const bad of [null, "", "not-a-version"]) {
    const unknown = evaluateRuntimeUpgradeGate(bad, "2.2.6");
    assert.equal(unknown.ok, false, `gate must reject unverifiable runtime ${JSON.stringify(bad)}`);
    assert.equal(unknown.status, "unknown");
    assert.match(unknown.reason, /couldn'?t confirm/i);
  }
});

test("U20 — republishCuratedShowcase verifies the live runtime BEFORE opening a PR (no downgrade)", () => {
  const src = read("src", "lib", "atlas-curation.functions.ts");
  const start = src.indexOf("export const republishCuratedShowcase");
  assert.ok(start > 0, "republishCuratedShowcase must exist");
  const body = src.slice(start);
  const verifyAt = body.indexOf("verifyDeployedShowcase");
  const gateAt = body.indexOf("evaluateRuntimeUpgradeGate");
  const prAt = body.indexOf("publishShowcasePr");
  assert.ok(verifyAt > 0 && gateAt > 0 && prAt > 0, "verify + gate + PR all present in republish");
  assert.ok(verifyAt < prAt, "must verify the deployed runtime before opening the PR");
  assert.ok(gateAt < prAt, "must evaluate the downgrade gate before opening the PR");
});

// ── Boundary: the single-file patcher still REJECTS family=atlas ───────────────

const ATLAS_DOC = [
  "<!doctype html><html><head>",
  '<meta name="f3d-package-schema" content="2" />',
  '<meta name="f3d-runtime" content="2.2.5" />',
  '<meta name="f3d-capabilities" content="" />',
  '<meta name="f3d-package-family" content="atlas" />',
  "</head><body></body></html>",
].join("\n");

test("U15 — single-file Presentation Upgrade Center still REJECTS an Atlas showcase", () => {
  const r = patchPresentationHtml(ATLAS_DOC, {});
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.ATLAS_MANAGED);
  assert.equal(r.html, null, "a rejected atlas file is never patched/mutated");
});

test("U16 — the atlas_managed rejection points the admin to Atlas Curation → Upgrade runtime", () => {
  const insp = inspectPresentationHtml(ATLAS_DOC);
  assert.equal(insp.outcome, "atlas_managed");
  const d = describeDisposition(insp);
  assert.equal(d.canUpgrade, false);
  assert.equal(
    d.guidance,
    "This is an Atlas-managed showcase. Use Admin → Atlas Curation → Upgrade runtime / Republish showcase.",
  );
});

// ── Boundary: no GitHub/Netlify secret reaches the client through new code ─────

test("U17 — the upgrade helper is pure: no secrets, env, or network access", () => {
  const src = codeOnly(read("src", "lib", "atlas-runtime-upgrade.mjs"));
  for (const forbidden of [/process\.env/, /\bfetch\s*\(/, /GITHUB/i, /NETLIFY/i, /token/i]) {
    assert.ok(!forbidden.test(src), `helper must not contain ${forbidden}`);
  }
});

test("U18 — the secret-bearing showcase-publish module is referenced only via dynamic import", () => {
  const src = codeOnly(read("src", "lib", "atlas-curation.functions.ts"));
  // No top-level/static import that would bundle the server-only (token-bearing)
  // module into a client chunk — it must be `await import(...)` inside handlers.
  assert.ok(
    !/^\s*import[^\n]*from\s*["']\.\/atlas-showcase-publish["']/m.test(src),
    "atlas-showcase-publish must not be statically imported",
  );
  assert.match(src, /await import\(["']\.\/atlas-showcase-publish["']\)/);
});
