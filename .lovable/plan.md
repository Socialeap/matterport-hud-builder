

## Add "Sales Machine that Self-Serves your Clients" Section

A new client-value section will be inserted on the landing page between the existing **Features grid** ("A Branded Studio for Clients to Build Their Own Presentations") and the **Pricing** section. This positions it as the natural "what your clients get" follow-up to "what you get as the MSP."

### Placement
`src/routes/index.tsx` — new `<section>` inserted at line ~518 (after the existing Features grid closes, before `#pricing`).

### Structure

**Section header**
- Eyebrow chip: "For Your Clients" (subtle pill matching site style)
- Headline (h2): "A Sales Machine that Self-Serves Your Clients"
- Punchy intro (1–2 lines): something like "Stop being the bottleneck. Hand your clients a closing tool — not a service ticket. Every presentation works, sells, and follows up on autopilot."

**3×2 card grid** (`sm:grid-cols-2 lg:grid-cols-3`) — same Card + icon + title + description pattern already used in the Problem and Features sections for visual consistency:

| Icon | Title | Copy |
|---|---|---|
| `Layers` | The Portfolio HUD | One branded interface for everything. Bundle multiple property models into a single presentation with seamless dropdown navigation. |
| `Bot` | The AI Concierge | A 24/7 virtual expert trained on your client's property data — answering buyer questions and capturing high-intent leads automatically. |
| `MailCheck` | Instant Lead Alerts | No dashboards to babysit. High-intent leads land directly in your client's inbox the moment a viewer raises their hand. |
| `Download` | Digital Sovereignty | Forever Assets. Clients download a self-contained presentation file and host it anywhere — Netlify, their own site, or any platform they choose. |
| `Boxes` | Scale-Based Pricing | Charge per property model bundled into a presentation. Bigger portfolios = bigger tickets, automatically. |
| `CreditCard` | White-Label Delivery | Stripe checkout, payouts, and order tracking — fully branded as your studio. Sales close while you sleep. |

### Implementation Details

1. Add a new data array `clientFeatures` near the existing `features` array (around line 127).
2. Add the new lucide-react icons to the existing import block (line 8): `Bot`, `MailCheck`, `Download`, `Boxes`, `CreditCard`.
3. Insert the new `<section>` JSX with the same styling tokens (`sectionTint`, `cardBg`, white text classes, amber-300 icon color) so it visually integrates with adjacent sections.
4. Keep copy bold, scannable, and non-technical — no jargon, short sentences.

### Out of Scope
- No DNS / email / Stripe changes (paused as requested).
- No new routes — purely a content addition to the existing landing page.

