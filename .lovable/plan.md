## Changes to `src/components/portal/PropertyModelsSection.tsx`

### 1. Property cards → single-open accordion

Replace the current `models.map(...)` rendering (each property as an always-open `<div className="rounded-lg border p-4 ...">`) with a Radix `Accordion` from `@/components/ui/accordion`:

- `<Accordion type="single" collapsible value={openId} onValueChange={setOpenId}>` — controlled so we can default-open the primary property.
- Each property becomes an `<AccordionItem value={model.id}>` with:
  - `AccordionTrigger`: shows the existing header row (Property N label, "Loads first" badge, "Load first" switch, behavior gear, delete) — keep current styling, including the primary-highlight border/bg classes on the item wrapper.
  - `AccordionContent`: holds all current body fields (Property Name, Address/Location, Matterport ID + Sync, Music URL, ManualMediaInputs, MediaAssetsList, Cinematic Video, Neighborhood Map block).
- Default open: `useState(() => primaryModel?.id ?? models[0]?.id ?? null)`. When a new model is added (`onAdd`), open it — handled by parent today, so add a `useEffect` that opens the last model if `models.length` grew.
- Action buttons inside the trigger (gear, trash, "Load first" switch) must call `e.stopPropagation()` in their `onClick`/`onCheckedChange` wrappers so they don't toggle the accordion.
- Override AccordionTrigger default `flex justify-between py-4` with classes that match current header (`px-4 pt-4 pb-2 hover:no-underline`), and keep the chevron.

### 2. Synced Media → collapsible (default closed)

In `MediaAssetsList`, wrap the existing list in `Collapsible` from `@/components/ui/collapsible` (default `open={false}`):

- Keep the current summary row (counts + "Sync more" button) always visible as the trigger area.
- Add a small chevron toggle button (`CollapsibleTrigger asChild`) next to "Sync more" labeled e.g. "Show/Hide".
- Move the `<ul>` of assets inside `<CollapsibleContent>`.
- "Sync more" button stays outside the trigger (its own click shouldn't toggle); ensure clicking it doesn't bubble.

### 3. No other files affected

Props, types, parent state, and generated HTML are unchanged. Purely a Builder Preview UX change.
