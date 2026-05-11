## Diagnosis

The published site is still serving `/assets/index-B_IvnPv_.js`, and that bundle contains:

```ts
var nC = {};
function MF() {
  const e = nC.SUPABASE_URL;
  const t = nC.SUPABASE_PUBLISHABLE_KEY;
  if (!e || !t) throw new Error("Missing Supabase environment variables...");
}
```

That means the production bundle did not receive the backend client env values during build. The Wondershare blocked request is unrelated browser-extension noise.

The preview environment has the required variables present, and the project secrets include `PRESENTATION_TOKEN_SECRET` and `INTERNAL_GEOCODE_SECRET`, so the immediate failure is build-time env injection for the published frontend, not missing B1 secrets.

## Safest repair plan

1. **Add a client-safe env adapter**
   - Create a small module that resolves the publishable backend URL/key from `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`.
   - Add compatibility aliases for the managed values already known to this project if Vite’s env object is transformed unexpectedly in production.
   - Keep only publishable client values here; do not expose service-role or private secrets.

2. **Wire the generated client through the adapter, without changing auth behavior**
   - Update `src/integrations/supabase/client.ts` only minimally to call the adapter for `url` and `publishableKey`.
   - Keep the existing lazy proxy, `localStorage` guard, session persistence, and auto refresh behavior intact.
   - Do not touch `src/integrations/supabase/types.ts`.

3. **Improve failure mode without masking configuration errors**
   - Keep a clear thrown error if both normal env injection and safe fallback aliases are unavailable.
   - This prevents silent unauthenticated or partially broken operation.

4. **Force a new frontend bundle hash**
   - The code change itself will create a real source delta, so the Publish button should become active.
   - Remove or leave the previous rebuild comment only if needed; no functional logic should depend on it.

5. **Validation before handing back**
   - Confirm the local env names are present without printing values.
   - Inspect the generated dependency path: root route → auth provider → browser auth hook → Supabase client → env adapter.
   - Check the published HTML after you publish/update: it must no longer reference `index-B_IvnPv_.js`.
   - Confirm the live bundle no longer contains `var nC = {};` for the Supabase client and that the homepage loads without the “Something went wrong” error.

## Why this is safer than alternatives

- **Not hardcoding private secrets:** only publishable frontend values can ever be bundled.
- **Not editing backend/generated types:** avoids breaking Lovable Cloud integration and generated database typings.
- **Not changing routing or auth flows:** the crash happens before routing finishes; changing route files would risk unrelated regressions.
- **Not relying only on no-op comments:** the earlier marker did not produce a new published bundle, so this adds an actual durable env-resolution fix plus a rebuild trigger.