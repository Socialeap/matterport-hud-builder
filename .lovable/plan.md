

## Plan: Optional Single-Rate Pricing + Public Pricing Section on Studio

Two coordinated changes: (1) give MSPs an optional "single flat rate per model" pricing mode on the Client Pricing page, and (2) surface their chosen pricing model as a public table on their Studio landing page (`/p/$slug`) with a header link.

---

### Part 1 — Single-Rate Toggle on `/dashboard/pricing`

**Goal:** Keep the 3-tier model as the preferred default, but let MSPs flip a switch to use one flat per-model price instead.

**New top-right control (above the 3 tier cards):**

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ Client Pricing                                                           │
│ Set what your clients pay…                                               │
│                                                                          │
│            ┌─────────────────────────────────────────────────────────┐  │
│            │ Single flat rate per model                               │  │
│            │ [ $ _____ ] per model    [ Use this rate ◯ OFF ]        │  │
│            │ When ON, clients pay this × number of models.           │  │
│            └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

- Input: `flatPrice` (USD).
- `Switch` (shadcn) labeled **"Use this rate"** — default OFF.
- When toggle is **ON**: the 3 tier cards visually dim (`opacity-50 pointer-events-none`) with a small overlay note "Tier pricing disabled — single rate active."
- When toggle is **OFF**: tier cards are active, single-rate input remains editable but unused.

**Calculation behavior (live "Example pricing" row at bottom):**

```ts
function calcCents(count: number) {
  if (useFlatRate && flatCents != null) return flatCents * count;
  // existing 3-tier logic
  if (count <= 2) return priceA * count;        // <-- FIX: was returning priceA flat regardless
  if (count === 3) return tier3Total;
  return tier3Total + (count - 3) * priceC;
}
```

> **Bug fix included**: the current `calcCents` returns `priceA` (flat) for both 1 and 2 models, but the card label says "each model is $A". Per the user's existing copy ("Per Model under 3 — each model is:"), 1 model = `$A`, 2 models = `2 × $A`. This plan corrects it.

**Database — one new column:**

```sql
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS flat_price_per_model_cents integer,
  ADD COLUMN IF NOT EXISTS use_flat_pricing boolean NOT NULL DEFAULT false;
```

Save handler upserts both new fields alongside the existing tier fields. Validation: if toggle is ON, require `flatPrice > 0`; if OFF, require `priceA > 0` as today.

**Files touched:**
- `src/routes/_authenticated.dashboard.pricing.tsx` — add Switch + flat input, dim tiers when active, fix tier calc, persist new fields.
- `src/components/portal/HudBuilderSandbox.tsx` — extend the price calculator to respect `use_flat_pricing` + `flat_price_per_model_cents` (lines 199–209), and apply the same 1/2-model fix.
- Migration file for the two new columns.

---

### Part 2 — Public Pricing Section + Header Link on `/p/$slug`

**Goal:** Show the MSP's actual configured pricing as a clean, easy-to-read table on their Studio landing page so prospects/clients understand what they'll pay.

**Section placement:** Insert a new `<section id="pricing">` between the existing `#includes` (Studio Includes) and `#compare` (Stop renting) sections.

**Section design (matches existing glassmorphism style used in `#includes`):**

- Heading: "What it costs" + subhead "One-time payment per Presentation. No subscriptions."
- Glass card (`bg-white/50 backdrop-blur-xl`, accent-tinted border) containing a `<Table>` (shadcn) with two columns: **Number of Models** | **Price**.
- Footnote in italic: "Prices are per Presentation download. You only pay when you're ready to publish."

**Two render modes — derived from the loaded `branding`:**

**Mode A — Flat rate (`use_flat_pricing = true`):**

| Number of models in your Presentation | Price |
|---|---|
| 1 model | $X |
| 2 models | $2X |
| 3 models | $3X |
| 4 models | $4X |
| 5 models | $5X |
| Each additional model | + $X each |

**Mode B — Tier rate (default):**

| Number of models in your Presentation | Price |
|---|---|
| 1 model | $A |
| 2 models | $2A |
| 3 models (bundle) | $B |
| 4 models | $B + $C |
| 5 models | $B + $2C |
| Each additional model beyond 3 | + $C each |

If pricing has not been configured (`base_price_cents` null and flat null), show a friendly placeholder card: "Your provider hasn't published pricing yet — contact them for a quote."

**Header navigation (`PortalHeader`, lines 440–443):**

Add `Pricing` to the existing `navLinks` array so it appears in both desktop nav and mobile sheet:

```ts
const navLinks = [
  { id: "steps",         label: "Steps" },
  { id: "compare",       label: "Compare" },
  { id: "pricing",       label: "Pricing" },   // NEW
  { id: "builder-start", label: "Builder" },
];
```

**Files touched:**
- `src/routes/p.$slug.index.tsx` — extend `fetchBrandingBySlug` select to include `flat_price_per_model_cents`, `use_flat_pricing`, `tier3_price_cents` (already wildcard `*`, so no change needed there); add the `<section id="pricing">` block; add `pricing` to `navLinks`; introduce a `PortalPricingSection` helper component in the same file mirroring the calc logic from the dashboard page.

---

### Acceptance check

1. `/dashboard/pricing` shows a "Single flat rate per model" card top-right with a numeric input and a Switch defaulted to OFF.
2. With Switch OFF: the 3 tier cards behave as today; the "Example pricing" row shows `1m=$A`, `2m=$2A`, `3m=$B`, `4m=$B+$C`, `5m=$B+$2C`.
3. With Switch ON: tier cards dim and the example row shows `1m=$X`, `2m=$2X`, `3m=$3X`, `4m=$4X`, `5m=$5X`.
4. Saving persists both modes; reloading the page restores the toggle state.
5. The builder/sandbox checkout total uses the chosen pricing mode (verified by toggling and adding models in `HudBuilderSandbox`).
6. `/p/$slug` shows a new "Pricing" link in the header (desktop + mobile menu) that scrolls smoothly to a `#pricing` section.
7. The pricing section displays the correct table for the MSP's chosen mode, in the same glassmorphism style as the rest of the page.
8. If no pricing has been set, a friendly placeholder appears instead of a broken/empty table.

