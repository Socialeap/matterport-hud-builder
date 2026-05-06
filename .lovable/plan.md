# Limit property models per presentation (max 5)

## Recommendation: 5 max

5 is the right ceiling:
- The end-product HTML embeds each model's media, branding, and AI training payload inline. Past ~5 properties, file size, initial paint, and Matterport iframe pre-warming start to noticeably degrade the visitor experience on average connections.
- The HUD header property switcher and Contact-drawer list were laid out for a small, scannable set — beyond 5 they wrap awkwardly.
- Multi-property presentations are best framed as a curated showcase, not a catalog. Clients needing more should publish a second presentation, which keeps each .html lean and shareable.

## Changes

### 1. `src/lib/limits.ts` — single source of truth
Add:
```ts
export const MAX_PROPERTIES_PER_PRESENTATION = 5;
```

### 2. `src/components/portal/HudBuilderSandbox.tsx`
- In `handleAddModel`, guard against exceeding the cap. Show a toast: *"You've reached the 5-property limit for a single presentation. Remove a property or publish a second presentation to add more."*
- Pass `canAddMore` (`models.length < MAX`) and the limit value down to `PropertyModelsSection`.

### 3. `src/components/portal/PropertyModelsSection.tsx`
- Accept `canAddMore` and `maxModels` props.
- Disable the "Add Property" button when at the cap (with title/tooltip explaining why).
- Add a small helper note **next to the "Property Models" title** in the section header, e.g. *"Recommended 2–4 · max 5 per presentation"*. In `headless` mode the same note renders alongside the Add button row.

### 4. End-product HUD header — shift property switcher right (`src/lib/portal.functions.ts`)
The `#hud-prop-switch` lives inside `#hud-left-spacer` which only has `padding-left:8px`. The Matterport iframe renders its own title and search control in the top-left (~roughly the first 200–220px). Bump the spacer's left padding so the property dropdown clears that region:
```css
#hud-left-spacer{ ... ; padding-left: 220px; }
```
At narrow viewports we keep the hud header responsive — no change to the right side. This is a CSS-only tweak in the generated HTML, so it also fixes the Preview (which uses the same generator output).

## Out of scope
- No backend / schema changes. Cap is a UI guardrail; existing drafts with more than 5 properties continue to render — only adding a 6th from the builder is blocked.
- No change to the download/quality-check flow or the rest of the end-product generator.
