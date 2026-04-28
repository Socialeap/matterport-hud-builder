#!/usr/bin/env node
/**
 * Build-time guard for the generated portal HTML.
 *
 * Why this exists:
 *   src/lib/portal.functions.ts builds the entire end-product HTML inside one
 *   giant TS template literal that begins around `const html = \`<!DOCTYPE html>.
 *   Any single backslash inside that literal that should have been doubled
 *   silently corrupts the emitted runtime JavaScript. The generated file looks
 *   fine to eyeball, but the embedded <script> blocks throw `SyntaxError` on
 *   load, which kills the gate buttons and the iframe in the downloaded .html.
 *
 *   We have hit this bug class twice. This script is the durable guard.
 *
 * What it does:
 *   1. Reads src/lib/portal.functions.ts as text (no execution, no bundling).
 *   2. Locates the `const html = \`<!DOCTYPE html>` template literal.
 *   3. Walks the literal body and flags any backslash escape that is not
 *      itself escaped. Inside this template literal, every backslash that
 *      should appear in the emitted JS must be written as `\\` in source.
 *   4. Allows a small set of intentional escapes (e.g. `\${` for literal
 *      dollar braces, `\`` for literal backticks, and `\\` itself).
 *   5. Exits with a non-zero code and a precise line:col + line preview
 *      when a single-backslash escape is found.
 *
 * Run via:   node scripts/verify-portal-html.mjs
 * Or via:    npm run verify:html
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleFromSources,
  findForbiddenTokens,
  stripExports,
} from "../src/lib/portal/ask-runtime-transformer.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const TARGET = path.join(ROOT, "src/lib/portal.functions.ts");
const ASK_SOURCES = [
  path.join(ROOT, "src/lib/portal/ask-intents.mjs"),
  path.join(ROOT, "src/lib/portal/property-brain.mjs"),
  path.join(ROOT, "src/lib/portal/ask-runtime-logic.mjs"),
];
const LIVE_SESSION_SOURCE = path.join(
  ROOT,
  "src/lib/portal/live-session.mjs",
);

// Escapes that are legal/intentional in a TS template literal and that we
// do NOT want to flag:
//   \\   — already a doubled backslash (the correct form)
//   \`   — literal backtick inside the template
//   \${  — literal dollar-brace inside the template
//   \xNN, \uNNNN, \u{NNNN} — Unicode/byte escapes we want to keep as-is
const ALLOWED_NEXT = new Set([
  "\\", // \\
  "`",  // \`
  "$",  // \${ or \$ (we'll let the next char decide; \$ alone is fine)
  "x",  // \xNN
  "u",  // \uNNNN or \u{...}
  "0",  // \0 (NUL) — allowed; rare in our template
]);

function readSource() {
  if (!fs.existsSync(TARGET)) {
    console.error(`[verify-html] Source not found: ${TARGET}`);
    process.exit(2);
  }
  return fs.readFileSync(TARGET, "utf8");
}

function findTemplateLiteral(src) {
  // Anchor on the literal start that introduces the HTML body.
  const marker = "const html = `<!DOCTYPE html";
  const start = src.indexOf(marker);
  if (start === -1) {
    console.error(
      "[verify-html] Could not locate the `const html = \\`<!DOCTYPE html>` template literal.",
    );
    console.error(
      "[verify-html] If portal.functions.ts was restructured, update this script's marker.",
    );
    process.exit(2);
  }
  const bodyStart = src.indexOf("`", start) + 1;

  // Walk forward, skipping `${...}` interpolations and escaped chars, until
  // we hit the closing unescaped backtick.
  let i = bodyStart;
  let depth = 0; // ${ depth — we don't scan inside interpolations
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (depth === 0 && ch === "`") {
      return { start: bodyStart, end: i };
    }
    if (ch === "$" && src[i + 1] === "{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0 && ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth > 0 && ch === "{") {
      depth += 1;
    }
    i += 1;
  }
  console.error("[verify-html] Reached end of file without finding template close.");
  process.exit(2);
}

function lineColOf(src, offset) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset; i++) {
    if (src[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function scanLiteral(src, start, end) {
  const offenders = [];
  let i = start;
  let depth = 0;
  while (i < end) {
    const ch = src[i];
    if (ch === "$" && src[i + 1] === "{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0 && ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth > 0 && ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (!ALLOWED_NEXT.has(next)) {
        offenders.push({ offset: i, next });
      }
      // Skip the escape pair regardless — we don't want to double-count.
      i += 2;
      continue;
    }
    i += 1;
  }
  return offenders;
}

function previewLine(src, offset) {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = src.indexOf("\n", offset);
  return src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
}

function verifyAskRuntimeModules() {
  // Anti-drift gate: the three .mjs modules are read verbatim at build
  // time and concatenated into the browser IIFE. If any `import`,
  // `require`, `export`, or TS-specific syntax sneaks in, the generated
  // HTML will throw at runtime. Scan the assembled output and fail the
  // build before shipping.
  const sources = ASK_SOURCES.map((p) => {
    if (!fs.existsSync(p)) {
      console.error(`[verify-html] Ask runtime source not found: ${p}`);
      process.exit(2);
    }
    return fs.readFileSync(p, "utf8");
  });
  const assembled = assembleFromSources(sources[0], sources[1], sources[2]);
  const offenders = findForbiddenTokens(assembled);
  if (offenders.length > 0) {
    console.error(
      `[verify-html] ❌ Ask runtime .mjs modules contain browser-incompatible syntax.`,
    );
    console.error(
      `[verify-html] The .mjs files in src/lib/portal/ must use ONLY plain JS:`,
    );
    console.error(
      `[verify-html]   - no import / require statements`,
    );
    console.error(
      `[verify-html]   - no export statements other than a single final \`export { ... };\``,
    );
    console.error(
      `[verify-html]   - no TypeScript syntax (annotations, interfaces, \`as\` casts)`,
    );
    for (const o of offenders) console.error(`    ${o}`);
    process.exit(1);
  }
  console.log(
    `[verify-html] ✅ Ask runtime modules are browser-safe (${assembled.length} chars assembled).`,
  );
}

/**
 * Catch the bug class where ${...} appears inside a // line comment
 * within the html template literal. Template literals always evaluate
 * ${...}, even inside // comments, which silently double-injects code
 * (we hit this with ${ASK_RUNTIME_JS} inlining the entire 40 KB Ask
 * runtime a second time, which left a stray `.` and broke the IIFE).
 *
 * Allowed escape: `\${...}` — author opted out by escaping the dollar.
 */
