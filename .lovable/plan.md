## Updated diagnosis

`sample3dps.netlify.app` showing Netlify’s “Site not found” does **not** necessarily mean the name is globally available. The most likely failure chain is:

```text
1. The app created/reserved a Netlify site named sample3dps.
2. The deploy upload/build step failed or was miswired before content went live.
3. The Netlify name is now reserved inside the connected Netlify account.
4. A later publish tries POST /sites with sample3dps again.
5. Netlify correctly returns 422: subdomain must be unique.
6. The public URL still shows “Site not found” because that reserved site has no successful deploy yet.
```

So the real bug is not only “slug unavailable.” The publish flow is **not idempotent**: it always tries to create a brand-new Netlify site instead of reusing/updating an existing site owned by the connected account.

## Final fix plan

1. **Change Netlify publish from “always create” to “create-or-reuse”**
   - In `src/routes/api/public/netlify-deploy.ts`, before creating a site, try to find an existing site in the connected Netlify account with the requested name.
   - If it exists and is accessible with the user’s Netlify OAuth token, reuse that site ID and upload the new presentation build to it.
   - This recovers prior failed/empty sites like `sample3dps` and preserves the user’s intended URL.

2. **Handle 422 `subdomain must be unique` correctly**
   - If `POST /sites` returns 422, inspect the response body.
   - If it says `subdomain must be unique`, do **not** immediately fail or auto-rename.
   - First attempt to load the site by name from the connected Netlify account.
     - If found: deploy to that existing site.
     - If not found: the name is owned by someone else or unavailable, then generate a unique fallback name.

3. **Add safe fallback naming only when truly needed**
   - If the requested slug is genuinely unavailable to this account, generate a valid fallback like:
     ```text
     sample3dps-k7m4q2
     ```
   - Keep Netlify’s 63-character limit by trimming the base slug before appending the suffix.
   - Try a bounded sequence of fallback names, then return a clear error only if all attempts fail.

4. **Deploy to the selected site, not to a newly assumed URL**
   - Once the route has a `siteId`, upload the zip to that exact site.
   - Poll the deploy until Netlify reports it is ready.
   - Verify the live URL responds before returning success when possible.
   - Never return `undefined.netlify.app`; fail loudly if Netlify does not return a usable site name or URL.

5. **Improve UI messaging**
   - If the requested URL was recovered/reused, show success at the original URL.
   - If a fallback URL was required, show a warning explaining the requested Netlify URL was unavailable and the presentation was published at the generated URL.
   - Keep the final live URL displayed as the source of truth for share links and QR codes.

6. **Add regression checks**
   - Add/adjust focused tests for Netlify error classification so this exact response is treated correctly:
     ```json
     {"errors":{"subdomain":["must be unique"]}}
     ```
   - Include coverage for: existing owned site reuse, true external-name conflict fallback, missing final URL rejection, and root `index.html` zip validation.

## Expected result

Publishing to `sample3dps` should now either:

- reuse the already-created empty `sample3dps` Netlify site and successfully deploy content to `https://sample3dps.netlify.app/`, or
- only if that name is not accessible in the connected Netlify account, publish to a generated available URL and clearly show that final URL.