## Findings

The admin service-match detail URL is registered, but the route hierarchy is wired incorrectly:

```text
/admin
  /service-matches          <- table page
    /$matchToken            <- detail page
```

Because `/admin/service-matches` currently renders the table directly and does not render an `<Outlet />`, the child route `/admin/service-matches/$matchToken` can match but its detail component is not mounted. That explains why clicking **Open** appears to do nothing or lands back in an existing dashboard/admin view instead of showing the match details.

I also found a second risk: the admin layout redirects to `/dashboard` when `roles` is still empty, even if the user session has loaded but role lookup has not completed yet. This can create intermittent false redirects to the MSP Dashboard Overview.

## Safest fix plan

1. **Repair the admin service-match route hierarchy**
   - Convert `src/routes/_authenticated.admin.service-matches.tsx` into a lightweight layout route that renders `<Outlet />`.
   - Move the current request table UI into a new index child route at `src/routes/_authenticated.admin.service-matches.index.tsx`.
   - Keep the existing detail route at `src/routes/_authenticated.admin.service-matches.$matchToken.tsx` so `/admin/service-matches/:token` renders inside the service-match layout.
   - This is the least invasive fix because it preserves the public URL structure and avoids forcing all admin links to change again.

2. **Harden admin auth-role loading**
   - Update `useAuth()` so `isLoading` remains true until roles are fetched for the signed-in user.
   - Update the admin layout so it does not redirect to `/dashboard` while roles are still being resolved.
   - This prevents valid admins from being bounced to the MSP Dashboard Overview during a direct deep-link load.

3. **Verify the detail route and public visitor route wiring**
   - Confirm the admin table **Open** button still targets `/admin/service-matches/$matchToken`.
   - Confirm the admin detail page’s **Open visitor view** button targets `/agents/match/$matchToken` only for the PII-free public visitor view.
   - Leave `/agents/match/$matchToken` public and PII-free per the service-match privacy requirement.

4. **Check backend function calls without widening access**
   - Keep `get_service_match_detail_for_admin(p_match_token)` admin-only.
   - Keep `get_service_match_summary`, `get_service_match_results`, and `record_service_match_interest` behavior unchanged unless validation shows a specific failure.
   - Do not expose visitor PII outside the admin-only route.

5. **Validation after implementation**
   - Open `/admin/service-matches` and confirm the request table renders.
   - Open `/admin/service-matches/40449da8-cdf8-4c1b-bf31-5524f73c8a6c` directly and confirm the admin detail component renders rather than the dashboard overview.
   - Confirm the page calls `get_service_match_detail_for_admin` and shows either visitor details plus MSP matches or a clear “not found” state.
   - Open `/agents/match/40449da8-cdf8-4c1b-bf31-5524f73c8a6c` and confirm it remains a separate public visitor match page with no visitor PII.