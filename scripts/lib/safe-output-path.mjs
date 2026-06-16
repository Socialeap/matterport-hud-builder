// Source-protection guard for tools that read an input file and write a SEPARATE
// output file (the legacy-bootstrap acceptance runner and the fixture sanitizer).
//
// Before any destination is opened or truncated, prove it cannot alias the input
// through ANY of these channels:
//   1. identical normalized paths (`./a/../in.html` === `in.html`);
//   2. identical resolved real paths (a symlinked destination → the input);
//   3. a destination whose existing inode shares device+inode with the input
//      (a hardlink — different path, same bytes on disk);
//   4. a symlinked PARENT directory that resolves the destination back onto the
//      input (realpath the dir that WILL hold the output, then re-join basename).
//
// Pure + side-effect-free: it NEVER writes. It throws an Error (with a stable
// `.code`) on any alias, or returns the validated, resolved destination path.
// Callers must invoke it BEFORE writeFileSync so the input is never overwritten.

import { realpathSync, statSync } from "node:fs";
import path from "node:path";

class OutputAliasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OutputAliasError";
    this.code = code;
  }
}

// Resolve the deepest existing ancestor of `p` to its real path, then re-append
// the not-yet-existing tail. This collapses symlinks anywhere in the parent
// chain even when the final file does not exist yet.
function resolveThroughExisting(p) {
  const abs = path.resolve(p);
  let head = abs;
  const tail = [];
  // Walk up until we hit a path that exists (realpath succeeds).
  for (;;) {
    try {
      const real = realpathSync(head);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return abs; // reached filesystem root; nothing resolved
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

// Throws OutputAliasError if `outputPath` aliases `inputPath` in any form;
// otherwise returns the absolute, symlink-resolved destination path.
export function assertDistinctOutputPath(inputPath, outputPath) {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new OutputAliasError("input_path_invalid", "input path must be a non-empty string");
  }
  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new OutputAliasError("output_path_invalid", "output path must be a non-empty string");
  }

  // The input MUST exist (we are about to read it) — resolve its real path.
  let inputReal;
  try {
    inputReal = realpathSync(path.resolve(inputPath));
  } catch {
    throw new OutputAliasError("input_not_found", `input not found: ${inputPath}`);
  }

  // 1. Identical normalized paths.
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    throw new OutputAliasError("alias_same_path", "output path is the same as the input path");
  }

  // 2 + 4. Resolved real path (symlinked file OR symlinked parent chain) === input.
  const outputReal = resolveThroughExisting(outputPath);
  if (outputReal === inputReal) {
    throw new OutputAliasError("alias_resolves_to_input", "output path resolves (via symlink) to the input file");
  }

  // 3. Existing destination that is a hardlink to the input (same device+inode).
  try {
    const inStat = statSync(inputReal);
    const outStat = statSync(outputReal); // throws if the destination does not exist yet
    if (inStat.dev === outStat.dev && inStat.ino === outStat.ino) {
      throw new OutputAliasError("alias_same_inode", "output path shares the input's device+inode (hardlink)");
    }
  } catch (err) {
    if (err instanceof OutputAliasError) throw err;
    // Destination does not exist yet → no inode to collide; that is fine.
  }

  return outputReal;
}

export { OutputAliasError };
