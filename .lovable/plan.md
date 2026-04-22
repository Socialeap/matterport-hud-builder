

## Fix the broken Welcome gate buttons and solid-blue background

### Root cause #1 — buttons are dead because the embedded script throws a SyntaxError

The generated HTML embeds an inline `<script>` block built inside a JavaScript **template literal** in `src/lib/portal.functions.ts` (the big `const html = \`...\``).

Inside a template literal, backslashes that precede non-recognized escape characters (like `\.`, `\?`, `\w`, `\d`, `\/`, `\(`) are silently stripped by JavaScript. So the source code:

```js
if(/\.mp4(\?.*)?$/i.test(url)) ...
url.match(/youtu\.be\/([\w-]{6,})/i)
url.match(/player\.vimeo\.com\/video\/(\d+)/i)
```

ends up in the downloaded HTML as:

```js
if(/.mp4(?.*)?$/i.test(url)) ...
url.match(/youtu.be/([w-]{6,})/i)
url.match(/player.vimeo.com/video/(d+)/i)
```

Confirmed against the uploaded `1535_Broadway_New_York_NY_10036.html` lines 326–334.

`/.mp4(?.*)?$/i` is an **invalid regex** — `(?` starts a non-capturing/lookaround group and the next char must be `:`, `=`, `!`, etc. So the browser throws `SyntaxError: Invalid regular expression` while parsing the IIFE. **Every single line in that IIFE is lost**, including:

- `gate-sound-btn` and `gate-silent-btn` `addEventListener` registrations
- `frame.src = props[0].iframeUrl` (so the Matterport tour never loads)
- `__openModal`, `__openContact`, mute toggle, carousel — all of it

Result: both gate buttons are unresponsive and nothing happens on click.

This is also why earlier escape-style fixes worked in dev preview (the React preview uses the regex via `src/lib/video-embed.ts`, not the template-literal copy). The bug is unique to the **generated standalone HTML**.

### Root cause #2 — solid blue background instead of glass over the tour

Two problems combine:

1. The gate's CSS is `background:${hudBgColor}cc` → `#0c0cb6cc` ≈ 80 % opaque, plus a heavy `backdrop-filter: blur(24px)`. That's already too opaque to see through.
2. Because the script throws, `frame.src` is never assigned, so even if the gate were translucent there would be nothing behind it. After fix #1 the iframe will render, but the gate is still too opaque.

We need to lower the gate's background alpha and soften the blur so the live 3D tour shows through with a slight glassmorphism overlay.

---

## Plan

### File to edit
- `src/lib/portal.functions.ts`

### Change 1 — Make embedded regex literals survive the template-literal escape stripping

Inside the big `const html = \`...\`` block (around lines 1147–1160), replace every regex backslash with a **double backslash** so the template literal emits a single backslash into the runtime script.

Before (source):
```js
if(/\.mp4(\?.*)?$/i.test(url)) return {kind:"mp4",src:url};
var yt=url.match(/youtu\.be\/([\w-]{6,})/i)||url.match(/youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/)([\w-]{6,})/i);
var vi=url.match(/player\.vimeo\.com\/video\/(\d+)/i)||url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
var wi=url.match(/wistia\.com\/medias\/([\w-]+)/i)||url.match(/wistia\.net\/(?:embed\/iframe|medias)\/([\w-]+)/i);
var lo=url.match(/loom\.com\/(?:share|embed)\/([\w-]+)/i);
```

After (source — note doubled backslashes):
```js
if(/\\.mp4(\\?.*)?$/i.test(url)) return {kind:"mp4",src:url};
var yt=url.match(/youtu\\.be\\/([\\w-]{6,})/i)||url.match(/youtube\\.com\\/(?:watch\\?(?:.*&)?v=|embed\\/|shorts\\/|v\\/)([\\w-]{6,})/i);
var vi=url.match(/player\\.vimeo\\.com\\/video\\/(\\d+)/i)||url.match(/vimeo\\.com\\/(?:video\\/)?(\\d+)/i);
var wi=url.match(/wistia\\.com\\/medias\\/([\\w-]+)/i)||url.match(/wistia\\.net\\/(?:embed\\/iframe|medias)\\/([\\w-]+)/i);
var lo=url.match(/loom\\.com\\/(?:share|embed)\\/([\\w-]+)/i);
```

