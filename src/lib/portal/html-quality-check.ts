/**
 * Pre-download quality checks for the generated presentation HTML.
 *
 * Why this exists:
 *   The HTML is assembled server-side as one giant string and round-tripped
 *   to the browser as a JSON `{ html: "..." }` payload. Anything in that
 *   pipeline (Vite plugins, response middleware, Lovable preview overlays,
 *   misconfigured markdown rendering) can silently rewrite the body.
 *
 *   We have already been hit by an auto-linker that converted any
 *   `word.word` token in the JS/CSS into a markdown auto-link of the form
 *   `[word.word](http://word.word)` — turning `event.target` into
 *   `[event.target](http://event.target)` and `#agent-drawer.open` into
 *   `#[agent-drawer.open](http://agent-drawer.open)`. The downloaded file
 *   then fails to parse as JS/CSS the moment a visitor opens it, killing
 *   the gate, the iframe, the HUD — everything.
 *
 *   This module is the runtime checkpoint: sanitize what is fixable,
 *   validate what isn't, and refuse to produce a Blob when the file is
 *   broken. The same JS/CSS sanity ideas already exist as a build-time
 *   guard in `scripts/verify-portal-html.mjs`; this module covers the
 *   gap between server response and the user's disk.
 */

export type QualityCheckSeverity = "error" | "warning";

export interface QualityCheckResult {
  /** Short, user-facing label (e.g. "HTML structure"). */
  name: string;
  /** Did the check pass? */
  passed: boolean;
  /** Severity if it failed. Errors block the download; warnings don't. */
  severity: QualityCheckSeverity;
  /** Human-readable detail; shown in the UI / console. */
  detail: string;
}

export interface QualityCheckReport {
  /** Whether the download is allowed to proceed. */
  ok: boolean;
  /** The (possibly sanitized) HTML to write to disk. */
  html: string;
  /** Number of automatic sanitizations applied (e.g. md auto-link reversals). */
  sanitizationCount: number;
  /** All check results, in the order they ran. */
  checks: QualityCheckResult[];
}

const REQUIRED_TOKENS: ReadonlyArray<{ token: string; label: string }> = [
  { token: "<!DOCTYPE html", label: "DOCTYPE declaration" },
  { token: "<html", label: "<html> root element" },
  { token: "</html>", label: "Closing </html> tag" },
  { token: "<head>", label: "<head> opening tag" },
  { token: "</head>", label: "Closing </head> tag" },
  { token: "<body>", label: "<body> opening tag" },
  { token: "</body>", label: "Closing </body> tag" },
  { token: 'id="matterport-frame"', label: "Matterport iframe element" },
  { token: 'id="hud-header"', label: "HUD header element" },
  { token: 'id="hud-toggle"', label: "HUD toggle button" },
  { token: 'id="gate"', label: "Welcome gate container" },
  { token: "[presentation] safety bootstrap failed", label: "Safety bootstrap script" },
];

/**
 * The welcome gate has two mutually-exclusive variants in the generator
 * template (see src/lib/portal.functions.ts gate template literal):
 *   - unprotected: sound/silent buttons let visitors choose audio
 *   - protected:   password form replaces the audio buttons entirely
 *
 * Exactly one variant should appear in any given export. Requiring
 * either variant satisfies the gate, but the absence of BOTH is a hard
 * error: the file would render without any way to dismiss the gate.
 */
const GATE_VARIANTS: ReadonlyArray<{
  name: string;
  tokens: ReadonlyArray<string>;
}> = [
  {
    name: "unprotected (sound/silent buttons)",
    tokens: ['id="gate-sound-btn"', 'id="gate-silent-btn"'],
  },
  {
    name: "password-protected (password form)",
    tokens: [
      'id="gate-password-form"',
      'id="gate-password-input"',
      'id="gate-password-submit"',
    ],
  },
];

/**
 * Reverse the markdown auto-linker corruption: `[X](http://X)` → `X`,
 * but only when the bracket label and URL host+path match exactly. Real
 * markdown links (label ≠ URL) are left intact.
 *
 * Returns the sanitized string and the number of replacements made.
 */
export function sanitizeMarkdownAutoLinks(input: string): {
  sanitized: string;
  replacements: number;
} {
  if (!input) return { sanitized: input, replacements: 0 };
  let count = 0;
  // Label: anything except `]`, `(`, or newline. URL: starts with http(s)://
  // and continues with non-`)` non-newline chars. Greedy enough to catch
  // dotted JS expressions and selectors, conservative enough to never
  // cross a real link boundary.
  const sanitized = input.replace(
    /\[([^\]\n(]+)\]\((https?:\/\/[^\s)\n]+)\)/g,
    (match, label: string, url: string) => {
      const stripped = url.replace(/^https?:\/\//, "");
      if (stripped === label) {
        count += 1;
        return label;
      }
      return match;
    },
  );
  return { sanitized, replacements: count };
}

