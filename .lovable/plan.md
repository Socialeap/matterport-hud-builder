## Diagnosis

The current failure is no longer the earlier `undefined.netlify.app` or name-conflict problem. The live Netlify URL now exists, but the root request returns `HTTP 429` with an empty body from Netlify itself. Server logs show the latest publish route returned `200`, while an earlier attempt timed out waiting for the deploy. Netlify’s API limits deploy creation to roughly 3 deploys/minute and 100/day, and the current route can repeatedly create deploys while retrying/debugging. It also treats Netlify `deploy.state === "ready"` as sufficient, then only logs live URL verification failure instead of blocking success.

## Final fix

1. **Make publish validation strict, not optimistic**
   - Change `/api/public/netlify-deploy` so it does not return success unless the final production URL returns a valid `200` HTML page containing expected presentation markers.
   - If Netlify returns `429`, return a clear retry-after/rate-limit error to the UI instead of presenting a broken URL as live.
   - Preserve the final Netlify request ID/status in server logs for support-grade diagnostics.

2. **Throttle and debounce publish attempts per user/site**
   - Add a short server-side guard for Netlify deploy calls so one user cannot accidentally fire repeated deploys for the same slug while a previous deploy is processing.
   - If a publish is attempted too soon after a previous deploy, return an actionable message instead of creating another Netlify deploy and worsening the rate-limit state.
   - This directly addresses the 429 loop and prevents repeated "final chance" retries from poisoning the same Netlify site.

3. **Use Netlify’s ZIP deploy API in the safest supported mode**
   - Keep create-or-reuse site resolution, but move deploy upload to a helper that can fall back between the supported ZIP deploy patterns if needed:
     - `POST /sites/{siteId}/deploys` with raw `application/zip`
     - `PUT /sites/{siteId}` with raw `application/zip` as the documented equivalent fallback
   - Poll the specific deploy ID and then verify the production site root, not only the deploy object.

4. **Recover previously broken/empty sites**
   - When reusing an owned site like `tmsample3dps`, inspect the latest deploy state before uploading.
   - If a previous deploy is still processing, wait briefly instead of starting a new deploy.
   - If the site is rate-limited, surface that status and stop rather than uploading again.

5. **Validate the ZIP contents before upload**
   - Replace the current weak `index.html` byte-string check with a real ZIP central-directory inspection using the already-installed `fflate` package.
   - Require root-level `index.html` and reject dangerous Netlify config entries (`_headers`, `netlify.toml`, unexpected root redirects) so generated packages cannot accidentally create rate-limit or redirect rules.
   - Add size/file-count limits and path traversal protection.

6. **Improve client feedback and retries**
   - Update the publish UI so it distinguishes:
     - packaging
     - upload accepted
     - deploy processing
     - live URL verification
     - Netlify rate-limited / retry later
   - Prevent double-click or repeated publish attempts while the previous attempt is active.
   - Do not display/share QR codes unless the verified live URL is healthy.

7. **Regression coverage**
   - Extend tests around Netlify helper logic for:
     - `429` live URL verification
     - deploy timeout
     - owned-site reuse
     - zip missing root `index.html`
     - forbidden `_headers`/`netlify.toml`
     - no `undefined.netlify.app` response

## Expected result

Publishing should either produce a verified, working URL like `https://tmsample3dps.netlify.app/`, or stop with a precise message such as: "Netlify is rate-limiting this site right now; wait a few minutes before retrying." It will no longer mark a presentation as live while Netlify is returning `404` or `429`, and it will avoid repeated deploy attempts that trigger more rate limiting.