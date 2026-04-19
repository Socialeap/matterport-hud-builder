

## Plan: Add Privacy Policy + Terms of Service pages with footer links

### Scope

Two new SEO-indexable, SSR-rendered legal pages tailored to what 3DPS actually does, plus a Legal column added to the landing page footer.

### What 3DPS does (drives the legal language)

From the codebase:
- White-label SaaS for MSPs (managed service providers) who resell branded 3D Matterport tour presentations to their clients
- One-time purchase ($149 Starter / $299 Pro), plus optional annual AI upkeep license
- Stripe Connect Express payouts to MSPs
- Hosts MSP & client data in Lovable Cloud (Supabase): branding, sandbox demos, property models, leads
- Generates self-contained .html presentation files clients download and host anywhere
- Embeds Matterport tour iframes (third-party content, not hosted by us)
- AI Concierge (Lovable AI / Gemini) with optional lead capture
- Email delivery via Resend; user invites via signed tokens
- Auth via Supabase (email + Google OAuth)

### Files created (2)

**`src/routes/privacy.tsx`** — `/privacy`
- Standard `createFileRoute` with full `head()` block: title, description, og:title, og:description, og:url, twitter:card, canonical link → `https://3dps.transcendencemedia.com/privacy`
- Sections: Introduction · Information We Collect (account, branding assets, payment metadata via Stripe, viewer leads captured via AI Concierge, usage telemetry) · How We Use It · Third-Party Services (Stripe, Supabase/Lovable Cloud, Matterport iframes, Resend email, Lovable AI/Gemini, Google OAuth) · Cookies & Local Storage · Data Retention · Your Rights (access/delete/export) · Children (not for under-13) · International Transfers · Security · Changes · Contact (legal@transcendencemedia.com placeholder)
- Same dark-theme styling as landing page so it feels native; fixed header + footer reused inline (no shared layout component exists today, so we inline the minimal nav+back-to-home)

**`src/routes/terms.tsx`** — `/terms`
- Same head() pattern, canonical → `/terms`
- Sections tailored to 3DPS:
  1. Acceptance of Terms
  2. Service Description (white-label studio, generated .html files, AI features behind annual license)
  3. Accounts & Eligibility (18+, accurate info, account security)
  4. Subscriptions, Payments & Refunds (one-time tier purchases, AI upkeep license, Stripe Connect for MSP payouts, no automatic refunds on completed digital deliverables, refund window TBD — placeholder 7-day language)
  5. **Intellectual Property & License Restrictions** — explicit clause:
     - 3DPS / Transcendence Media owns all rights to the platform code, source files, builder UI, generation engine, and brand assets
     - MSPs receive a **limited, non-exclusive, non-transferable license** to use the platform and to deliver generated `.html` artifacts to their clients
     - **Prohibited:** accessing source code, reverse engineering, decompiling, scraping, copying, redistributing, modifying, or creating derivative works of the platform; bypassing tier restrictions or branding gates; reselling platform access; removing "Powered by" attribution on Starter tier
     - MSPs retain ownership of their own brand assets and client data they upload
  6. Acceptable Use (no illegal content, no IP infringement in uploaded property data, no malicious models, no spam via lead-capture)
  7. Third-Party Content (Matterport tours, embedded media — not endorsed/controlled by us)
  8. AI Features Disclaimer (concierge answers are best-effort, not legal/financial advice)
  9. Termination (we may suspend for ToS violation; MSP can stop using anytime; generated .html files already delivered remain usable)
  10. Disclaimers & Limitation of Liability (AS-IS, no warranty, cap at amount paid in last 12 months)
  11. Indemnification (MSP indemnifies us for client disputes)
  12. Governing Law (Florida — Transcendence Media's HQ; placeholder, easy to swap)
  13. Changes to Terms
  14. Contact

### File modified (1)

**`src/routes/index.tsx`** — footer
- Add a fourth column **Legal** to the existing 3-column grid (change `sm:grid-cols-3` → `sm:grid-cols-4` on line 746)
- Two `<Link>` items: Privacy Policy → `/privacy`, Terms of Service → `/terms`
- Use TanStack `<Link to="/privacy">` (already imported on line 1)

### SEO compliance (per knowledge files)

- Both routes get unique `head()` with title, description, og:title, og:description, twitter:card, canonical
- No `og:image` (no dedicated share images for legal pages — knowledge file says "no image is better than a generic one")
- SSR by default (no `ssr: false`) so Google indexes the full text
- Will appear in any future sitemap automatically

### Ripple safety trace

| Touched | Used elsewhere? | Risk | Mitigation |
|---|---|---|---|
| New `/privacy`, `/terms` route files | None | Zero — net-new files | — |
| `index.tsx` footer grid | Only landing page | Layout shift from 3→4 cols | Tailwind responsive — stacks on mobile, fine on desktop |
| `routeTree.gen.ts` | Auto-generated | Don't touch (per TanStack rules) | Vite plugin regenerates on build |
| Auth, dashboard, demo, branding routes | — | Not touched | — |
| `__root.tsx` | All routes | Not touched | — |

### Out of scope

- No legal review by an actual attorney — content is a best-effort draft with clear placeholders (`[Last updated: 2026-04-19]`, `[legal@transcendencemedia.com]`, `[Florida]`) the user should review before going live
- No cookie consent banner (separate effort)
- No DPA/data processing agreement page (B2B add-on if needed later)
- No footer link on dashboard/auth pages (legal lives on the public marketing surface only — can extend later)