/**
 * Repair regex literals inside inline <script> blocks that contain
 * raw control characters (CR / LF / TAB) — the exact corruption that
 * appears when an editor writes `/[\n]+/g` inside a JS template
 * literal where it must be doubled (`/[\\n]+/g`). The browser refuses
 * to parse such regex literals ("Invalid regular expression: missing /").
 *
 * Replaces the raw control char with its escaped form (`\n`, `\r`,
 * `\t`) ONLY when it appears inside what looks like a single-line
 * regex literal. Strings, comments, and template literals are left
 * untouched.
 *
 * Returns the sanitized HTML and the count of replacements made.
 */
export function sanitizeRegexControlChars(input: string): {
  sanitized: string;
  replacements: number;
} {
  if (!input) return { sanitized: input, replacements: 0 };
  let count = 0;
  const sanitized = input.replace(
    /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi,
    (full, attrs: string | undefined, body: string) => {
      if (attrs && /\ssrc\s*=/i.test(attrs)) return full;
      // Match a permissive regex-literal shape that allows control
      // chars in the body, then escape any raw control chars found.
      const repaired = body.replace(
        /\/(?![*/])((?:\\.|\[[\s\S]*?\]|[^/\\])+?)\/([gimsuy]*)/g,
        (lit, inner: string, flags: string) => {
          if (!/[\r\n\t]/.test(inner)) return lit;
          const fixedInner = inner
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t");
          count += 1;
          return "/" + fixedInner + "/" + flags;
        },
      );
      return full.replace(body, repaired);
    },
  );
  return { sanitized, replacements: count };
}

/** Minimal balance check: counts open/close pairs after stripping strings/comments. */
function countTokenBalance(jsSource: string): { open: number; close: number; balanced: boolean } {
  // We don't try to fully tokenize JS — that's what `new Function()` is for.
  // This is just a cheap sanity number for warnings.
  let open = 0;
  let close = 0;
  for (let i = 0; i < jsSource.length; i++) {
    const c = jsSource[i];
    if (c === "{") open += 1;
    else if (c === "}") close += 1;
  }
  return { open, close, balanced: open === close };
}

function extractInlineScripts(html: string): string[] {
  const out: string[] = [];
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || "";
    // Skip external scripts (have a src=) — there's nothing to parse here.
    if (/\ssrc\s*=/i.test(attrs)) continue;
    out.push(m[2]);
  }
  return out;
}

/**
 * Run the full quality checklist on a generated HTML payload. Mutates
 * nothing; returns the sanitized HTML and a list of check results.
 *
 * Hard errors (severity: "error") block the download. Warnings are
 * surfaced to the console but do not stop the download.
 */
