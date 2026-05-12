## Changes to `/dashboard/branding`

### 1. Calling Card pill: center the studio name + raise limit to 30

**File:** `src/components/branding/CallingCard.tsx` (CardFront)
- Change the studio-name overlay from left-aligned to **horizontally centered** so any name length sits dead-center inside the green pill. Wrap the `<span>` in a `flex items-center justify-center` container (text-align center, no `text-left`).
- Replace `slice(0, 25)` with `slice(0, 30)`.

**File:** `src/components/branding/CallingCardSection.tsx`
- Studio Name `<Input maxLength={25}>` → `maxLength={30}`.
- `e.target.value.slice(0, 25)` → `slice(0, 30)`.
- Counter `{studioName.length}/25` → `/30`.

### 2. Convert sections to horizontal tabs sharing one container

**File:** `src/routes/_authenticated.dashboard.branding.tsx`

Use the existing shadcn `Tabs` primitive (`@/components/ui/tabs`). Replace the current vertical stack of `<Card>` sections with a single tabbed container. Each tab body keeps its current contents — no business logic changes, no field renames, no removal of any feature.

**Tab order (left → right):**

| Tab | Short label | Contains |
|---|---|---|
| 1 | Identity | Current "Brand Identity" card body (brand name, gate label, accent/HUD colors, logo/favicon, hero background + dimming) |
| 2 | Studio URL | "Studio URL" card body **merged with** "Whitelabel Settings" card body (slug + custom domain + locked-state upgrade prompt) |
| 3 | Card | Current `CallingCardSection` |
| 4 | Marketplace | "Marketplace Listing" card body (toggle, city/state, ZIPs, contact, specialties) |
| 5 | Service Area | The existing conditional Service Area card. Tab is disabled (greyed) when `branding.is_directory_public` is false, with a hint tooltip "Enable Marketplace Listing first." |
| 6 | Preview | `StudioPreviewPanel` |

Labels are kept short (≤11 chars) so the `TabsList` with `grid grid-cols-6 w-full` distributes them evenly across the page width. Use `text-xs sm:text-sm` for responsive fit on small viewports.

The Whitelabel merge inside the Studio URL tab renders as two stacked subsections separated by a `<Separator />` with their own H4 headers ("Public URL Slug" and "Custom Domain / Whitelabel"), preserving the lock state and upgrade CTA exactly as today.

### 3. Move Save button to the page header

- Remove the bottom `<div className="flex justify-end"><Button>Save Changes</Button></div>`.
- In the top header row (where the `Tier` badge lives), restructure to:
  ```
  [Title + subtitle]      [Save Changes]  [Tier pill]
  ```
  Save button uses `size="sm"`, sits immediately to the left of the Tier badge, shows "Saving…" while in flight, and is disabled when `!hasUnsavedChanges` to give visual feedback that there's nothing to save.

### Out of scope (not touched)
- Save handler logic, validation, geocoding, polygon RPC, marketplace matcher trigger.
- Database schema, RLS, edge functions.
- The CallingCard's logo overlay coordinates and back-face hotspots.
- Container-width container (`max-w-3xl`) is kept so the tabbed view sits at the same page width.

### Files edited
1. `src/components/branding/CallingCard.tsx` — pill centering + 30-char slice.
2. `src/components/branding/CallingCardSection.tsx` — 30-char input limit/counter.
3. `src/routes/_authenticated.dashboard.branding.tsx` — Tabs refactor, Whitelabel merge into Studio URL tab, Save button relocation.
