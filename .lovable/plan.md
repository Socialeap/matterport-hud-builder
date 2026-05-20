## What I confirmed

- The app code is routing Stripe calls through the Lovable connector gateway as expected.
- The **sandbox Stripe connection is still invalid** at the connector level.
- The gateway credential check returns: `outcome: failed` with Stripe reporting `Expired API Key provided`.
- The **live Stripe connection verifies successfully**.
- So this is not fixed by another normal reconnect attempt; the project is still receiving the same stale sandbox credential.

## Plan to break the loop

1. **Stop using the reconnect flow for the existing sandbox connection**
   - It has already been tried repeatedly and the verified result shows the stored sandbox credential remains expired.

2. **Create/link a fresh Stripe sandbox connection instead of reconnecting the stale one**
   - Use the connector picker to add a new Stripe connection record or relink Stripe from scratch.
   - Then verify the new `STRIPE_SANDBOX_API_KEY` through the gateway credential check before touching app code again.

3. **If the connector picker only reuses the same stale record**
   - Treat this as a Lovable connector-state issue, not an app bug.
   - Escalate with the exact finding: sandbox connection `std_01kp9q23fdfm68nz4we5dpqp0s` still returns `Expired API Key provided`, while live connection verifies.

4. **Optional temporary workaround**
   - If you need payouts unblocked immediately and are comfortable testing against live Stripe, switch the app’s payment environment to the verified live connection.
   - I would only do this with your explicit approval because it changes payment mode behavior.

## Technical detail

Current connection health:

```text
Stripe sandbox: failed — expired sk_test key still stored upstream
Stripe live:    verified
```

The next action should be **new sandbox connection or escalation**, not another reconnect of the same sandbox record.