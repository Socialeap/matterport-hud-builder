## Findings

- The current **Notify Me When Matches Are Available** form still submits to the older `capture-beacon` function, not the newer service-match request flow.
- That older path successfully accepts a basic city/email beacon in direct tests, but it does **not** include the selected Essential/Preferable services and does **not** reliably create a visitor-facing **MSP Service Match** link for the selected-service workflow.
- The newer `capture-service-match` function successfully creates a request and returns a `match_token` in direct testing.
- The user-facing error is too generic, so browser/API failures are currently hidden behind “Could not submit. Please try again shortly.”

## Implementation plan

1. **Convert the Notify Me popup to the correct service-match flow**
   - Update `src/routes/agents.tsx` so the Notify Me dialog uses the service-match submission path with the current selected services.
   - Pass both Essential and Preferable service selections into the form.
   - Keep the existing single Notify Me CTA; do not restore the removed redundant “Create MSP Service Match” button.
   - If no services are selected, keep the user-facing validation clear: the visitor must mark at least one service Essential or Preferable before creating a service match.

2. **Make the submission more diagnosable and user-safe**
   - Update the form handling so backend response errors are surfaced more accurately in logs/console for debugging while still showing clean visitor copy.
   - Keep the backend’s server-side validation: at least one Essential or Preferable service, disjoint service arrays, consent required, valid email/location.
   - Update CORS headers for the service-match function to match browser Supabase function calls (`authorization`, `apikey`, `x-client-info`, `content-type`) so browser submissions cannot be blocked by preflight/header mismatches.
   - Deploy and test `capture-service-match` after the change.

3. **Add admin-only access to service-match notification requests**
   - Create a secure admin database RPC such as `get_service_match_requests_for_admin()` that returns only rows where the visitor selected at least one Essential or Preferable service.
   - Return the fields needed for the table: submission date, visitor name, company/brokerage, email, city, state, ZIP, selected Essential services, selected Preferable services, and match token.
   - Grant execution to authenticated users, with the function itself enforcing admin role checks server-side.

4. **Build the Admin Portal page**
   - Add a new protected admin route, likely `/admin/service-matches`.
   - Show a sortable table with ascending/descending controls for:
     - submission date
     - visitor name
     - email
     - selected services
     - location/ZIP
   - Render selected services as icons only, with tooltips/accessible labels rather than full labels in the cell.
   - Include visitor name, company, email, city/state/ZIP for admin identification.
   - Add an action/link to open the visitor’s `/agents/match/$matchToken` page.

5. **Wire navigation in the Admin Portal**
   - Add a clear Admin Portal link/tab/button from the existing admin landing page or header to the new notification-request table.
   - Preserve the existing admin role guard; no client-side-only role trust will be added.

6. **Verify**
   - Re-test the Notify Me flow from the MSP Directory with selected services, confirming the browser request succeeds and a match token is created.
   - Confirm a new row appears in the admin request table.
   - Confirm sorting toggles work and the match-page link opens correctly.