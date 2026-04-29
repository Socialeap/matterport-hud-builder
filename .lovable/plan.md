# Fix Email CTA Stalls + Personalize Button Label

## Root cause analysis

There are **three** mailto code paths involved (two ship in the generated end-product `.html`, one is the live in-app preview). All share the same two defects:

### Bug 1 — Malformed `mailto:` recipient (the real reason it stalls)
Every site does this:
```js
"mailto:" + encodeURIComponent(agentEmail) + "?subject=..."
```
`encodeURIComponent` turns `agent@example.com` into `agent%40example.com`. Per RFC 6068, the `to` portion of a `mailto:` URI must be a valid `addr-spec` — the `@` must be literal. Chrome, Edge, and Outlook's protocol handler silently refuse to launch when the recipient is percent-encoded; nothing opens, no console error fires, and the status text "Opening your email app…" is left stranded. **This is why both buttons stall.**

The recipient must be passed raw (it's already a validated email). Only `subject` and `body` need `encodeURIComponent`.

### Bug 2 — User-gesture loss (the lead-capture downgrade form)
`__dqaRenderInquiryForm` (`portal.functions.ts:2110`) does:
```js
async function() {
  ...
  await fetch(supabaseOrigin + "/functions/v1/handle-lead-capture", ...)  // gesture lost here
  if (!sentVia) { window.location.href = mailto; }                         // browser blocks
}
```
After an `await`, the click is no longer a "user activation" and Chromium-based browsers refuse to launch external protocol handlers. The fallback mailto never fires.

### Bug 3 (cosmetic) — Generic label
Both buttons read "Email agent". Many reps are property managers, marketers, or owners — the label should reflect the configured contact.

## Fix plan

### File 1 — `src/lib/portal.functions.ts` (generated end-product)

**A. Quick-question drawer button (around line 1843)**
- Build the URL with the **raw** email: `"mailto:" + agentEmail + "?subject=" + encodeURIComponent(...) + "&body=" + encodeURIComponent(...)`.
- Set `statusEl.textContent` **before** `window.location.href = url` so DOM update is queued, but the navigation itself remains the synchronous tail of the click handler (no awaits introduced).
- Trim body if URL > 1900 chars by re-encoding a shortened body (current code slices the encoded URL, which can leave a dangling `%` triplet — minor hardening).

**B. Drawer button label (line 1308)**
Replace the static `Email agent` label with `Email ${escapeHtml(firstName(agent.name)) || "agent"}` where `firstName` returns the first whitespace-delimited token (or "agent" if name is empty). Keeps the button compact while personalizing.

**C. Lead-capture downgrade form (around line 2110)**
Restructure so the mailto fallback runs in the **same synchronous tick** as the click:
```js
card.querySelector(".ask-inquiry-send").addEventListener("click", function() {
  // 1. Validate (sync)
  // 2. Build mailto URL with raw recipient
  // 3. Open mail client IMMEDIATELY: window.location.href = mailto
  // 4. THEN fire-and-forget the handle-lead-capture POST (no await blocking the navigation)
  fetch(...).catch(() => {});
  statusEl.textContent = "Your email composer should now be open…";
});
```
This preserves the backend logging (it still runs) but never blocks the protocol handoff. The Pro-tier "backend-only" path is preserved by checking the response **after** navigation has been requested — the fetch still completes in the background, and we only show the "sent via backend" copy if the user comes back to the tab.

A simpler, safer variant: always open `mailto:` first (it's the user's intent), and run the lead-capture POST in parallel for analytics. Recommended.

**D. Personalize this form's send button label too** — `Send to agent` → `Email ${firstName(agent.name) || "agent"}`.

### File 2 — `src/components/portal/HudPreview.tsx` (live builder preview)

**A. Drawer email link (line 670)** — already correct (raw email, no encode). Leave as is.

**B. Quick-question email button (line 708)**
Change:
```ts
const mailHref = `mailto:${encodeURIComponent(agent.email || "")}?...`;
```
to:
```ts
const mailHref = `mailto:${agent.email || ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildBody(false))}`;
```

**C. Button label (line 760)**
Replace `Email agent` with `Email {firstName(agent.name) || "agent"}` using a small inline helper.

### File 3 — Helper

Add a tiny `firstName(full)` helper in both files (they don't share runtime — `portal.functions.ts` is serialized into the generated HTML as a string template; `HudPreview.tsx` runs in React). Two ~3-line copies, no shared module needed.

## Why this is safe

- **No new dependencies, no schema changes, no API changes.**
- Drawer phone/SMS links are unchanged.
- The avatar contact card direct `mailto:` link in `HudPreview.tsx:670` already passes the raw address — it works today, which independently confirms the encode-the-recipient theory.
- The `handle-lead-capture` POST still runs (fire-and-forget) so Pro-tier lead logging is preserved.
- Existing `aria-disabled` gating, char-limit clamp, and copy-to-clipboard fallback are untouched.
- Status messages are rewritten *after* `window.location.href` is set so the DOM update doesn't interrupt the navigation request, but it remains synchronous within the click handler (browsers consider the gesture intact).
- Label change is purely string-level; downstream selectors use IDs (`#drawer-qsend-email`, `.ask-inquiry-send`), not text content, so nothing breaks.

## Files to edit

```
src/lib/portal.functions.ts        — fixes A, B, C, D + firstName helper
src/components/portal/HudPreview.tsx — fixes B, C + firstName helper
```

## QA checklist after edit

1. Build a fresh presentation, open the generated `.html`, type a question, click **Email [Name]** → mail client opens with prefilled subject/body.
2. Same flow on the lead-capture downgrade form (simulate by exhausting Ask quota or temporarily forcing render) → mail client opens, network tab shows `handle-lead-capture` POST fired in background.
3. Live builder preview drawer shows `Email [FirstName]`, click opens compose window in browser default mailer.
4. With agent name empty, label gracefully falls back to `Email agent`.
5. Long messages (>1500 chars) still produce a launchable URL (clamp re-encodes safely).

Approve and I'll implement all five edits in one pass.