function scanCommentInterpolations(src, start, end) {
  const offenders = [];
  let i = start;
  let depth = 0;
  while (i < end) {
    const ch = src[i];
    if (ch === "\\") { i += 2; continue; }
    if (ch === "$" && src[i + 1] === "{") { depth += 1; i += 2; continue; }
    if (depth > 0 && ch === "}") { depth -= 1; i += 1; continue; }
    if (depth > 0 && ch === "{") { depth += 1; i += 1; continue; }
    if (depth > 0) { i += 1; continue; }
    // Detect "//" line comment start at column 0 of a logical line.
    if (ch === "/" && src[i + 1] === "/") {
      const lineEnd = src.indexOf("\n", i);
      const stop = lineEnd === -1 ? end : lineEnd;
      // Scan the comment text for an unescaped ${.
      for (let j = i; j < stop - 1; j++) {
        if (src[j] === "\\" && src[j + 1] === "$") { j += 1; continue; }
        if (src[j] === "$" && src[j + 1] === "{") {
          offenders.push({ offset: j });
          break;
        }
      }
      i = stop;
      continue;
    }
    i += 1;
  }
  return offenders;
}

/**
 * Parse-test the assembled Ask runtime as a standalone script. Catches
 * any JS syntax issue introduced by the .mjs modules before it reaches
 * the generated HTML.
 */
