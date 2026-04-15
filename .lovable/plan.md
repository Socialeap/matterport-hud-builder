# Wire Up Invitation Emails

## Problem

The "Send Invite" button only inserts a row into the `invitations` table. No email is actually sent — there is no email service configured, no email template, and no server route to dispatch invitation emails.

## Plan

### Step 1: Set up email domain

- Check current email domain status
- If none configured, prompt the email domain setup dialog
- Run email infrastructure setup (`setup_email_infra`)

### Step 2: Scaffold transactional email infrastructure

- Call `scaffold_transactional_email` to create the send server route, queue processing, suppression handling, and unsubscribe support
- Install required npm packages (`@lovable.dev/email-js`, `@lovable.dev/webhooks-js`, `@react-email/components`, `react-email`)

### Step 3: Create invitation email template

- Create `src/lib/email-templates/invitation.tsx` — a branded React Email template containing:
  - The MSP's brand name (or fallback)
  - A message like "You've been invited to create a branded presentation of your 3D Tour ."
  - A CTA button linking to the signup page with the invitation token as a query param (e.g., `/signup?token=<uuid>`)
- Register it in `src/lib/email-templates/registry.ts`

### Step 4: Create a server route to send the invitation email

- Create `src/routes/api/send-invitation.ts` — a server route that:
  1. Accepts `{ invitationId }` in the request body
  2. Authenticates the caller (must be the provider who owns the invitation)
  3. Looks up the invitation record to get the email and token
  4. Calls the `send-transactional-email` server route internally to dispatch the email
  5. Returns success/failure

### Step 5: Update the Clients page to call the server route

- After the successful `supabase.from("invitations").insert(...)`, call the new server route to trigger the actual email send
- Keep the existing toast but make it conditional on the email send succeeding

### Step 6: Handle signup via invitation token

- Update the `/signup` route to read a `?token=` query param
- After successful signup, mark the invitation as `accepted` and create the `client_providers` link

## Files Changed


| File                                              | Change                                           |
| ------------------------------------------------- | ------------------------------------------------ |
| `src/lib/email-templates/invitation.tsx`          | New invitation email template                    |
| `src/lib/email-templates/registry.ts`             | Register invitation template                     |
| `src/routes/api/send-invitation.ts`               | Server route to send invitation email            |
| `src/routes/_authenticated.dashboard.clients.tsx` | Call send-invitation after insert                |
| `src/routes/signup.tsx`                           | Handle `?token=` param, mark invitation accepted |


## Prerequisites

- Email domain must be configured (will prompt setup if needed)
- Email infrastructure must be set up
- Transactional email scaffold must be run