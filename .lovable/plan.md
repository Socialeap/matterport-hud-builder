## Diagnosis

The admin test now successfully enqueues the email, but the queue processor is not draining it.

Evidence found:
- The latest send route returned `200` and logged `Transactional email enqueued`.
- `email_send_log` shows the latest message stuck at `pending`.
- `pgmq.q_transactional_emails` still contains queued messages.
- The scheduled queue processor is firing every 5 seconds, but every call to `/lovable/email/queue/process` returns `403`.
- The configured sender domain `notify.3dps.transcendencemedia.com` is still in failed verification state, so even after queue auth is fixed, final delivery may remain blocked until the email domain is repaired in Cloud → Emails.

## Root Cause

The immediate failure is not the admin UI or template rendering. The background queue processor is being called, but it rejects the cron request with `403`, so queued emails never reach the send attempt stage.

Most likely cause: the stored cron credential / service-role secret used by the email queue job is stale or mismatched with the app runtime. This is consistent with the repeated `403` responses and the guidance for recovering queue processors after key rotation or infrastructure drift.

## Safe Fix Plan

1. **Refresh email queue infrastructure using the existing managed setup**
   - Re-run the email infrastructure setup for this project.
   - This is the safest path because it is designed to be idempotent and refreshes the queue cron job and stored queue credential without hand-editing cron SQL or secrets.
   - Do not manually rewrite queue infrastructure SQL.

2. **Verify the cron job is repaired**
   - Confirm the `process-email-queue` job still exists and is active.
   - Confirm recent cron HTTP responses stop returning `403`.
   - Confirm the queue table count decreases or the stuck pending message receives a later terminal log entry (`sent`, `failed`, or `dlq`).

3. **Improve app-side diagnostics only if needed**
   - If the repaired processor reaches the send attempt and fails, keep changes narrow:
     - Surface the latest queue failure in the Admin Portal status panel instead of only timing out as `pending`.
     - Add safe non-secret diagnostics to the queue route logs if current logs are insufficient.
   - Avoid UI redesigns or unrelated route changes.

4. **Handle sender-domain failure separately**
   - Since `notify.3dps.transcendencemedia.com` is currently failed, email delivery may still fail after the processor starts working.
   - The expected next-stage error should become visible in `email_send_log` once the processor can run.
   - If delivery is blocked by domain verification, the required action is to repair/re-run sender domain setup in Cloud → Emails, not to bypass the email system.

5. **Update `BACKEND_ACTIVATION.md`**
   - Record that backend activation is required for the email queue repair.
   - Include the exact activation action, verification checks, expected results, and note that no destructive database changes are intended.

## Files/Areas Expected to Change

- `BACKEND_ACTIVATION.md`
- Possibly `src/routes/_authenticated.admin.settings.tsx` only if clearer queue-failure diagnostics are needed after backend verification
- Possibly `src/routes/lovable/email/queue/process.ts` only if runtime logs need safer/fuller non-secret error reporting

## Backend Activation Required

Yes.

Required action:
- Re-run the managed email infrastructure setup to refresh the queue processor cron job and queue credential.

Verification:
- Check cron job `process-email-queue` is active.
- Check recent queue processor calls no longer return `403`.
- Check queued app emails move out of indefinite `pending` into `sent`, `failed`, or `dlq` with a specific error.

Expected result:
- The Admin Portal should no longer time out while the email remains only `pending`; it should either confirm delivery or show the real delivery blocker, likely the currently failed sender domain verification.