

## Plan: MSP Onboarding Guide for Dashboard Overview

Replace the redundant card-link grid in `src/routes/_authenticated.dashboard.index.tsx` with a sequential, jargon-free **Quick Start Guide + FAQ** that walks MSPs through their workflow from sign-up to getting paid.

---

### Page structure

```text
┌─ Welcome strip (brand, current tier badge, "Your Studio at /p/{slug}" link)
│
├─ Quick Start: 6-step workflow (numbered, vertical timeline)
│   1. Brand Your Studio          → /dashboard/branding
│   2. Set Your Pricing           → /dashboard/branding (pricing block)
│   3. Connect Payouts            → /dashboard/payouts
│   4. (Pro) Stock Your Vault     → /dashboard/vault   (Pro-only, dimmed if Starter)
│   5. Invite Your Clients        → /dashboard/clients
│   6. Track Orders & Get Paid    → /dashboard/orders + /dashboard/payouts
│
├─ Pro Tips strip (3 short tips with icons)
│
├─ FAQ accordion (8–10 plain-language Q&As)
│
└─ Need more help? (link to demo + support email)
```

### Step card (repeats 6 times)

Each step is a horizontal card with:
- Large numbered circle (1–6) tinted with `accent`
- Lucide icon (Palette, DollarSign, Banknote, Archive, Users, ShoppingCart)
- Title + 1-sentence plain-English description
- "What you'll do" bullet list (2–3 items, no jargon)
- Primary action button → routes to the relevant dashboard page
- Optional **"Show me how" secondary button** → opens an interactive popup (`Dialog`) with a short walkthrough (3–5 numbered tips, screenshots optional later)
- Live status pill where detectable: e.g. "Done" (green Check) when step is complete, "Not started" (gray) otherwise

### Status detection (lightweight, single query on mount)

One Supabase fetch from `branding_settings` for the current user pulls everything needed:
- `logo_url` set → Step 1 complete
- `base_price_cents` set → Step 2 complete
- `stripe_onboarding_complete` true → Step 3 complete
- `tier === "pro"` → Step 4 unlocked (otherwise show "Pro feature — upgrade to unlock")
- Plus a count from `invitations` → Step 5 progress ("3 clients invited")
- Plus a count from `order_notifications` → Step 6 progress ("2 orders received")

### Pro Tips strip

Three short cards, e.g.:
- **Preview before you publish** — Use Demo Mode to see exactly what your clients will see.
- **Your accent color is everywhere** — It tints buttons, links, and the View Demo CTA across your portal.
- **Pro adds AI lead capture** — Upgrade to let your clients capture buyer info automatically.

### FAQ accordion (using existing `@/components/ui/accordion`)

Plain questions, plain answers. Examples:
- What's the difference between Starter and Pro?
- Can I change my brand colors after my clients have built tours?
- How do my clients pay me?
- What is the Vault and do I need it?
- How do invitations work?
- What does the "Demo Mode" do?
- Can I use my own domain?
- How do I get help?

Each answer is 1–3 sentences, conversational tone, with inline `<Link>`s to the right dashboard page when relevant.

### Interactive "Show me how" popups

Reusable `Dialog` triggered from each step's secondary button. Content is a short numbered checklist for that step (e.g. for Branding: "1. Upload your logo (square works best). 2. Pick an accent color that pops. 3. Choose a HUD background — dark colors look most premium. 4. Hit Save."). Closes with a "Got it" button that navigates to the page.

### Visual / styling

- Mirror the marketing aesthetic from `src/routes/p.$slug.index.tsx` lightly: rounded-2xl cards, subtle accent-tinted left borders for each step, Check icons in green for done, soft hover lift.
- Numbered timeline: vertical connector line behind the step cards on `sm+` so they read as sequential.
- All copy in plain English — no mention of "Supabase", "Stripe Connect", "branding_settings", "RLS", etc. (e.g. say "payouts" not "Stripe Connect").

### Files touched

| File | Change |
|---|---|
| `src/routes/_authenticated.dashboard.index.tsx` | Full rewrite: replace the 3-card overview with the Guide + Tips + FAQ above. |

No new components, no new dependencies (uses existing `card`, `accordion`, `dialog`, `badge`, `button`, lucide icons), no DB changes.

### Acceptance check

1. Overview page no longer duplicates the sidebar links.
2. Six numbered steps render with icons, descriptions, and CTAs to the correct dashboard pages.
3. Completed steps show a green "Done" pill (verified by toggling `stripe_onboarding_complete` or uploading a logo).
4. Step 4 (Vault) is locked/dimmed for Starter MSPs and clickable for Pro MSPs.
5. "Show me how" buttons open a dialog with plain-language tips.
6. FAQ accordion expands/collapses individual items.
7. No technical jargon visible anywhere on the page.

