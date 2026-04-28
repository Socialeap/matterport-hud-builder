## Goal

Inside the **Get in Touch** side panel (both the React preview in the builder and the generated standalone .html), and under the Call (phone) button, we need a section for the visitor to easily generate and send a message.  The seection should have:

- A **Message** textarea.
- A **Your email** input (so the agent can reply by email even when the visitor sends SMS).
- A row of **quick-question chips** labeled by *type* of question (e.g. "Pricing", "Availability", "Schedule a tour", "HOA / fees", "Square footage", "Pet policy"). Tapping a chip pre-fills the message (and email subject) with a polished template that references the property name.
- Two send actions: **Email agent** (uses `mailto:` with subject + body) and **Text agent** (uses `sms:?body=...`). Email is shown only if `agent.email` exists; SMS only if `agent.phone` exists.

The visitor's email field is included in the email body (so the agent has the reply address) and likewise prepended to the SMS body for the same reason.  
  
PLease note the following considerations for your reference.  
___  
MOBILE: The HTML Syntax

To inject text into the SMS application, you append a body parameter to the link. Because spaces and special characters can break URLs, the text must be URL-encoded (e.g., %20 for a space).

For iOS (newer versions): Use & as the separator.

For Android: Use ? as the separator.

Cross-platform solution: Most modern browsers now recognize ?body= as the standard.

HTML

<a href="sms:+1234567890?body=I'm%20interested%20in%20the%20property%20at%20123%20Main%20St">

  Send SMS

</a>  
_____  
DESKTOP:   
1. Protocol Handling (The Hand-off)

On desktop, clicking an `sms:` link triggers the OS to look for a **default handler**.

- **macOS:** Usually opens the **iMessage** app. If the user has "Text Message Forwarding" set up with their iPhone, they can send the SMS from their Mac.
- **Windows:** Usually attempts to open the **Phone Link** (formerly Your Phone) app or Skype.
- **Linux/Other:** Often does nothing or shows an "Unknown Protocol" error unless a specific app is installed.

### 2. The `?` vs `&` Separator

While mobile has historically been split, desktop browsers (Chrome, Edge, Safari, Firefox) are generally more rigid about RFC standards.

- **Standard:** Use `?body=` for the first parameter.
- **The "Double Separator" Issue:** If you use a logic that detects mobile and switches to `&body=`, desktop browsers will likely fail to parse it. Stick to `?body=` for desktop-first or universal links.

### 3. URL Encoding Length Limits

Desktop browsers (especially older versions of Edge/IE or specific mail/SMS clients) can sometimes choke on extremely long URIs.

- **Safe Limit:** Keep the total URL (phone number + encoded body) under **2,000 characters**.
- **Encoding:** Ensure you are using `encodeURIComponent()` in your JavaScript. Desktop browsers are less forgiving of raw spaces or special characters in the URI than mobile WebViews.

### 4. User Experience Fallbacks

Since many desktop users won't have a configured SMS app, it is a "best practice" to:

- **Detect Environment:** If `navigator.userAgent` indicates a desktop OS, consider showing the **Email** option more prominently than the **SMS** option.
- **Copy to Clipboard:** Add a "Copy Message" button. If the `sms:` link fails to open anything, the user can at least copy the pre-filled text and paste it into their preferred messaging web app (like WhatsApp Web or Google Messages).

### 5. Security Prompts

Unlike mobile, where the app just opens, desktop browsers will almost always show a **confirmation dialog** (e.g., *"This site is trying to open 'Messages'?"*). This is a security feature to prevent websites from launching local apps without consent. You cannot bypass this via HTML or JS.  
____

No backend wiring is needed — this stays fully client-side and self-contained, consistent with the end-product's "no phone home" rule.

## Files to change

1. `**src/lib/portal.functions.ts**` — generated end-product HTML (the actual presentation file).
2. `**src/components/portal/HudPreview.tsx**` — in-builder live preview so MSPs see the same UX while configuring.

## UX details

**Question-type chips** (shared list, label → template):


| Label           | Subject                         | Body template                                                                       |
| --------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| Pricing         | "Pricing question — {Property}" | "Hi, could you share the asking price and any recent price changes for {Property}?" |
| Availability    | "Availability — {Property}"     | "Is {Property} still available? When can I view it?"                                |
| Schedule a tour | "Tour request — {Property}"     | "I'd like to schedule a tour of {Property}. What times work this week?"             |
| HOA / fees      | "HOA & fees — {Property}"       | "Could you share HOA dues and any other recurring fees for {Property}?"             |
| Square footage  | "Square footage — {Property}"   | "Could you confirm the total square footage and room dimensions for {Property}?"    |
| Pet policy      | "Pet policy — {Property}"       | "What's the pet policy for {Property}?"                                             |
| Financing       | "Financing — {Property}"        | "Are there preferred lenders or financing options for {Property}?"                  |
| Other           | "Inquiry — {Property}"          | "" (blank — visitor types from scratch)                                             |


Tapping a chip:

- Replaces the textarea contents with the body template.
- Stores the matching subject in component state (used when **Email agent** is clicked).
- Highlights the active chip.

**Email agent** click → `mailto:{agent.email}?subject={subject}&body={body + "\n\n— Sent from " + visitorEmail}` (URL-encoded; visitor email appended only if provided).

