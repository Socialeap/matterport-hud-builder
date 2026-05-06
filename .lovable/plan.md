## Goal

Replace the full-width "Notify me when a fitting Pro Partner is matched in my area" collapsible at the top of the Directory `Card` with a compact button that opens a **modal dialog**. Move the button from the top of the container to the **right side, above the Sample Studios / results column**.

## Changes — `src/routes/agents.tsx` (DirectorySection)

1. **Remove the existing top-of-card Collapsible** (lines ~610–636) that currently wraps the BeaconForm.
2. **Add a Dialog** (from `@/components/ui/dialog`) controlled by local state `notifyOpen`. Contents:
   - Title: "Notify me when a Pro Partner is matched in my area"
   - Short description paragraph (same gist as the current helper text — pick services in the rail and set city/ZIP in the search; we'll email when a match activates).
   - `<BeaconForm defaultCity={city} defaultRegion={region} defaultZip={zip} variant="dark" hideLocationFields />`
   - `onSuccess` closes the modal.
   - Use `DialogContent` with `sm:max-w-lg` and dark styling consistent with the page (`bg-[#0a0e27] border-white/10 text-white`).
3. **Place the trigger button above the results column**, inside the right grid cell (the `<div className="space-y-4">` that holds results), as the first child so it sits above `DemoPreview`, the no-results panel, and the live-results list. Layout:
   ```
   <div className="flex justify-end">
     <DialogTrigger asChild>
       <Button size="sm" variant="outline" className="gap-2 border-cyan-300/40 bg-cyan-300/5 text-cyan-100 hover:bg-cyan-300/10 hover:text-white">
         <MailCheck className="size-4" />
         Notify me when matched
       </Button>
     </DialogTrigger>
   </div>
   ```
   Smaller footprint (sm size, right-aligned) so it doesn't span the container.
4. **Drop the now-unused `Collapsible` imports** if no other usage remains in the file.
5. **Leave the existing no-results inline `BeaconForm`** untouched — it's a different surface (post-search empty state) and still reads naturally there.

## Technical notes

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogTrigger` are already exported from `src/components/ui/dialog.tsx`.
- `BeaconForm` already supports `hideLocationFields` and reads `defaultCity/Region/Zip` live from props, so the search rail values flow into the modal automatically when it opens.
- No DB, edge function, or schema changes required.

## Files touched

- `src/routes/agents.tsx`
