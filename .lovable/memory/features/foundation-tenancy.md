# Foundation, Tenancy, Provider, Agent, And Business Memory

## Product Outcomes
- Roles, tenant ownership, and provider/client associations control every protected route, record, and command.
- Providers operate branded studios, retain service pricing/contracts, manage clients, presentations, orders, and work.
- Agents and businesses can understand the offer, find capture help, publish owned presentations, and pursue Atlas visibility.

## Invariants
- Roles use `user_roles`; never trust editable profile data or browser state for authorization.
- Admin commands require the existing admin gate plus server-side checks.
- Provider/client records remain isolated by ownership and RLS.
- Frontiers|3D supplies discovery/workflow; it does not silently become the provider's service contractor.
- Public copy must not claim a capture, listing, relationship, or result without evidence.

## Current Gaps
- Complete launch acceptance across onboarding, invitation, client service, agent work orders, and role boundaries.
- Finish deferred validation, error handling, and secret-rotation work recorded in `AUDIT_REMEDIATION.md`.