**Text agent** click → `sms:{agent.phone}?body={body + (visitorEmail ? "\nReply to: " + visitorEmail : "")}` (URL-encoded; subject is omitted because SMS has no subject field).

**Validation**:

- Both buttons disabled until message is non-empty.
- Email field uses `type="email"` for native validation; not required (SMS path doesn't need it), but if filled and invalid, show inline hint.
- Falls back gracefully when only one channel is configured (only renders the buttons that have a target).

**Styling**: Match existing drawer aesthetic (white text, `rgba(255,255,255,0.08)` backgrounds, rounded 8px). Chips are pill-shaped using the same look as `.social-pill`. Send buttons use `accentColor` for primary (Email) and a translucent secondary (Text), or vice-versa when only one is available.

## Implementation outline

### Generated HTML (`src/lib/portal.functions.ts`)

1. **CSS additions** (next to `.drawer-*` rules around line ~950):
  ```css
   .drawer-quickmsg{margin-top:14px;border-top:1px solid rgba(255,255,255,0.08);padding-top:12px}
   .drawer-quickmsg-label{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,0.4);margin-bottom:6px}
   .drawer-qchips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
   .drawer-qchip{border:none;cursor:pointer;border-radius:999px;background:rgba(255,255,255,0.1);color:#fff;padding:5px 10px;font-size:11px;font-weight:500}
   .drawer-qchip.active{background:{accentColor}}
   .drawer-qfield{width:100%;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;padding:8px 10px;font-size:12px;margin-bottom:6px;font-family:inherit}
   .drawer-qfield:focus{outline:none;border-color:{accentColor}}
   .drawer-qsend-row{display:flex;gap:6px;margin-top:6px}
   .drawer-qsend{flex:1;border:none;border-radius:8px;padding:8px;font-size:12px;font-weight:600;color:#fff;cursor:pointer}
   .drawer-qsend.primary{background:{accentColor}}
   .drawer-qsend.secondary{background:rgba(255,255,255,0.15)}
   .drawer-qsend:disabled{opacity:0.5;cursor:not-allowed}
  ```
2. **Markup** added inside `#agent-drawer > #drawer-inner`, after `.drawer-actions`, before social pills (only rendered when `agent.email || agent.phone`):
  ```html
   <div class="drawer-quickmsg">
     <div class="drawer-quickmsg-label">Quick question</div>
     <div class="drawer-qchips" id="drawer-qchips"><!-- chip buttons --></div>
     <input type="email" class="drawer-qfield" id="drawer-qemail" placeholder="Your email (optional)">
     <textarea class="drawer-qfield" id="drawer-qmsg" rows="4" placeholder="Type your question…"></textarea>
     <div class="drawer-qsend-row">
       <!-- Email + Text buttons, conditionally rendered -->
     </div>
   </div>
  ```
3. **Inline JS** (near other `window.__openContact` handlers): a tiny IIFE that
  - Holds the chip array (label/subject/body, with `{Property}` interpolated against the live `currentProperty.name` at click time).
  - Wires chip clicks to fill textarea + remember subject.
  - Wires Email button to build `mailto:` URL with `encodeURIComponent`.
  - Wires Text button to build `sms:` URL with `encodeURIComponent`.
  - Disables send buttons while message is empty (`input` event listener).
   Property name is read at click time from the same source the existing HUD uses (`__currentProperty?.name || propertyName` constant emitted by the generator), so it always reflects the active property when there are multiple.

### In-builder preview (`src/components/portal/HudPreview.tsx`)

Mirror the same UX in React:

- Add `useState` for `visitorEmail`, `message`, `subject`, `activeChip`.
- Add the same chip array as a constant (single source of truth — extract to a small helper file `src/components/portal/quick-questions.ts` so both the generator and preview can stay in sync conceptually; but since generator is plain string, we still copy the data in the template literal — acceptable duplication, list lives in two places with a comment pointing at the other).
- Render the new section inside the existing slide-out panel, below the contact actions and before the social pills.
- `mailto:` / `sms:` links built with the same subject/body composition.

## Safety / regression check (trace)

- The new block is rendered **inside** the existing `#agent-drawer` only when `agent.email || agent.phone`, identical condition to the existing `.drawer-actions`. If the drawer doesn't render, neither does the form — no new code paths in headers/HUD/iframe.
- No changes to event handlers for `__openContact` / `__closeContact` / drawer toggle — only **adds** DOM and listeners scoped to the new IDs.
- No changes to the existing Ask AI inquiry-card flow (which uses `handle-lead-capture`); this new form is a separate, simpler client-only path. The two coexist: Ask AI's quota-exhausted card stays, and visitors can also reach the agent directly from the contact drawer.
- No new env vars, secrets, or backend calls — preserves the "no phone home" guarantee for the end product.
- No tier gating needed (agent contact is already in both tiers).
- Chip templates safely interpolate property name via `String(...)` and HTML-escape on render; user-typed message is URL-encoded before being placed in `mailto:`/`sms:` to prevent header injection.

## Out of scope

- Server-side persistence of the message (could be added later as an optional Pro feature using `handle-lead-capture`, but spec asks only that it be inserted into the SMS/email body).
- Inline send confirmation UI (the visitor's mail/SMS app handles send confirmation).
- Localization of chip labels.