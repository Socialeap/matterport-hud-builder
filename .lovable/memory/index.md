# Project Memory

## Core
Matterport HUD Builder — multi-tenant SaaS for MSPs. TanStack Start + Lovable Cloud.
Two products: Platform (builder UI) + End Product (standalone .html file).
Tiers: Starter ($149 setup + $49/yr) and Pro ($299 setup + $49/yr) — annual subscriptions via Stripe.
Auth: Google OAuth + email sign-in. Invite-only for clients.
Generated .html must be fully self-contained — no "phone home" to backend.
Never store roles on profiles table. Use separate user_roles table.
Licenses tracked in dedicated `licenses` table with studio_id for Lead-Hook Bridge.
Pro-only: Lead-Hook Bridge (AI lead capture via handle-lead-capture edge function).

## Memories
- [Tier logic](mem://features/tier-logic) — Starter vs Pro restrictions, branding enforcement, upgrade path
- [Porting strategy](mem://features/porting-strategy) — Logic extraction, state transition, static independence guidelines
- [Platform architecture](mem://features/platform-architecture) — Provider dashboard, client builder, generation engine, security
- [End product spec](mem://features/end-product) — Obfuscation, Base64 scrambling, branding injection, self-contained output
