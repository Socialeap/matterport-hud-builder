# Fix: "Review" button on /admin/atlas-curation appears unresponsive

## Root cause

The Review button (row action in the jobs table) DOES fire — it calls `setSelectedId(j.id)` and React mounts `<JobReviewPanel />`. The problem is purely positional:

In `src/routes/_authenticated.admin.atlas-curation.tsx` the page is laid out as:

```
[Header]
[Create-and-enrich form]
[Review panel]        ← renders here when selectedId is set (line 591-609)
[Jobs table]          ← Review buttons live here (line 665)
```

When the admin scrolls to the bottom of the page to click "Review" on a job row, the panel mounts hundreds of pixels above the viewport. Nothing visibly changes near the click target, so the button feels broken. There is no thrown error, no failed server call, no auth issue — the panel is simply off-screen.

This also explains why the rest of the curation flow (Generate package → Open PR → Mark deployed) is currently blocked: those controls all live inside the panel the user can't see.

## Fix (frontend only, surgical)

1. Add a ref to the Review panel wrapper: `const reviewPanelRef = useRef<HTMLDivElement>(null)`.
2. Wrap the `{selected && <JobReviewPanel … />}` block in a `<div ref={reviewPanelRef} … />` so we have a stable scroll target.
3. Add an effect that runs when `selectedId` becomes non-null:
   ```ts
   useEffect(() => {
     if (!selectedId) return;
     // Wait one frame so the panel is in the DOM before scrolling.
     requestAnimationFrame(() => {
       reviewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
     });
   }, [selectedId]);
   ```
4. Tiny UX nicety in the row action: keep the existing `onClick={() => setSelectedId(j.id)}` — no behavior change beyond scroll. If `selectedId` is already this row, the effect still re-runs and re-scrolls, which is the desired "take me back to the panel" behavior.

Optional (same edit, no scope creep): give the panel container `id="curation-review-panel"` and add `scroll-margin-top: 5rem` so it isn't tucked under any sticky header.

## Out of scope

- No changes to server functions (`listCurationJobs`, `createAtlasEntryFromJob`, `generateCuratedPackage`, `publishCuratedShowcase`, `markShowcaseDeployed`, `verifyDeployedShowcase`).
- No changes to RLS, migrations, secrets, or `BACKEND_ACTIVATION.md`.
- No layout reshuffle of the page (moving the panel below the table would be more invasive and would break existing muscle memory / docs).
- No changes to Atlas curation runtime, HUD, Explore Together, billing, outreach, or Map Oracle.

## Verification

1. Open `/admin/atlas-curation`, scroll to the jobs table, click **Review** on the Opera Gallery New York row.
2. Page smoothly scrolls up to the highlighted "Review curated job" panel.
3. Form fields are populated from the job's draft; Save / Mark ready / Generate package buttons are now reachable.
4. Click **Review** on a different row → panel updates and re-scrolls into view.
5. Click **Close** in the panel → panel unmounts, scroll position is preserved (no jump).

## Backend Activation Required: NO
Reason: Frontend-only UX fix — adds a ref, a wrapper `div`, and a `useEffect` that calls `scrollIntoView`. No schema, RLS, secret, server function, or edge function changes.