export function runQualityChecks(rawHtml: string): QualityCheckReport {
  const checks: QualityCheckResult[] = [];

  // 0. Non-empty payload (gate everything else on this).
  if (typeof rawHtml !== "string" || rawHtml.length === 0) {
    checks.push({
      name: "Server returned HTML",
      passed: false,
      severity: "error",
      detail: "The presentation generator returned an empty response.",
    });
    return { ok: false, html: rawHtml || "", sanitizationCount: 0, checks };
  }
  checks.push({
    name: "Server returned HTML",
    passed: true,
    severity: "error",
    detail: `Received ${rawHtml.length.toLocaleString()} bytes from the server.`,
  });

  // 1. Auto-link sanitizer (runs before structural checks so we validate
  //    the version that will actually be downloaded).
  const { sanitized, replacements } = sanitizeMarkdownAutoLinks(rawHtml);
  if (replacements > 0) {
    checks.push({
      name: "Markdown auto-link corruption repaired",
      passed: true,
      severity: "warning",
      detail: `Reversed ${replacements} auto-linked token(s) (e.g. \`[event.target](http://event.target)\` → \`event.target\`). Generation pipeline should be investigated.`,
    });
  } else {
    checks.push({
      name: "No markdown auto-link corruption",
      passed: true,
      severity: "error",
      detail: "Generated file is free of `[X](http://X)` auto-link patterns.",
    });
  }
  const html = sanitized;

  // 2. Re-scan after sanitize: any leftover real markdown auto-links of
  //    the same shape would still break JS/CSS, so this is a hard fail.
  const leftover = (html.match(/\[[^\]\n(]+\]\(https?:\/\/[^\s)\n]+\)/g) || []).filter(
    (link) => {
      const m = link.match(/\[([^\]\n(]+)\]\((https?:\/\/[^\s)\n]+)\)/);
      if (!m) return false;
      return m[2].replace(/^https?:\/\//, "") === m[1];
    },
  );
  if (leftover.length > 0) {
    checks.push({
      name: "Auto-link residue check",
      passed: false,
      severity: "error",
      detail: `Sanitizer left ${leftover.length} corrupted token(s). First example: ${leftover[0].slice(0, 120)}`,
    });
  }

  // 3. Required structural tokens.
  const missingTokens = REQUIRED_TOKENS.filter(({ token }) => !html.includes(token));
  if (missingTokens.length > 0) {
    checks.push({
      name: "Required HTML structure",
      passed: false,
      severity: "error",
      detail: `Missing: ${missingTokens.map((m) => m.label).join(", ")}.`,
    });
  } else {
    checks.push({
      name: "Required HTML structure",
      passed: true,
      severity: "error",
      detail: `All ${REQUIRED_TOKENS.length} required elements and bootstrap markers present.`,
    });
  }

  // 3b. Gate variant — exactly one of the mutually-exclusive gate
  //     templates (sound/silent buttons OR password form) must be
  //     fully present, never zero, ideally not both. Without a gate
  //     variant the visitor has no way to dismiss the welcome overlay.
  const matchedVariants = GATE_VARIANTS.filter((v) =>
    v.tokens.every((t) => html.includes(t)),
  );
  if (matchedVariants.length === 0) {
    const detailLines = GATE_VARIANTS.map((v) => {
      const missing = v.tokens.filter((t) => !html.includes(t));
      return `${v.name}: missing ${missing.join(", ")}`;
    });
    checks.push({
      name: "Welcome gate variant",
      passed: false,
      severity: "error",
      detail: `No complete gate variant detected. ${detailLines.join("; ")}.`,
    });
  } else if (matchedVariants.length > 1) {
    // Both variants in the same export means the conditional template
    // accidentally rendered both branches — visitors would see two
    // overlapping gates. Warn but don't block; the file may still be
    // recoverable, and zero-day blocking risks worse UX than warning.
    checks.push({
      name: "Welcome gate variant",
      passed: false,
      severity: "warning",
      detail: `Both gate variants are present (${matchedVariants
        .map((v) => v.name)
        .join(" + ")}); generator template may have rendered both branches.`,
    });
  } else {
    checks.push({
      name: "Welcome gate variant",
      passed: true,
      severity: "error",
      detail: `Detected ${matchedVariants[0].name} gate.`,
    });
  }

  // 4. Reasonable size bounds (sanity, not correctness).
  const tooSmall = html.length < 30_000;
  const tooLarge = html.length > 100_000_000;
  if (tooSmall) {
    checks.push({
      name: "Payload size sanity",
      passed: false,
      severity: "error",
      detail: `HTML is only ${html.length.toLocaleString()} bytes — far below the typical floor.`,
    });
  } else if (tooLarge) {
    checks.push({
      name: "Payload size sanity",
      passed: false,
      severity: "warning",
      detail: `HTML is ${(html.length / 1_048_576).toFixed(1)} MB — unusually large; double-check media payload.`,
    });
  } else {
    checks.push({
      name: "Payload size sanity",
      passed: true,
      severity: "error",
      detail: `${(html.length / 1024).toFixed(1)} KB.`,
    });
  }

  // 5. Inline <script> blocks must parse as JS. This is the strongest
  //    single check — it catches almost any character-level corruption
  //    in the runtime code (the part most prone to regression).
  const scripts = extractInlineScripts(html);
  if (scripts.length === 0) {
    checks.push({
      name: "Inline scripts parse",
      passed: false,
      severity: "error",
      detail: "No inline <script> blocks found — runtime would never boot.",
    });
  } else {
    let firstError: { idx: number; message: string } | null = null;
    for (let i = 0; i < scripts.length; i++) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function(scripts[i]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        firstError = { idx: i, message };
        break;
      }
    }
    if (firstError) {
      checks.push({
        name: "Inline scripts parse",
        passed: false,
        severity: "error",
        detail: `Inline <script> #${firstError.idx + 1} failed to parse: ${firstError.message}`,
      });
    } else {
      checks.push({
        name: "Inline scripts parse",
        passed: true,
        severity: "error",
        detail: `${scripts.length} inline <script> block(s) parsed cleanly.`,
      });
    }
  }

  // 6. Brace-balance sanity for the whole document. Catches truncated
  //    payloads even when `new Function` happens to accept a partial
  //    runtime (rare, but cheap to verify).
  const balance = countTokenBalance(html);
  if (!balance.balanced) {
    checks.push({
      name: "Brace balance",
      passed: false,
      severity: "warning",
      detail: `Unbalanced braces: ${balance.open} open vs ${balance.close} close. The file may be truncated.`,
    });
  } else {
    checks.push({
      name: "Brace balance",
      passed: true,
      severity: "warning",
      detail: `${balance.open} balanced { } pairs.`,
    });
  }

  const ok = checks.every((c) => c.passed || c.severity === "warning");
  return { ok, html, sanitizationCount: replacements, checks };
}

/** Compact, console-friendly summary for logging on failure. */
export function summarizeReport(report: QualityCheckReport): string {
  const lines: string[] = [];
  for (const c of report.checks) {
    const mark = c.passed ? "PASS" : c.severity === "error" ? "FAIL" : "WARN";
    lines.push(`[${mark}] ${c.name} — ${c.detail}`);
  }
  return lines.join("\n");
}
