/**
 * Netlify publish naming regression tests.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  NETLIFY_SLUG_REGEX,
  buildFallbackNetlifySlugs,
  isRecoverableNetlifyNameConflict,
} = await import("../src/lib/portal/netlify-name.ts");

test("Netlify subdomain uniqueness errors are recoverable conflicts", () => {
  assert.equal(
    isRecoverableNetlifyNameConflict(422, JSON.stringify({ errors: { subdomain: ["must be unique"] } })),
    true,
  );
});

test("Netlify taken-name errors are recoverable conflicts", () => {
  assert.equal(isRecoverableNetlifyNameConflict(409, "Name has already been taken"), true);
});

test("unrelated Netlify validation errors are not name conflicts", () => {
  assert.equal(isRecoverableNetlifyNameConflict(422, JSON.stringify({ errors: { repo: ["is invalid"] } })), false);
  assert.equal(isRecoverableNetlifyNameConflict(500, "subdomain must be unique"), false);
});

test("fallback Netlify slugs keep the requested base and remain valid", () => {
  const slugs = buildFallbackNetlifySlugs("sample3dps", 3);
  assert.equal(slugs.length, 3);
  for (const slug of slugs) {
    assert.match(slug, /^sample3dps-[a-z0-9]+$/);
    assert.equal(NETLIFY_SLUG_REGEX.test(slug), true);
    assert.ok(slug.length <= 63);
  }
});

test("fallback Netlify slugs trim long bases before adding suffix", () => {
  const [slug] = buildFallbackNetlifySlugs("a".repeat(63), 1);
  assert.equal(NETLIFY_SLUG_REGEX.test(slug), true);
  assert.ok(slug.length <= 63);
  assert.match(slug, /^a+-[a-z0-9]+$/);
});