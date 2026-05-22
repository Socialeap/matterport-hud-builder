## Goal

PR #95 updated `supabase/functions/fetch-mattertags/index.ts` to address the "Couldn't authenticate with Matterport…" response from the previous test. Redeploy the function to Supabase project `cllvwdzjgqlkdquroauz` and re-run the same verification suite to confirm the new code is live and behaving correctly.

## Steps

1. **Pull latest** — Confirm the working tree has the PR #95 version of `supabase/functions/fetch-mattertags/index.ts` (diff vs. what's currently deployed). If the file in the sandbox is stale, sync from `main` first.

2. **Redeploy** — `supabase--deploy_edge_functions` with `function_names: ["fetch-mattertags"]`. Confirm deploy succeeds.

3. **Smoke tests** (same matrix as last time, via `supabase--curl_edge_functions`):
   - **CORS preflight**: `OPTIONS /fetch-mattertags` → expect HTTP 200 + the three `access-control-allow-*` headers.
   - **POST with public model**: `POST /fetch-mattertags` with `{ "matterportId": "SxQL3iGyoDo" }` → expect HTTP 200 with JSON body. Compare the new response shape/error message against the pre-PR baseline to confirm PR #95's auth-handling change is in effect.
   - **`verify_jwt = false` check**: confirm no 401 is returned (request sent without auth header).

4. **Log check** — `supabase--edge_function_logs` for `fetch-mattertags`, filter for errors from the test invocations. Report any stack traces or Matterport-side failures.

5. **Report back** — summary of: deploy status, three test outcomes, any log anomalies, and whether the function is ready for the live Builder UI test.

## Done criteria

- Function redeployed successfully on the latest commit.
- OPTIONS returns 200 with CORS headers.
- POST returns 200 with a JSON body (success or graceful error — not 5xx, not 401).
- No new unhandled exceptions in edge function logs.

## Not in scope

No code edits. If a test fails in a way that points to a bug in PR #95, I'll report findings and ask before changing code.
