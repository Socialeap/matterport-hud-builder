# Frontiers|3D Product End-States
**Owner:** Shakoure | **Revised:** 2026-06-14 | **Authority:** Product-direction baseline

## 1. Use And Authority
- Before planning, coding, debugging, copy changes, or PR approval: identify the affected component; read its rule below and linked memory; report conflicts first.
- Authority order: latest owner decision > this file > scoped memories/architecture/security docs > `CODEX_REVIEW_QUEUE.md` > current implementation.
- Existing code is evidence, not product authority; only Shakoure approves end-state changes.
- Update this file only for approved direction/status changes; put implementation detail and history in scoped memory.
- Completion requires observable workflow acceptance, remaining-gap disclosure, and the alignment block in Section 6.

## 2. Platform Footprint
Frontiers|3D is a multi-tenant ecosystem for providers, agents/businesses, and visitors that creates, publishes, discovers, and commercializes owned immersive presentations across three authorized rendering tracks: current Matterport-overlay packages, planned TrueSpace E57-to-Gaussian-Splat processing, and planned synthetic/CGI 360 commerce showrooms.

## 3. Global Rule Vectors
- **UX:** Make core workflows usable by non-developers; code existence or passing tests alone never proves completion.
- **Truth:** Never invent a tour, result, ROI, ownership relationship, endorsement, or verified physical presence.
- **Portability:** Exported presentations remain owner-hostable and require no Frontiers|3D/Supabase runtime dependency unless explicitly approved.
- **Runtime:** Package family, schema, version, capabilities, generated behavior, and supported upgrade paths must agree.
- **Tenancy:** Use established `user_roles`, ownership checks, server authorization, and RLS; never create parallel client-controlled authorization.
- **Secrets:** Service-role keys, signing secrets, provider credentials, and deployment tokens remain server-only.
- **Uploads:** Never execute uploaded HTML merely to inspect, verify, or upgrade it.
- **Deployment:** Merge, frontend publish, backend activation, static deploy, and package regeneration are separate verified events.
- **Backend:** Follow `CLAUDE.md`, `BACKEND_ACTIVATION.md`, and `POST_MERGE_CHECKLIST.md`; destructive operations require explicit approval.
- **Commercial:** Preserve provider/client ownership, billing, payout, refund, suppression, unsubscribe, audit, and idempotency boundaries.
- **Devices:** Desktop and mobile capability differences are valid when explicitly approved and truthfully represented.

## 4. Status Vocabulary
`Operational` = implemented + activated + workflow-accepted | `Partial` = implemented but acceptance/activation/compatibility remains | `Planned` = approved, not built | `Exploratory` = unapproved concept | `Blocked` = named dependency | `Retired` = do not restore without approval.

## 5. Component Baselines

### A. Identity And Multi-Tenant Access - Partial
**End-state:** Role-, tenant-, and ownership-scoped routes/data/actions with server enforcement. **Anchors:** `src/routes/_authenticated*`, `user_roles`, `client_providers`, RLS. **See:** `.lovable/memory/features/foundation-tenancy.md`.

### B. Provider Studio And Dashboard - Partial
**End-state:** Providers operate branded studios, manage clients/work, and monetize delivery while retaining service pricing and client relationships. **Anchors:** `src/routes/_authenticated.dashboard.*`, `src/routes/p.$slug.*`. **See:** `.lovable/memory/features/foundation-tenancy.md`.

### C. Agent And Business Journeys - Partial
**End-state:** Agents/businesses understand the offer, find capture help, obtain/publish presentations, and pursue Atlas visibility without false claims. **Anchors:** `agents.tsx`, `businesses.tsx`, `_authenticated.agent-dashboard*`. **See:** `.lovable/memory/features/foundation-tenancy.md`.

### D. Presentation Builder And Publishing - Partial
**End-state:** Non-technical users generate validated, owned, host-independent packages from Matterport models or approved input-conditioned CGI generation using 2D floor plans plus style references. **Boundary:** Location-independent virtual stores are exempt from local-MSP and address-geocoding locks. **Anchors:** `p.$slug.builder.tsx`, `portal.functions.ts`, `src/lib/portal/**`. **See:** `.lovable/memory/features/presentation-system.md`, `.lovable/memory/features/synthetic-commerce.md`.

### E. Presentation Runtime And HUD - Partial
**End-state:** Branded, responsive, deterministic presentation controls enhance rather than break the underlying renderer across direct-host and Atlas-modal use. **Anchors:** `builder-runtime-spans.mjs`, `anno-input.mjs`, `atlas-live-tour*`. **See:** `.lovable/memory/features/presentation-system.md`.

