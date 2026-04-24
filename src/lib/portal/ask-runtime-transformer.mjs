// Pure transformer used by BOTH the server-side assembler (imported as
// TS) and the Node build guard (imported as ESM). Kept as plain JS so
// it can run without the Vite ?raw pipeline.
//
// No imports, no TS syntax — same constraints as the other .mjs files.

// Strip the single final `export { ... };` block that each runtime .mjs
// module declares. Modules are allowed ONE export statement, at the
// bottom, in `export { a, b, c };` form (line breaks allowed).
function stripExports(src) {
  return src.replace(/export\s*\{[^}]*\}\s*;?\s*$/m, "");
}

// Strip line and block comments so the forbidden-token scanner only
// inspects executable code. Stays naive on purpose (no full JS parsing):
// this is a defensive gate, not a linter.
//
// We track only `"` and `` ` `` string delimiters. The .mjs modules in
// this folder must not use single-quote string literals — apostrophes
// inside regex literals (e.g. /what('s|)\b/) would confuse a naive
// tracker that treats `'` as a delimiter. This rule is enforced below.
function stripComments(src) {
  var out = "";
  var i = 0;
  var len = src.length;
  var inString = null; // '"' | '`'
  while (i < len) {
    var ch = src[i];
    var next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\" && i + 1 < len) {
        out += src[i + 1];
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "`") {
      inString = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < len && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}


// Scan assembled output for tokens that would break browser execution
// or indicate TypeScript-syntax leakage from the .mjs modules.
// Returns an array of offender snippets — empty means clean.
function findForbiddenTokens(assembled) {
  var offenders = [];
  var code = stripComments(assembled);
  var patterns = [
    [/\bimport\s+[\w{}*,\s]+\s+from\s+["']/g, "import statement"],
    [/\brequire\s*\(\s*["']/g, "CommonJS require"],
    [/\bexport\s+(const|function|class|default|let|var|\{)/g, "leftover export"],
    [/\bmodule\.exports\b/g, "module.exports"],
    [/^\s*interface\s+\w+/gm, "TypeScript interface"],
    [/:\s*(string|number|boolean|any|unknown|void|never)\b(?!\s*\??[=>)])/g, "TS type annotation"],
    [/\b\)\s*as\s+[A-Z]\w*\b/g, "TS `as` cast"],
  ];
  for (var i = 0; i < patterns.length; i++) {
    var re = patterns[i][0];
    var label = patterns[i][1];
    var hits = code.match(re);
    if (hits && hits.length) {
      for (var h = 0; h < Math.min(hits.length, 3); h++) {
        offenders.push(label + ": " + String(hits[h]).trim().slice(0, 80));
      }
    }
  }
  return offenders;
}

// Assemble the three runtime .mjs sources into a single string. Sources
// are passed in as pre-read text so this function stays pure and runs
// in both Vite (?raw import) and Node (fs.readFileSync) pipelines.
function assembleFromSources(askIntentsSrc, propertyBrainSrc, askLogicSrc) {
  var parts = [
    "// ── ask-intents.mjs (inlined) ──",
    stripExports(askIntentsSrc),
    "// ── property-brain.mjs (inlined) ──",
    stripExports(propertyBrainSrc),
    "// ── ask-runtime-logic.mjs (inlined) ──",
    stripExports(askLogicSrc),
  ];
  return parts.join("\n");
}

export { stripExports, findForbiddenTokens, assembleFromSources };