function parseAskRuntime() {
  const sources = ASK_SOURCES.map((p) => fs.readFileSync(p, "utf8"));
  const assembled = assembleFromSources(sources[0], sources[1], sources[2]);
  try {
    // eslint-disable-next-line no-new-func
    new Function(assembled);
    console.log(`[verify-html] ✅ Assembled Ask runtime parses cleanly.`);
  } catch (err) {
    console.error(`[verify-html] ❌ Assembled Ask runtime failed to parse: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Same anti-drift gate for the Live Guided Tour runtime. The .mjs
 * follows the same browser-safety rules as the Ask modules (no
 * imports, no TS syntax, no leftover exports beyond the trailing
 * block stripped at injection time).
 */
function verifyLiveSessionRuntime() {
  if (!fs.existsSync(LIVE_SESSION_SOURCE)) {
    console.error(`[verify-html] Live session source not found: ${LIVE_SESSION_SOURCE}`);
    process.exit(2);
  }
  const raw = fs.readFileSync(LIVE_SESSION_SOURCE, "utf8");
  const stripped = stripExports(raw);
  const offenders = findForbiddenTokens(stripped);
  if (offenders.length > 0) {
    console.error(
      `[verify-html] ❌ live-session.mjs contains browser-incompatible syntax:`,
    );
    for (const o of offenders) console.error(`    ${o}`);
    process.exit(1);
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function(stripped);
    console.log(
      `[verify-html] ✅ Live session runtime is browser-safe and parses cleanly (${stripped.length} chars).`,
    );
  } catch (err) {
    console.error(`[verify-html] ❌ live-session.mjs failed to parse: ${err.message}`);
    process.exit(1);
  }
}

function assertRequiredStartupTokens(src) {
  const required = [
    'id="gate-sound-btn"',
    'id="gate-silent-btn"',
    'id="matterport-frame"',
    "frame.src=props[0].iframeUrl",
    "[presentation] safety bootstrap failed",
  ];
  const missing = required.filter((t) => !src.includes(t));
  if (missing.length) {
    console.error("[verify-html] ❌ Generated HTML template is missing critical startup tokens:");
    for (const m of missing) console.error("    " + m);
    process.exit(1);
  }
  console.log(`[verify-html] ✅ All critical startup tokens present in template.`);
}

function assertHudGateStartsClosed(src) {
  const required = [
    "hideGate(false)",
    "setHudVisible(false);",
  ];
  const missing = required.filter((t) => !src.includes(t));
  if (missing.length) {
    console.error("[verify-html] ❌ HUD gate dismissal must leave the HUD closed:");
    for (const m of missing) console.error("    missing " + m);
    process.exit(1);
  }
  if (src.includes("hideGate(true)")) {
    console.error("[verify-html] ❌ Safety bootstrap still opens the HUD from the gate.");
    process.exit(1);
  }
  console.log(`[verify-html] ✅ Gate dismissal leaves HUD closed until toggled.`);
}

/**
 * Extract the inline runtime IIFE from the HTML template literal in
 * portal.functions.ts and parse it as JavaScript. The IIFE itself is
 * a `<script>(function(){ ... })();</script>` block; we strip the
 * wrapping `<script>`/`</script>` tags and replace TS template
 * interpolations (`${ASK_RUNTIME_JS}`, `${LIVE_SESSION_RUNTIME_JS}`,
 * and ad-hoc expressions like `${escapeHtml(accentColor)}` or
 * `${configB64}`) with safe placeholder values so the parser only
 * complains about real syntax errors in the hand-written runtime
 * code — the part most prone to regressions when phases extend it.
 *
 * This is the targeted coverage that catches mistakes in code we
 * write inside the giant template literal (e.g. mismatched braces,
 * unterminated regex, stray TS syntax) before they reach a browser.
 */
function parseRuntimeIIFE(src) {
  // Anchor on the second runtime <script> tag — the first one is the
  // pre-bootstrap safety net. The main IIFE is everything between
  // `<script>` after the safety net's closing `</script>` and the
  // outermost `})();</script>` that closes the body's runtime.
  const safetyClose = src.indexOf(`} catch(err){ console.error("[presentation] safety bootstrap failed",err); }\n})();\n</script>`);
  if (safetyClose === -1) {
    console.error("[verify-html] Could not locate the safety-bootstrap closer.");
    process.exit(2);
  }
  const mainStart = src.indexOf("<script>", safetyClose);
  if (mainStart === -1) {
    console.error("[verify-html] Could not locate the main runtime <script> tag.");
    process.exit(2);
  }
  const bodyStart = mainStart + "<script>".length;
  const closingScript = src.indexOf("</script>\n</body>", bodyStart);
  if (closingScript === -1) {
    console.error("[verify-html] Could not locate the closing </script></body>.");
    process.exit(2);
  }
  let body = src.slice(bodyStart, closingScript);

  // Replace all `${...}` template interpolations with safe placeholders
  // so the parser sees concrete JS, not template-literal syntax. We
  // can't simply blank them out because some are used as expressions
  // (e.g. `var s=${JSON.stringify(x)};` becomes `var s=null;`).
  // Walk forward, tracking nesting depth so we handle ${ JSON.stringify({}) }
  // correctly. Anything inside a `${...}` becomes the literal string
  // "null" — a valid JS expression in every position our template uses.
  let out = "";
  let i = 0;
  while (i < body.length) {
    if (body[i] === "$" && body[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === "{") depth += 1;
        else if (body[i] === "}") depth -= 1;
        if (depth === 0) break;
        i += 1;
      }
      i += 1; // consume the closing }
      out += "null";
      continue;
    }
    // Unescape \${ → ${, \\ → \, \` → ` (these are TS-template escapes
    // that end up as literal characters in the runtime).
    if (body[i] === "\\" && (body[i + 1] === "$" || body[i + 1] === "`" || body[i + 1] === "\\")) {
      out += body[i + 1];
      i += 2;
      continue;
    }
    out += body[i];
    i += 1;
  }

  try {
    new Function(out);
    console.log(
      `[verify-html] ✅ Inline runtime IIFE parses cleanly (${out.length} chars after interpolation).`,
    );
  } catch (err) {
    console.error(
      `[verify-html] ❌ Inline runtime IIFE failed to parse: ${err.message}`,
    );
    // Try to report a useful line number by re-running the parse with
    // `new vm.Script` if available, otherwise fall back to the message.
    process.exit(1);
  }
}

