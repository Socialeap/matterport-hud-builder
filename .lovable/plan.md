

# Fix Studio Link Button + Contact Side Modal

## Issues Found

1. **No shareable studio link button**: The Branding page shows the portal URL as static text (`Your portal: .../p/slug`) but has no copy-to-clipboard button for MSPs to easily share with clients.

2. **Contact button triggers `tel:` link**: In `HudPreview.tsx` (line 89-95), the Contact button is an `<a href="tel:...">` tag — it directly dials the phone number instead of opening a "Get in Touch" side modal with the agent's full contact info (name, email, phone, social links, welcome note).

## Plan

### 1. Add "Copy Studio Link" button on the Branding page

**File: `src/routes/_authenticated.dashboard.branding.tsx`**

- Below the portal slug input where it shows "Your portal: .../p/{slug}", add a "Copy Link" button that copies the full URL to clipboard with a toast confirmation

### 2. Replace Contact `<a href="tel:">` with a side modal in HudPreview

**File: `src/components/portal/HudPreview.tsx`**

- Replace the `<a href="tel:...">Contact</a>` link with a `<button>` that opens a Sheet (slide-in from right)
- The Sheet displays the full agent contact info:
  - Agent name, photo placeholder
  - Welcome note
  - Phone (with click-to-call and click-to-text buttons)
  - Email (with mailto link)
  - Social media links (LinkedIn, Twitter, Instagram, Facebook, TikTok, Website, Other)
- Pass the full `agent` object (AgentContact) into HudPreview instead of just `agentName` and `agentPhone`

**File: `src/components/portal/HudBuilderSandbox.tsx`**

- Update the HudPreview props to pass the full `agent` object instead of individual `agentName`/`agentPhone` fields

### Files Changed

| File | Change |
|---|---|
| `src/routes/_authenticated.dashboard.branding.tsx` | Add copy-link button next to portal URL |
| `src/components/portal/HudPreview.tsx` | Replace `tel:` link with Sheet-based contact modal; accept full `agent` prop |
| `src/components/portal/HudBuilderSandbox.tsx` | Pass full `agent` object to HudPreview |

