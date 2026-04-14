# Project Memory

## Core
3D Presentation Studio — multi-tenant SaaS for MSPs. TanStack Start + Lovable Cloud.
Two products: Platform (builder UI) + End Product (standalone .html file).
Tiers: Starter ($149), Pro ($299), Upgrade ($199) — all one-time via Stripe.
Auth: Google OAuth + email sign-in. Invite-only for clients.
Generated .html must be fully self-contained — no "phone home" to backend.
Never store roles on profiles table. Use separate user_roles table.

## Memories
- [Tier logic](mem://features/tier-logic) — Starter vs Pro restrictions, branding enforcement, upgrade path
- [Porting strategy](mem://features/porting-strategy) — Logic extraction, state transition, static independence guidelines
- [Platform architecture](mem://features/platform-architecture) — Provider dashboard, client builder, generation engine, security
- [End product spec](mem://features/end-product) — Obfuscation, Base64 scrambling, branding injection, self-contained output
