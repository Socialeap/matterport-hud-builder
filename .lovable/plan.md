

## Plan: Hybrid Landing Page for `/p/$slug` Provider Portal

Transform `src/routes/p.$slug.index.tsx` from a builder-only route into a **marketing landing page that anchors down to the builder**. Design language inherits from `src/routes/index.tsx` (notebook grid, organic orbs, glassmorphism), but every accent is **dynamically driven by `branding.accent_color`** instead of the platform's amber.

---

### 1. Loader expansion

Augment the existing `fetchBrandingBySlug` server fn so it returns enough data to render the dynamic "what this MSP can offer" capability card:

```text
loader returns → {
  branding,           // existing
  demoPublished,      // existing
  lusActive,          // NEW — get_license_info(provider_id) → status==='active' && not expired
  vaultAssetCount,    // NEW — count from vault_templates where provider_id matches
}
```

Tier (`branding.tier`) and LUS active flag drive which capabilities the MSP advertises.

---

### 2. New page structure (in order)

```text
┌──────────────────────────────────────────────┐
│ Demo banner (existing, kept — restyled)      │
├──────────────────────────────────────────────┤
│ HERO                                         │
│  • brand logo + name chip                    │
│  • H1: "Your Properties, Professionally      │
│    Presented. No Subscriptions."             │
│  • Sub: build free, pay once to download     │
│  • CTA "Start Building Your HUD" → #builder  │
│  • Notebook grid + 2 accent-colored orbs     │
├──────────────────────────────────────────────┤
│ 3-STEP ONBOARDING (3 glass cards)            │
│  1. Paste your Model                         │
│  2. Design your HUD                          │
│     └─ NESTED green-bordered card:           │
│        "What {brand_name} Studio Includes"   │
│        - dynamic feature list (see §3)       │
│  3. Download & Own                           │
├──────────────────────────────────────────────┤
│ SOVEREIGNTY COMPARISON (2 columns)           │
│  Generic Matterport  |  {brand_name} Studio  │
│  ✗ no branding       |  ✓ full white-label   │
│  ✗ links expire      |  ✓ own the file       │
│  ✗ no leads          |  ✓ AI lead alerts     │
│  ✗ subscription      |  ✓ one-time payment   │
├──────────────────────────────────────────────┤
│ #builder-start (scroll target)               │
│  H2 "Studio Presentation Builder"            │
│  Sub "Configure your 3D experience…"         │
│  <HudBuilderSandbox branding={branding} />   │
└──────────────────────────────────────────────┘
```

Smooth scroll: CTA uses `<a href="#builder-start">` with `scroll-mt-20` on the target and `scroll-behavior: smooth` (already global via Tailwind base or inline style on `<html>` / per-anchor handler).

---

### 3. Dynamic feature card logic ("Step 2" nested green card)

Always include:
- ✓ Custom branding (logo, color, contact)
- ✓ Music & tour behavior config
- ✓ Matterport Media Sync & Cinema Mode
- ✓ Google-Powered Neighborhood Map

LUS-active → add:
- ✓ AI Property FAQ Concierge
- ✓ AI Lead Capture & Email Alerts
- ✓ Smart Doc Engine (PDF extractions)

Pro tier → add:
- ✓ Production Vault add-ons (`{vaultAssetCount}` curated plugins available)
- ✓ Per-model pricing tiers
- ✓ Custom-domain hosting

If LUS inactive → small muted note: "Premium AI features currently unavailable."

---

### 4. Visual / theming rules

- **Accent driver**: every button background, icon color, ring, badge accent, comparison checkmark, and "Step N" number badge uses inline `style={{ backgroundColor: branding.accent_color }}` or `color`. No hard-coded `amber-*` from the main landing page.
- **Glassmorphism**: cards use `backdrop-blur-md bg-white/60 dark:bg-slate-900/60 border border-white/40`.
- **Notebook grid**: same `bg-[linear-gradient(...)]` overlay as `index.tsx`.
- **Organic orbs**: 2 absolutely-positioned blurred divs whose color = `branding.accent_color` at low opacity.
- **Hover lift**: reuse `transition-all duration-300 hover:-translate-y-1 hover:shadow-lg` from the main landing page.
- **Existing demo banner**: keep, restyled to sit flush above the hero (no behavior change).

---

### 5. Files touched

| File | Change |
|---|---|
| `src/routes/p.$slug.index.tsx` | Expand loader (LUS + vault count); replace component body with hero + 3-step + comparison + builder section. Keep `HudBuilderSandbox` import. |

No changes to `HudBuilderSandbox.tsx`, no DB migrations, no new components extracted (sections defined inline in the route file to keep one self-contained edit).

---

### 6. Acceptance check

1. Visit `/p/{slug}` → see hero with brand logo, brand name in headline, accent-colored CTA.
2. CTA "Start Building" smooth-scrolls to the builder section.
3. Step-2 nested card lists capabilities matching the MSP's tier + LUS status (verify by toggling `licenses.license_status` in the DB).
4. Pro MSP with vault assets sees the "Production Vault" line with the correct count; Starter MSP does not.
5. Demo banner still appears when `demoPublished === true`.
6. Existing builder still functions identically once scrolled to.