function main() {
  verifyAskRuntimeModules();
  parseAskRuntime();
  verifyLiveSessionRuntime();

  const src = readSource();
  const { start, end } = findTemplateLiteral(src);
  const offenders = scanLiteral(src, start, end);
  const commentOffenders = scanCommentInterpolations(src, start, end);

  assertRequiredStartupTokens(src);
  assertHudGateStartsClosed(src);
  parseRuntimeIIFE(src);

  if (offenders.length === 0 && commentOffenders.length === 0) {
    console.log(
      `[verify-html] ✅ No risky single-backslash escapes or comment-embedded interpolations ` +
        `(${end - start} chars scanned).`,
    );
    return;
  }

  if (commentOffenders.length > 0) {
    console.error(
      `[verify-html] ❌ Found ${commentOffenders.length} \${...} interpolation(s) inside // comments in the portal HTML template.`,
    );
    console.error(
      `[verify-html] Template literals evaluate \${...} even inside // comments. This can silently re-inject large blocks (e.g. ASK_RUNTIME_JS) and corrupt the script.`,
    );
    console.error(
      `[verify-html] Fix by escaping as \\\${...} or rewording the comment so it doesn't reference an interpolation.`,
    );
    for (const off of commentOffenders) {
      const { line, col } = lineColOf(src, off.offset);
      const preview = previewLine(src, off.offset);
      console.error(`\n  src/lib/portal.functions.ts:${line}:${col}`);
      console.error(`    ${preview}`);
    }
  }

  if (offenders.length > 0) {
    console.error(
      `[verify-html] ❌ Found ${offenders.length} single-backslash escape(s) in the portal HTML template.`,
    );
    console.error(
      "[verify-html] Inside this template literal, every \\X meant to reach the runtime JS must be written as \\\\X.",
    );
    for (const off of offenders) {
      const { line, col } = lineColOf(src, off.offset);
      const preview = previewLine(src, off.offset);
      console.error(`\n  src/lib/portal.functions.ts:${line}:${col}  (\\${off.next})`);
      console.error(`    ${preview}`);
      console.error(`    ${" ".repeat(Math.max(0, col - 1))}^`);
    }
  }

  console.error(
    `\n[verify-html] FAILED — fix the issues above. These are the same bug classes as the previous "iframe never loads / Start button dead" regressions.`,
  );
  process.exit(1);
}

main();
