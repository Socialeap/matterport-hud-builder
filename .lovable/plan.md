

## Analysis

The `handleInvite` function in `dashboard.clients.tsx` does a simple `supabase.from("invitations").insert(...)`. It records the invitation in the database but **never sends an email**. The success toast is misleading — no email infrastructure is connected to this flow.

This is not a preview-mode limitation; it wouldn't send emails in production either.

## Plan

### 1. Set up email infrastructure (if not already done)
- Check email domain status
- If no domain is configured, prompt you to set one up via the email setup dialog
- Run email infrastructure setup (queue, tables, cron)

### 2. Scaffold transactional email support
- Set up the transactional email server routes and template registry

### 3. Create an "Invitation" email template
- A branded React Email template (`invitation.tsx`) containing:
  - Welcome message explaining they've been invited
  - A CTA button linking to `/signup?token={invite_token}`
  - Provider/platform branding
- Register it in the template registry

### 4. Wire up the invitation flow to send the email
- After the successful `invitations` insert, call `sendTransactionalEmail` with:
  - `templateName: 'invitation'`
  - `recipientEmail: email`
  - `idempotencyKey: 'invitation-{id}'`
  - `templateData: { inviteToken, providerName }`

### 5. Testing
- After publishing, you can test by inviting a real email address and checking the inbox
- In preview mode, emails won't send (the email queue cron job runs against the published app), but you can verify the invitation row is created and the send call succeeds without errors

### Technical details
- Uses Lovable's built-in email system (no third-party keys needed)
- Requires a verified email domain — if you don't have one yet, I'll guide you through setup first
- The invitation email template will match your app's existing styling

