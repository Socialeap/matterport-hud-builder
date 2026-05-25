## Plan

Fix the Netlify publish popup in `src/components/portal/PublishDistributeSection.tsx` using Gemini’s corrective approach, with the smallest safe change.

## Changes

1. **Fix invalid popup feature coordinates**
   - Update `left` and `top` inside `openNetlifyPublishWindow` to use `Math.round(...)`.
   - This prevents decimal values like `left=480.5` from invalidating the `window.open` feature string in Chrome/Safari.

2. **Remove cross-origin popup measurement**
   - Delete the `requestAnimationFrame` block that reads `publishWindow.outerWidth` / `outerHeight`.
   - That detection is unsafe for `https://app.netlify.com/drop` and can throw cross-origin security errors or produce unreliable results.

3. **Trust the browser result correctly**
   - If `window.open(...)` returns `null`, set `netlifyOpenedAs` to `"blocked"`.
   - If it returns a `Window`, store it in `lastPublishWindowRef`, sever `opener` best-effort, and set `netlifyOpenedAs` to `"popup"`.

4. **Clean up now-unused tab fallback state/UI**
   - Remove `tabOutcomeCountRef` because the app will no longer attempt unreliable tab detection.
   - Remove the `netlifyOpenedAs === "tab"` UI block and simplify the state type to `"popup" | "blocked" | null`.
   - Keep the existing manual “Open Netlify Drop in New Tab” link as the user-controlled fallback.

## Expected result

- Default browsers should honor the integer popup features and open Netlify Drop as a small floating window over `/builder`.
- If the browser blocks the popup, the existing blocked warning appears.
- The UI will no longer incorrectly report a successful popup as a regular tab due to cross-origin measurement.

## Files affected

- `src/components/portal/PublishDistributeSection.tsx` only.