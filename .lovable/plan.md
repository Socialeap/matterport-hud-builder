## Diagnosis

The uploaded `Marriott_Marquis_2026-04-27.html` shows two separate failures:

1. **HUD wiring is too dependent on the main runtime finishing successfully.**
   - The generated file embeds very large Property Intelligence payloads before the main presentation script.
   - There is a safety bootstrap, but it only hides the welcome gate and sets the Matterport iframe source.
   - It does **not** wire the HUD toggle, open the HUD, update chevrons, or initialize audio.
   - If anything later in the large runtime path stalls or fails, the tour can load while the HUD appears non-functional.

2. **The selected music was not actually embedded in this generated file.**
   - The config inside the uploaded HTML contains `"musicUrl":""`.
   - Because the generated presentation has no audio URL, the `Start with Sound` button has nothing to play and the mute button stays hidden.
   - This likely happened because the persisted `saved_model` did not include the current enhancement/music selection at generation time, or the selected Sound Library asset could not be resolved and fell back to an empty manual `musicUrl`.

There is also a UX issue: the current gate always says `Start with Sound`, even when the generated config has no playable sound URL, which makes this look like a playback failure when the real issue is missing audio data.

## Safe fix

### 1. Make the presentation shell independently reliable
Update `src/lib/portal.functions.ts` so the pre-bootstrap safety script becomes a real shell bootstrap that:

- Parses the same config as the main script.
- Sets the first Matterport iframe URL immediately.
- Wires `#hud-toggle` immediately.
- Implements `window.__setHudVisible` and `window.__presentationSetHudVisible` early.
- Opens the HUD when the welcome gate is dismissed.
- Toggles chevrons correctly.
- Uses direct inline style fallbacks in addition to the `.visible` class:
  - `transform: translateY(0)`
  - `opacity: 1`
  - `pointerEvents: auto`
- Initializes the HUD text for the first property.
- Keeps the existing main runtime behavior, but makes it reuse/override these same globals instead of relying on a separate local-only `setHudVisible`.

This means even if Ask AI indexing, large embedded data, or a later script section has a problem, the user can still enter the tour, show/hide the HUD, and access visible header controls.

### 2. Harden HUD layering and mobile layout
Update the generated HUD CSS so it is less likely to be hidden behind iframe/compositor layers or pushed off-screen:

- Raise the HUD/toggle z-index above tabs/footer/iframe.
- Add compositor-safe properties such as `will-change`, `backface-visibility`, and `isolation` where appropriate.
- Keep `overflow: visible` on the HUD header.
- Add a mobile-safe wrapping rule for `#hud-inner` / `#hud-right` so the controls do not overflow at narrower viewport widths.

### 3. Make audio initialization resilient and truthful
Update the generated audio runtime in `src/lib/portal.functions.ts`:

- Add an early audio bootstrap in the safety script.
- Normalize audio URLs before comparing/assigning `audio.src`.
- Set `preload="auto"`, `playsInline`, `crossOrigin="anonymous"` where safe.
- Track play promise failures and show a clear console warning instead of swallowing them silently.
- Only show `Start with Sound` and the HUD mute button when at least one property has a resolved `musicUrl`.
- If there is no resolved audio, change the gate CTA to a neutral label like `Enter Tour` instead of promising sound.

### 4. Ensure the latest builder state is used when generating/re-generating
Update `src/components/portal/HudBuilderSandbox.tsx` so generation cannot use stale saved data:

- Before calling `generatePresentation`, re-save the current builder state when possible, including:
  - `models`
  - `agent`
  - `brandingOverrides`
  - `enhancements`
- Add `enhancements`, branding fields, and any upload-derived URLs to the `runDownload` dependency path so re-generation sees the latest state.
- Keep the current paid/released guard intact; the server will still enforce download permissions.

This directly addresses the uploaded file’s empty `musicUrl`: if the user selected a Sound Library track after the model was first saved, the regenerated HTML must persist that selection before the server builds the file.

### 5. Validate Sound Library resolution safely
In `generatePresentation`, improve Sound Library handling:

- Keep the current safe fallback behavior.
- Add non-sensitive console diagnostics when a selected `spatial_audio` asset ID does not resolve to an active audio URL.
- Preserve manual `Music URL` fallback if no valid Sound Library asset is found.
- Do not block HTML generation just because audio cannot be resolved.

### 6. Add regression checks
Update or add tests/scripts to catch this class of issue:

- Extend `scripts/verify-portal-html.mjs` to assert generated HTML includes:
  - early HUD bootstrap wiring,
  - `setHudVisible(true)` on gate dismiss,
  - audio gate conditional behavior,
  - no unconditional `Start with Sound` when no `musicUrl` exists.
- Run TypeScript/build checks after implementation.

## Expected result

After this fix:

- Clicking the dropdown chevron will show the HUD even if the later Ask/Property Intelligence runtime is slow or fails.
- Dismissing the welcome gate will reliably open the HUD header.
- The generated file will not advertise sound unless a valid audio URL is embedded.
- When a Sound Library track or manual music URL is selected, the generated HTML will include it and the Start with Sound / mute controls will work as browser autoplay rules allow.
- Re-generated files will reflect the latest property name/date naming convention and the latest saved builder state.