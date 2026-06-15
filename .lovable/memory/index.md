# Project Memory

## Core
Matterport HUD Builder — multi-tenant SaaS for MSPs. TanStack Start + Lovable Cloud.
Two products: Platform (builder UI) + End Product (standalone .html file).
Tiers: Starter and Pro (setup fee + annual subscription). Commercial terms (prices, trial length) are mutable — verify them from the current pricing implementation/configuration before using them in plans or copy. Current trial strategy: 30-day self-service trial.
Auth: Google OAuth + email sign-in. Invite-only for clients (invite token consumed on signup).
Generated packages must remain owner-hostable and must not depend on Frontiers3D/Supabase at runtime unless explicitly approved. Approved renderer, CDN, and relative-asset dependencies may remain.
Never store roles on profiles table. Use separate user_roles table.
Clients see limited sidebar (Overview, Orders). Providers see all nav items.
Export lock checks provider's license for client users via client_providers lookup.

## Memories
- [Tier logic](mem://features/tier-logic) — Starter vs Pro restrictions, branding enforcement, upgrade path
- [Porting strategy](mem://features/porting-strategy) — Logic extraction, state transition, static independence guidelines
- [Platform architecture](mem://features/platform-architecture) — Provider dashboard, client builder, generation engine, security
- [End product spec](mem://features/end-product) — Obfuscation, Base64 scrambling, branding injection, self-contained output

## Product End-State Deep Dives
- [Foundation and tenancy](features/foundation-tenancy.md)
- [Presentation system](features/presentation-system.md)
- [Atlas discovery](features/atlas-discovery.md)
- [Marketplace and revenue](features/marketplace-revenue.md)
- [Map Oracle and outreach](features/map-oracle-outreach.md)
- [Public experience, operations, and roadmap](features/operations-roadmap.md)
- [Synthetic / CGI commerce showrooms](features/synthetic-commerce.md)