### F. Explore Together - Partial
**End-state:** Two desktop users join, speak, sync Matterport views, and sequentially share Draw/Focus Rope/Eraser/Clear with reconnect safety. **Boundary:** Collaboration is desktop-only; no Matterport SDK dependency. **Anchors:** `live-session.mjs`, `atlas-live-tour-runtime.mjs`, runtime `2.2.1`. **See:** `.lovable/memory/features/presentation-system.md`.

### G. Presentation Upgrade Center - Partial
**End-state:** Supported older HTML is inertly inspected, allowlist-patched with trusted runtime sources, integrity-verified, and downloaded without execution or retention. **Anchors:** `presentation-upgrade-*`, admin Presentation Updates route. **See:** `.lovable/memory/features/presentation-system.md`.

### H. Atlas Discovery Map - Partial
**End-state:** Public discovery of verified physical and virtual immersive spaces through scalable map/search/listing/viewer workflows. **Synthetic rule:** Virtual showrooms use map-click coordinate pinning within configured geo-fences and visually distinct pin colors/shapes from physical listings. **Anchors:** `atlas.tsx`, admin Atlas routes, `src/lib/atlas*`, `atlas_entries`, `atlas_curation_jobs`. **See:** `.lovable/memory/features/atlas-discovery.md`, `.lovable/memory/features/synthetic-commerce.md`.

### I. Marketplace, Work Orders, And Payments - Partial
**End-state:** Qualified local demand reaches providers; requesters choose; providers retain pricing/contracts; matching, work orders, ratings, billing, payouts, refunds, and webhooks remain reliable. **Anchors:** `agents.tsx`, agent dashboard, marketplace/work-order/Stripe paths. **See:** `.lovable/memory/features/marketplace-revenue.md`.

### J. Map Oracle And Outreach - Partial
**End-state:** Public-source discovery/enrichment supports truthful, compliant, auditable, throttled outreach with operator control and exactly-once delivery. **Anchors:** admin Doorway/Outreach routes, Map Oracle migrations/functions, email queues/logs. **See:** `.lovable/memory/features/map-oracle-outreach.md`.

### K. Public Marketing And PWA - Partial
**End-state:** Audience-specific pages present one truthful ecosystem and direct each user to discovery, provider, builder, publishing, or Atlas actions with responsive/PWA usability. **Anchors:** `index.tsx`, `agents.tsx`, `businesses.tsx`, `opportunities.tsx`, `atlas.tsx`. **See:** `.lovable/memory/features/operations-roadmap.md`.

### L. Admin And Operations - Partial
**End-state:** Guarded, transparent operator tools replace routine scripts and verify every active/public/published/queued/sent transition. **Anchors:** `src/routes/_authenticated.admin*`, activation/handoff docs. **See:** `.lovable/memory/features/operations-roadmap.md`.

### M. TrueSpace / AutoSplat - Planned
**End-state:** Authorized E57 uploads become metered, quality-checked, optimized Gaussian-Splat presentations through scalable storage, queues, GPU workers, delivery, and account integration. **Boundary:** Supabase Edge Functions and a personal Mac Mini are not the production compute engine. **Anchors:** TrueSpace action plan; future worker/storage project. **See:** `.lovable/memory/features/operations-roadmap.md`.

### N. Synthetic/CGI Commerce Showrooms - Planned
**End-state:** Location-independent virtual storefronts are generated from approved 2D plans/style/product inputs, published as interactive commerce-ready presentations, and discoverable in Atlas without being misrepresented as physical captures. **Anchors:** future generation pipeline, Builder, Atlas. **See:** `.lovable/memory/features/synthetic-commerce.md`.

## 6. Required Alignment Block
```text
End-State Alignment
- Component:
- Approved outcome advanced:
- Boundaries preserved:
- Cross-component effects:
- Acceptance evidence:
- Remaining gap:
- PRODUCT_END_STATES.md revision required: YES/NO
```

## 7. Approved Decisions
- **2026-06-09 / Explore Together:** Desktop-only collaboration; mobile retains normal tour navigation, sharing, fullscreen, and PWA behavior.
- **2026-06-14 / Governance:** This file is the global product-direction baseline; tactical status remains in `CODEX_REVIEW_QUEUE.md`.
- **2026-06-14 / Rendering tracks:** Matterport overlays remain current; TrueSpace and synthetic/CGI commerce showrooms are approved planned tracks, not yet operational.

## 8. Current Priority Vector
PR #170 P5 review/acceptance -> runtime 2.2.1 regenerated-artifact acceptance -> Atlas showcase-merge activation -> launch-critical reconciliation -> P6 self-service -> TrueSpace sample-E57 spike; synthetic/CGI implementation remains planned pending its scoped specification.
