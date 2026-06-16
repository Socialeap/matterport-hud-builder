#!/usr/bin/env node

// Source protection (PR #172 review finding 2): assertDistinctOutputPath must
// reject any destination that aliases the input — identical/normalized/resolved
// paths, symlinks, hardlinks (same device+inode), and symlinked parent dirs —
// BEFORE anything is written, and the source bytes must never change. Uses a real
// temp directory; each alias is created on disk and proven to be rejected.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync, writeFileSync, readFileSync, symlinkSync, linkSync, rmSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { assertDistinctOutputPath, OutputAliasError } from "../scripts/lib/safe-output-path.mjs";

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

function sandbox() {
  // realpath the temp dir: on macOS /var/folders → /private/var/folders, and the
  // guard returns symlink-resolved paths, so expectations compare against realDir.
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "safe-out-")));
  const src = path.join(dir, "input.html");
  writeFileSync(src, "<html>SOURCE CONTENT</html>");
  return { dir, src, srcSha: sha(src), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// Each alias form must throw with the documented code, and the source is untouched.
function expectAlias(src, srcSha, out, code) {
  assert.throws(
    () => assertDistinctOutputPath(src, out),
    (err) => err instanceof OutputAliasError && err.code === code,
    `expected OutputAliasError(${code}) for ${out}`,
  );
  assert.equal(sha(src), srcSha, "source bytes must be unchanged after rejection");
}

test("rejects an identical path", () => {
  const s = sandbox();
  try { expectAlias(s.src, s.srcSha, s.src, "alias_same_path"); } finally { s.cleanup(); }
});

test("rejects a normalized-equal path (./x/../input.html)", () => {
  const s = sandbox();
  try {
    const weird = path.join(s.dir, "sub", "..", "input.html");
    expectAlias(s.src, s.srcSha, weird, "alias_same_path");
  } finally { s.cleanup(); }
});

test("rejects a symlink pointing at the input", () => {
  const s = sandbox();
  try {
    const link = path.join(s.dir, "out-link.html");
    symlinkSync(s.src, link);
    expectAlias(s.src, s.srcSha, link, "alias_resolves_to_input");
  } finally { s.cleanup(); }
});

test("rejects a hardlink to the input (same device+inode)", () => {
  const s = sandbox();
  try {
    const hard = path.join(s.dir, "out-hard.html");
    linkSync(s.src, hard);
    expectAlias(s.src, s.srcSha, hard, "alias_same_inode");
  } finally { s.cleanup(); }
});

test("rejects an output inside a symlinked parent that resolves to the input", () => {
  const s = sandbox();
  try {
    // A symlinked directory whose realpath is the input's directory; the proposed
    // output basename matches the input → resolves back onto the input file.
    const linkedDir = path.join(s.dir, "linkdir");
    symlinkSync(s.dir, linkedDir);
    const through = path.join(linkedDir, "input.html");
    expectAlias(s.src, s.srcSha, through, "alias_resolves_to_input");
  } finally { s.cleanup(); }
});

test("allows a genuinely distinct output (returns a resolved path)", () => {
  const s = sandbox();
  try {
    const out = path.join(s.dir, "output.html");
    const resolved = assertDistinctOutputPath(s.src, out);
    assert.equal(resolved, out);
    assert.equal(sha(s.src), s.srcSha, "guard never writes");
  } finally { s.cleanup(); }
});

test("allows a distinct output even inside a symlinked parent (different basename)", () => {
  const s = sandbox();
  try {
    const linkedDir = path.join(s.dir, "linkdir2");
    symlinkSync(s.dir, linkedDir);
    const out = path.join(linkedDir, "different.html");
    const resolved = assertDistinctOutputPath(s.src, out);
    // Resolves through the symlinked parent to the real directory.
    assert.equal(resolved, path.join(s.dir, "different.html"));
  } finally { s.cleanup(); }
});

test("rejects a missing input before any write decision", () => {
  const s = sandbox();
  try {
    const missing = path.join(s.dir, "does-not-exist.html");
    assert.throws(
      () => assertDistinctOutputPath(missing, path.join(s.dir, "out.html")),
      (err) => err instanceof OutputAliasError && err.code === "input_not_found",
    );
  } finally { s.cleanup(); }
});