Then audit the rest of the template literal for any other backslashed character that needs to survive into the runtime script. Anywhere we see a single `\` that is not part of a valid string escape (`\n`, `\t`, `\\`, `\u####`, `\x##`, `\'`, `\"`, `` \` ``, `\$`), double it. Search the file for `\.`, `\w`, `\d`, `\/`, `\?`, `\(`, `\)`, `\b`, `\s` occurrences inside the `const html = \`...\`` block and double each one.

Pre-existing usages of `\u2500`, `\u2014`, `\u003c`, `\u2028`, `\u2029` are valid Unicode escapes and stay as-is.

### Change 2 — Glassmorphism gate so the 3D tour is visible behind it

In the same file, change the `#gate` CSS rule (around line 864):

Before:
```css
#gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:3000;background:${escapeHtml(hudBgColor)}cc;backdrop-filter:blur(24px) saturate(160%);-webkit-backdrop-filter:blur(24px) saturate(160%);transition:opacity 0.5s ease}
```

After:
```css
#gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:3000;background:${escapeHtml(hudBgColor)}40;backdrop-filter:blur(8px) saturate(140%);-webkit-backdrop-filter:blur(8px) saturate(140%);transition:opacity 0.5s ease}
```

Then add a soft inner-content card so text and buttons stay legible against the moving tour behind:

```css
#gate-inner{display:flex;flex-direction:column;align-items:center;text-align:center;padding:40px 32px;max-width:480px;width:90%;background:rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.08);border-radius:18px;backdrop-filter:blur(10px) saturate(160%);-webkit-backdrop-filter:blur(10px) saturate(160%);box-shadow:0 12px 48px rgba(0,0,0,0.35)}
```

Also load the iframe immediately (it already does via `load(0)` at the bottom of the IIFE — once Change 1 is in place, the iframe paints behind the gate and the glass effect becomes visible).

### Change 3 — Defensive guard so a future regex typo can never kill the whole IIFE again

Wrap only the `parseCinematicUrl` body in a `try/catch` so a bad URL or malformed pattern degrades gracefully:

```js
function parseCinematicUrl(url){
  try{
    if(!url) return null;
    url=url.trim();
    // …regex matching…
    return null;
  }catch(_e){return null;}
}
```

This is local to one function and does not change normal behavior. It only protects the rest of the IIFE if something else slips past in the future.

---

## Why this is safe

- Change 1 is purely a string-literal escaping fix — no runtime logic changes. The regex patterns it produces in the downloaded HTML match the originals already used by the working preview (`src/lib/video-embed.ts`).
- Change 2 only touches gate CSS — no JS, no behavior change. The gate still dismisses on click; only its visual opacity changes.
- Change 3 only narrows blast-radius for future bugs; happy-path output is identical.
- No backend, schema, or auth changes.
- No other components consume the embedded script — it lives only inside the generated standalone HTML file.

---

## Verification checklist

1. Re-generate and download a presentation HTML for the same property.
2. Open the file directly from disk (no server).
3. Confirm the 3D Matterport tour is visible behind the welcome gate with a soft frosted-glass overlay.
4. Click **Start with Sound** → gate dismisses, audio begins, HUD header reveals.
5. Reload, click **Enter 3D Tour (No Sound)** → gate dismisses silently, HUD header reveals.
6. Click the **Contact** button → agent drawer slides in from the right.
7. Confirm the cinema, map, and media-gallery icon buttons each open their modals.
8. View source of the downloaded HTML and confirm the `parseCinematicUrl` regexes contain real backslashes (`/\.mp4(\?.*)?$/i`, `/youtu\.be\/…/i`, etc.).
9. Open the browser DevTools console on the standalone HTML — there should be no `SyntaxError: Invalid regular expression`.

