/**
 * Build-time guard for the assembled presentation HTML.
 *
 * The visitor runtime is emitted from a giant JavaScript template literal
 * in `portal.functions.ts`. Inside a template literal, escape sequences
 * like `\n`, `\r`, `\t` are interpreted by the build-time JS parser as
 * actual control characters BEFORE the string is written to the response
 * body. If a regex literal in the runtime is written as `/[\n]+/g`
 * instead of `/[\\n]+/g`, the generated file ends up with a literal
 * newline inside the regex slashes — illegal JS, blowing up the whole
 * inline script with "Invalid regular expression: missing /".
 *
 * This module scans the assembled HTML for that exact failure mode and
 * throws a descriptive error so the regression is caught at generation
 * time (with stack + offending snippet in server logs) rather than at
 * the visitor's browser.
 */

export class RuntimeLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLintError";
  }
}

/**
 * Find regex literals in inline <script> blocks that contain raw
 * control characters (CR, LF, TAB) inside the slashes. Returns up to
 * `max` offender snippets with surrounding context.
 */
export function findUnescapedRegexControlChars(
  html: string,
  max = 5,
): Array<{ snippet: string; line: number }> {
  const offenders: Array<{ snippet: string; line: number }> = [];
  const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRe.exec(html)) !== null) {
    const attrs = scriptMatch[1] || "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const body = scriptMatch[2];
    const scriptStart = scriptMatch.index + scriptMatch[0].indexOf(body);

    // Naive single-line regex literal scan: `/...[\n\r\t]...flags`
    // We only flag literals whose body contains a raw control char,
    // which is the precise failure mode we care about.
    const litRe = /\/(?![*/])((?:\\.|\[[^\]]*\]|[^/\\\n])*?)\/[gimsuy]*/g;
    // The above intentionally doesn't match across raw newlines, so
    // here we scan with a more permissive variant that DOES allow
    // control chars in the body, then check.
    const permissive = /\/(?![*/])((?:\\.|\[[\s\S]*?\]|[^/\\])+?)\/[gimsuy]*/g;
    let m: RegExpExecArray | null;
    while ((m = permissive.exec(body)) !== null) {
      const inner = m[1];
      if (/[\r\n\t]/.test(inner)) {
        const absoluteIdx = scriptStart + m.index;
        const line = html.slice(0, absoluteIdx).split("\n").length;
        const snippet = m[0].replace(/\n/g, "\\n").replace(/\t/g, "\\t").slice(0, 120);
        offenders.push({ snippet, line });
        if (offenders.length >= max) return offenders;
      }
    }
  }
  return offenders;
}

/**
 * Throws RuntimeLintError if the assembled HTML contains regex literals
 * with raw control characters in inline scripts. Safe no-op otherwise.
 */
export function assertRuntimeRegexSafety(html: string): void {
  const offenders = findUnescapedRegexControlChars(html);
  if (offenders.length === 0) return;
  const lines = offenders.map(
    (o) => `  - line ~${o.line}: ${o.snippet}`,
  );
  throw new RuntimeLintError(
    `[portal] Inline runtime contains regex literal(s) with raw control characters. ` +
      `This usually means a backslash escape was written as \\n / \\r / \\t inside a ` +
      `template literal where it must be doubled (\\\\n / \\\\r / \\\\t).\n` +
      lines.join("\n"),
  );
}
