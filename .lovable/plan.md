

## Cinematic Video Integration — Plan

### Scope
Add an optional cinematic video per property (YouTube/Vimeo/Wistia/Loom/.mp4), surfaced as a "Cinema Mode" button in the HUD that opens a lazy-loaded modal. Un-gated (no LUS check).

### Files to change

**1. New utility: `src/lib/video-embed.ts`**
- Pure function `parseCinematicVideo(url: string): { kind: "iframe" | "mp4" | "invalid"; embedUrl: string; provider: "youtube"|"vimeo"|"wistia"|"loom"|"mp4" }`
- Regex extractors per provider (handles `youtu.be/ID`, `youtube.com/watch?v=ID`, `vimeo.com/ID`, `wistia.com/medias/ID`, `loom.com/share/ID`).
- Returns minimalist embed URLs per spec.
- Trim/validate; empty → invalid.

**2. Data model: `src/components/portal/types.ts`**
- Add `cinematicVideoUrl?: string` to `PropertyModel`.

**3. Builder UI: `src/components/portal/PropertyModelsSection.tsx`**
- Add one input under the existing Music URL field: "Cinematic Video URL (YouTube, Vimeo, Loom, Wistia, or .mp4)".
- Inline validation hint when URL is non-empty but unparseable.

**4. Sandbox state: `src/components/portal/HudBuilderSandbox.tsx`**
- Initialize `cinematicVideoUrl: ""` in `createEmptyModel`.

**5. New component: `src/components/portal/CinemaModal.tsx`**
- Props: `open`, `onClose`, `videoUrl`.
- Parses URL on render; renders `<iframe>` or `<video autoPlay controls>` only when `open === true` (lazy mount; unmounts on close to kill audio/scripts).
- Centered 16:9 container, `rounded-2xl`, soft shadow.
- Backdrop: fixed overlay with `backdrop-blur-md bg-black/60`, click-to-close.
- Top-right X close button.
- Esc key closes.

**6. HUD trigger: `src/components/portal/HudPreview.tsx`**
- When active property has a valid parsed `cinematicVideoUrl`, render a `Film` (lucide-react) icon button alongside existing HUD tools.
- Local state `cinemaOpen`; renders `<CinemaModal />` conditionally.

### Performance guardrails
- `CinemaModal` returns `null` when closed → iframe/video never enters DOM until clicked.
- On close, component unmounts → `src` removed → background audio stops.
- No preconnect / no preload — strict lazy.

### Non-goals
- No LUS gating (per spec — un-gated).
- No analytics on play events (future).
- No upload UI — link-only.
- No persistence migration needed beyond the existing `tour_config` JSON (field flows through naturally; round-trip already covered by saved_models JSON storage).

### Technical notes
- Reuse existing Dialog primitives only if they support full-bleed backdrop; otherwise use a plain portal `<div>` overlay for full control over blur + click-to-close (the spec's blur effect is custom enough that a bare overlay is cleaner than overriding shadcn's `DialogOverlay`).
- Keep the parser pure & unit-testable (no DOM, no React).

