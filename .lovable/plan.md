## Problem

The admin **Email Test** action in `_authenticated.admin.settings.tsx` calls `sendTransactionalEmail()` → `POST /lovable/email/transactional/send`. Production logs show:

```
POST https://3dps.transcendencemedia.com/lovable/email/transactional/send → 500
```

Two concrete findings from investigation:

1. **No new row appears in `email_send_log`** for the failing attempts. The route inserts a `pending` row *before* calling `enqueue_email`. Since there is no `pending` row, the handler is throwing earlier than the enqueue step — somewhere in suppression check, unsubscribe-token upsert, or React Email render (`renderEmailHtml`). The handler does not wrap step 4 (render) in a try/catch, so a render error escapes as a raw 500 with no JSON body and no console log we can see.
2. **The client helper hides the real error.** `src/lib/email/send.ts` does:
   ```ts
   if (!response.ok) throw new Error(`Failed to send email: ${response.statusText}`)
   ```
   On HTTP/2 via Cloudflare, `statusText` is empty, which is exactly the user-visible toast: `Failed to send email:` (trailing colon, nothing after). It also throws away any JSON `{ error }` body the route does return for its handled failure paths (suppression check, token lookup, enqueue), so we can never see those messages either.

The send route itself (`src/routes/lovable/email/transactional/send.ts`) is otherwise sound: env vars, auth, suppression query, token upsert, and the `enqueue_email` RPC all exist (verified — `enqueue_email`, `read_email_batch`, `delete_email`, `move_to_dlq` are present in the DB).

## Plan

Scope is limited to the admin email tester path. No DB migrations, no template changes, no router or auth changes.

### 1. Make the client surface the real error
Edit `src/lib/email/send.ts` so when `!response.ok`:
- Read the response body once as text.
- Try `JSON.parse` and prefer `body.error`; fall back to the raw text; fall back to `HTTP <status>` if both are empty.
- Throw `new Error(message)` with that resolved message so the toast in `_authenticated.admin.settings.tsx` (`toast.error(err?.message …)`) shows the real cause.

No signature change. All other callers (`AdminInvite`, etc.) continue to work and now get clearer errors for free.

### 2. Wrap the render step in the send route
Edit `src/routes/lovable/email/transactional/send.ts` around section `// 4. Render React Email template…`:
- Put `React.createElement(...)`, `renderEmailHtml(element)`, `htmlToPlainText(html)`, and subject resolution inside a single `try { … } catch (err) { … }` block.
- On catch: `console.error('Render failed', { templateName, error: String(err) })`, insert a `failed` row into `email_send_log` with `error_message` set to a truncated `String(err)`, and return `Response.json({ error: 'Failed to render email template', detail: String(err) }, { status: 500 })`.

This converts the silent raw 500 into a structured JSON error that both the dashboard and `email_send_log` capture.

### 3. Re-test from the admin tester
After the two edits land, trigger the test from `/dashboard/admin/settings` again. Expected outcomes, one of:
- The toast now shows the real error (e.g. a render-time message, a `enqueue_email` permission error, etc.) and we fix that specific cause in a follow-up.
- The test succeeds because the prior failure was a transient render edge-case and the new try/catch path also no-ops on success.

Verification queries (run after retest):
```sql
SELECT message_id, template_name, status, error_message, created_at
FROM email_send_log
ORDER BY created_at DESC
LIMIT 5;
```
Expect a fresh row for the test attempt with either `status='pending'` (then `sent`/`dlq` from the cron) or `status='failed'` with a concrete `error_message` we can act on.

## Files changed

- `src/lib/email/send.ts` — parse and surface the real server error.
- `src/routes/lovable/email/transactional/send.ts` — wrap the render block in try/catch, log to `email_send_log`, return JSON 500.

## Backend activation

`Backend Activation Required: NO` — pure code changes. No migration, no Edge Function, no RLS, no secret changes.

## Out of scope (intentionally)

- Email queue dispatcher / cron job.
- Auth email hook (`auth-email-hook`).
- Template content or registry membership.
- Domain / DNS / `SENDER_DOMAIN` review.

If after step 3 the surfaced error points at any of these, we'll open a follow-up task.