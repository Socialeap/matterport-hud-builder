## Goal

Restore the **Production Vault feature filters** that were dropped from the `/agents` MSP directory in PR #587e63d, and re-organize the directory's filter UI around the two MSP service types you described:

1. **On-Site Scanning Services** — what the MSP does at the property (3D capture / photography differentiators).
2. **Studio / Presentation Services** — Production Vault assets that vary studio-to-studio.

This restores agents' ability to find MSPs by the features that actually differentiate them, on top of the existing City / ZIP / Region search.

## Scope of changes

### 1. Database — extend the `marketplace_specialty` enum

The directory RPC (`search_msp_directory`) returns each MSP's `specialties: marketplace_specialty[]` from `branding_settings`. We extend that enum so MSPs can self-tag both scanning offerings and vault offerings.

Add new enum values (additive — no breaking change):

**Studio / Vault features** (restored from b2cd250) MSP should have a minimum number of items from each asset class in order to offer that service:

- `vault-sound-library (at least 12 ambient tracks)`
- `vault-portal-filters (at least 3)`
- `vault-interactive-widgets (at least 2)`
- `vault-custom-icons (at least 2 sets)`
- `vault-property-mapper (at least 6)`
- `ai-lead-generation`

**Scanning services** (new — your "Service Type 1"):

- `scan-matterport-pro3`
- `scan-drone-aerial`
- `scan-twilight-photography`
- `scan-floor-plans`
- `scan-dimensional measurements`
- `scan-same-day-turnaround`

The existing values should be dropped: (`residential`, `luxury`, `commercial`, `new-construction`, `multi-family`, `vacation-rental`, `ai-specialist`, `cinema-mode-specialist`).

### 2. `/agents` directory UI (`src/routes/agents.tsx`)

Replace the single flat checkbox row in `DirectorySection` with a **two-group filter panel**:

```text
┌─ Filter by services ──────────────────────────────┐
│ ON-SITE SCANNING                                       │
│ □ Matterport Pro3   □ Drone / Aerial                   │
│ □ Twilight Photo    □ Floor Plans                      │
│ □ Dimensional Measurements  □ Same-Day Turnaround      │
│                                                        │
│ STUDIO PRESENTATION (Production Vault; w/minimum items │
│ □ Sound Library         □ Visual Portal Filters        │
│ □ Interactive Widgets   □ Custom Iconography           │
│ □ Property Mapper       □ AI Lead Generation           │
└────────────────────────────────────────────────────┘
```

Implementation:

- Re-import the icons removed in b2cd250 (`Music2`, `Wand2`, `Puzzle`, `Shapes`, `MapPinned`, `Magnet`, `DollarSign`) plus new icons for scanning (`Camera`, `Plane`, `Sunset`, `Ruler`, `Sofa`, ruler, `Zap`).
- Replace `SPECIALTY_FILTERS` with two arrays `SCANNING_FILTERS` and `STUDIO_FILTERS`, each typed against the extended `MarketplaceSpecialty` enum.
- `selectedSpecialties` state stays a single `Set<MarketplaceSpecialty>`; the existing "match all selected" filter logic in `useMemo` works unchanged.
- Update each MSP card so badges render with their proper labels via a combined `SPECIALTY_LABEL` map.
- Discard the existing `residential / luxury / commercial / ...` "
  &nbsp;
  3. `/dashboard/branding` MSP listing config (`src/routes/_authenticated.dashboard.branding.tsx`)

Extend `SPECIALTY_OPTIONS` so MSPs can check off the new scanning + vault tags when configuring their public marketplace listing. Group them in the form with the same two headings ("On-Site Scanning Services" / "Studio Presentation Services") so the MSP-side and agent-side vocabularies match.

All new tags are `proOnly: false` (available to Starter and Pro) — they describe what the MSP can deliver, not which platform tier they're on.

### 4. No changes required

- `search_msp_directory` RPC already returns the full `specialties` array — no SQL change needed beyond the enum addition.
- `BeaconForm`, `/opportunities`, `/dashboard/marketplace` are unaffected.
- `vault_assets` / `vault_templates` are not touched — these are *self-declared* tags on the listing, not auto-derived from the MSP's actual vault contents (matches how the Marketplace Listing form already works for `ai-specialist` etc.).

## Files to edit

- `supabase/migrations/<new>.sql` — `ALTER TYPE marketplace_specialty ADD VALUE …` (×12)
- `src/routes/agents.tsx` — restore filter arrays, split into two groups, update render
- `src/routes/_authenticated.dashboard.branding.tsx` — extend `SPECIALTY_OPTIONS`, group in UI

## Out of scope (call out for later)

- Auto-deriving the Studio tags from each MSP's actual `vault_assets` row counts (e.g. only show "Sound Library" if they have ≥ N audio assets). The current MVP keeps these as self-declared — same as today's `ai-specialist` tag.
- A pricing-tier badge on the directory card (the older `calculatePricingTier` helper from b2cd250). Branding now uses live `base_price_cents` via the RPC, so this can be a follow-up if you want the $/$$/$$$ glyph back.