## Problem

In `src/components/portal/PublishDistributeSection.tsx` (`openNetlifyPublishWindow`, lines 243–284), the features string passed to `window.open` includes `"noopener"` and `"noreferrer"`.

Per the HTML spec, when `noopener` is present, `window.open` **always returns `null`**, even on a fully successful popup. The current code interprets a `null` return as "popup blocked" and sets `netlifyBlocked = true`, which is why the warning ("Your browser blocked the publish window…") appears every time — even though the Netlify Drop window actually opened.

## Fix

Remove `"noopener"` and `"noreferrer"` from the `features` array. Security is already preserved by the existing defensive `publishWindow.opener = null` assignment immediately after the open call (and the popup is cross-origin, so it cannot read into 3DPS regardless).

After the change:
- `window.open` returns the real `Window` reference on success → `setNetlifyBlocked(false)` + `setNetlifyOpened(true)` runs, warning stays hidden.
- A genuine popup block still returns `null` → warning correctly shows.

### Change (single edit)

`src/components/portal/PublishDistributeSection.tsx`, in the `features` array (lines 249–258): delete the `"noopener"` and `"noreferrer"` entries. Leave the rest of the function — including the `publishWindow.opener = null` cleanup — untouched.

## Verification

1. Click "Open Netlify Publish Window" → popup opens, no warning underneath.
2. Block popups for the site in the browser, click again → popup is blocked, warning appears as intended.
3. Confirm the popup cannot navigate the parent 3DPS tab (opener already nulled).

No other files, routes, server functions, or styles are affected.