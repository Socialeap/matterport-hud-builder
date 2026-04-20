

## Plan: Hero Stage for `/p/$slug` Provider Portal

Add a cinematic hero background to the existing hybrid landing page, with MSP-controllable image + opacity, then expose those controls via DB migration and the Branding dashboard.

---

### 1. DB migration — `branding_settings`

Add two nullable columns:
- `hero_bg_url text` — public URL (uploaded to existing `brand-assets` bucket, same as logo)
- `hero_bg_opacity numeric default 0.45` — 0.0–1.0, controls darkening overlay strength

No backfill needed; nulls fall back to defaults in code.

---

### 2. `src/routes/p.$slug.index.tsx` — Hero Stage

Replace the current hero `<section>` with a stacked layered hero:

```text
┌─────────────────────────────────────────┐
│ Layer 0: bg image (cover, center)       │
│          fallback = Unsplash residential│
│ Layer 1: accent-tinted opacity overlay  │
│          (driven by hero_bg_opacity)    │
│ Layer 2: notebook grid (existing)       │
│ Layer 3: bottom→transparent fade mask   │
│          (mask-image gradient)          │
│ Layer 4: brand chip + H1 + sub + CTA    │
└─────────────────────────────────────────┘
```

Key implementation details:
- Background container uses `relative` + `aspect`/min-height ~`min-h-[85vh]`.
- Image: `<img>` absolutely positioned `inset-0 h-full w-full object-cover object-center`, with mobile-friendly `object-position: center` (no shift needed at this aspect).
- Overlay: absolutely-positioned div, `background: rgba(0,0,0,${hero_bg_opacity})` plus a subtle accent tint (`linear-gradient(180deg, ${accent}22, transparent 60%)`) to tie into branding.
- Fade-out: apply `mask-image: linear-gradient(to bottom, black 70%, transparent 100%)` on the hero wrapper so the image vanishes before the 3-step section. Use Tailwind arbitrary `[mask-image:linear-gradient(...)]` + `[-webkit-mask-image:...]`.
- Notebook grid stays as a fixed full-page overlay (already global) — no change.
- Headline + sub-headline switch to `text-white` with `drop-shadow-lg` for legibility on imagery.
- Existing accent-colored orbs: drop them inside the hero (they would clash with the photo); keep them only for the lower sections.

Defaults in code:
```ts
const heroBgUrl = branding.hero_bg_url ?? "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2400&q=80";
const heroBgOpacity = branding.hero_bg_opacity ?? 0.45;
```

Existing 3-step, comparison, and builder sections remain untouched. Only the hero block is replaced.

---

### 3. `src/routes/_authenticated.dashboard.branding.tsx` — controls

Add two new fields to the existing branding form:
- **Hero Background Image** — file upload (reuses logo upload pattern → `brand-assets` bucket → public URL → save to `hero_bg_url`). Include "Remove" button to null it out and live preview thumbnail.
- **Hero Image Dimming** — slider 0–100 (%) bound to `hero_bg_opacity`. Show the numeric % next to the slider.

Both persist on save alongside existing branding fields.

---

### 4. Files touched

| File | Change |
|---|---|
| `supabase/migrations/<timestamp>_branding_hero.sql` | New: add `hero_bg_url`, `hero_bg_opacity` columns |
| `src/routes/p.$slug.index.tsx` | Replace hero section with image-backed Hero Stage; read new fields |
| `src/routes/_authenticated.dashboard.branding.tsx` | Add hero image upload + opacity slider |

No changes to `HudBuilderSandbox`, no new shared components.

---

### 5. Acceptance check

1. Visit `/p/{slug}` → hero shows default residential photo, notebook grid visible on top, headline legible.
2. Photo fades smoothly to transparent before the 3-step cards begin (no hard line).
3. Upload a custom hero image in `/dashboard/branding` → reload portal → custom image appears.
4. Drag opacity slider to ~80% → portal headline becomes more legible against busy images.
5. CTA still smooth-scrolls to `#builder-start`; builder unchanged.
6. Mobile viewport (375px): image still covers, headline readable, no horizontal scroll.

