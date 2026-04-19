

## Audit findings — most of this is already done

A surgical audit of the three files shows the previous turn already implemented the bulk of the requested work:

| Spec item | Status | Evidence |
|---|---|---|
| 1.1 Use `createStripeClient(env)` | ✅ Done | `stripe-connect-onboard/index.ts:48` |
| 1.2 Accept `environment` from body | ✅ Done | lines 44–45 |
| 1.3 Catch "managing losses" / "platform-profile" → 400 | ✅ Done | lines 72–84 |
| 1.4 Persist `stripe_connect_id` | ✅ Done | lines 87–90 |
| 2.1 Pass `environment: getStripeEnvironment()` | ✅ Done | branding.tsx:366 |
| 2.3 Surface real error in toast | ✅ Done | branding.tsx:373–376 |
| 3 DB sync of `stripe_connect_id` | ✅ Done | column exists, written on create, read by status function |

**Three real gaps remain** that prevent the "Connected" badge from appearing after redirect:

### Gap A — `stripe-connect-status` is hardcoded to sandbox

`stripe-connect-status/index.ts:52` always uses `env: StripeEnv = "sandbox"`. If the onboarding ran in `live`, the status check retrieves the wrong account (or fails) and `onboarding_complete` never flips to true. **Fix:** accept `environment` from request body, default to `'sandbox'`, pass it to `createStripeClient`.

### Gap B — Frontend only checks for `stripe_connect_return=1`, not `stripe_connect_success=true`

The user's spec explicitly calls out `stripe_connect_success=true`. Today the code checks only `stripe_connect_return`. Stripe always returns to `return_url` regardless of completion, so accepting both markers makes the success path more robust. **Fix:** trigger the status check if **either** query param is present, and pass `environment` into the status invoke call.

### Gap C — On success we patch local state but don't refetch

After a successful return the code does `setBranding(prev => ({ ...prev, stripe_onboarding_complete: true }))`. Better to call `fetchBranding()` so the full DB row reloads — that way we also pick up `stripe_connect_id` and any concurrently-changed fields, and survive a remount cleanly.

## Changes (2 files)

### 1. `supabase/functions/stripe-connect-status/index.ts`

Make environment configurable so it matches whichever environment was used to onboard:

```ts
const body = await req.json().catch(() => ({}));
const { environment } = body as { environment?: StripeEnv };
const env: StripeEnv = environment === "live" ? "live" : "sandbox";
const stripe = createStripeClient(env);
```

(replace the hardcoded `const env: StripeEnv = "sandbox";` on line 52)

Note: Supabase `functions.invoke` always sends a POST with a JSON body, so reading the body is safe.

### 2. `src/routes/_authenticated.dashboard.branding.tsx`

Replace the return-handler `useEffect` (lines 110–124) with a version that:
- Triggers on either `stripe_connect_return` **or** `stripe_connect_success=true`
- Passes `environment: getStripeEnvironment()` to the status check
- Calls `fetchBranding()` on success instead of patching state, then shows the toast
- Cleans up **both** query params from the URL

```ts
useEffect(() => {
  const url = new URL(window.location.href);
  const hasReturn = url.searchParams.has("stripe_connect_return");
  const hasSuccess = url.searchParams.get("stripe_connect_success") === "true";
  if ((hasReturn || hasSuccess) && user) {
    supabase.functions.invoke("stripe-connect-status", {
      body: { environment: getStripeEnvironment() },
    }).then(({ data }) => {
      if (data?.onboarding_complete) {
        fetchBranding();
        toast.success("Stripe account connected successfully!");
      } else {
        toast.info("Stripe onboarding not yet complete. Finish all required steps in Stripe.");
      }
    });
    url.searchParams.delete("stripe_connect_return");
    url.searchParams.delete("stripe_connect_success");
    window.history.replaceState({}, "", url.toString());
  }
}, [user, fetchBranding]);
```

That's it — no DB migration needed, the schema already has `stripe_connect_id` and `stripe_onboarding_complete`.

## Ripple safety trace

| Touched | Used by | Risk | Mitigation |
|---|---|---|---|
| `stripe-connect-status` body shape | Only the branding page's return handler | None — body is optional, defaults to sandbox | Backward-compatible default |
| Branding `useEffect` deps | Adds `fetchBranding` (already memoized via `useCallback`) | None | `fetchBranding` is stable across renders |
| URL cleanup | Only used as a one-time marker | None | `replaceState` doesn't trigger nav |
| `stripe-connect-onboard` | Untouched in this round | None | — |
| `branding_settings` schema | Untouched | None | Columns already exist |

## Out of scope

- Adding a manual "Refresh status" button (current auto-check on return is sufficient).
- Disconnect / re-onboard flow (not requested).
- Webhook-driven update of `stripe_onboarding_complete` (the on-return polling already handles the only path that gets a user back to the page).

## Verify after deploy

1. Click **Connect with Stripe** on `/dashboard/branding`.
2. Complete Stripe Express onboarding.
3. Stripe redirects back with `?stripe_connect_return=1`.
4. The page calls `stripe-connect-status` with the matching environment, the DB flips `stripe_onboarding_complete = true`, `fetchBranding()` reloads, and the badge changes from "Connect with Stripe" button to "Stripe Connected ✅".
5. If the user closes Stripe early, the toast says "Stripe onboarding not yet complete" instead of silently doing nothing.

