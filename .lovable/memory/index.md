# Project Memory

## Core
Matterport HUD Builder — multi-tenant SaaS for MSPs. TanStack Start + Lovable Cloud.
Two products: Platform (builder UI) + End Product (standalone .html file).
Tiers: Starter ($100 setup + $49/yr) and Pro ($250 setup + $49/yr) — subscriptions with 365-day free trial.
Auth: Google OAuth + email sign-in. Invite-only for clients (invite token consumed on signup).
Generated .html must be fully self-contained — no "phone home" to backend.
Never store roles on profiles table. Use separate user_roles table.
Clients see limited sidebar (Overview, Orders). Providers see all nav items.
Export lock checks provider's license for client users via client_providers lookup.

## Memories
- [Tier logic](mem://features/tier-logic) — Starter vs Pro restrictions, branding enforcement, upgrade path
- [Porting strategy](mem://features/porting-strategy) — Logic extraction, state transition, static independence guidelines
- [Platform architecture](mem://features/platform-architecture) — Provider dashboard, client builder, generation engine, security
- [End product spec](mem://features/end-product) — Obfuscation, Base64 scrambling, branding injection, self-contained output
