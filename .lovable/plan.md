

## Answers to your questions

**Q1 — Who can access the Sandbox / Demo today?**

There are actually **two different "preview" surfaces** in the codebase right now, and they serve different audiences:

| Surface | Route | Who sees it | Persisted? |
|---|---|---|---|
| **Internal Demo** | `/dashboard/demo` | MSP (provider) only — sidebar entry is gated to `roles: ["provider"]` | No — pure in-memory React state, resets on refresh |
| **Client Builder** | `/p/$slug` (public URL like `/p/your-brand`) | Anyone with the link — clients use this to actually configure & purchase a presentation | Saved on submit (`saved_models` table) |

So today the `/dashboard/demo` sandbox is **MSP-only** and is essentially a throwaway playground — nothing the MSP does there is saved or visible to anyone else. Clients have their own builder at `/p/$slug` which is already public-facing but is a *purchase flow*, not a *demo*.

**Q2 — Can we promote a sandbox config into a public demo on the MSP's Studio?**

Yes, this is a clean, achievable feature. Here's the proposed plan.

## Plan: "Publish Sandbox as Public Demo"

### Concept
Add a **"Save as Demo"** button to `/dashboard/demo`. When toggled on, the MSP's last-saved sandbox configuration is exposed at `/p/$slug/demo` (read-only, no purchase flow, no signup) so visitors to their Studio see a fully-branded, interactive 3D tour example before committing to build their own.

### User flow
1. MSP opens `/dashboard/demo`, configures branding + 1–3 sample properties + agent info.
2. Clicks **"Save & Publish as Public Demo"** → config is persisted.
3. Toggle **"Show on public Studio"** controls visibility.
4. On `/p/$slug` (the public Studio), a banner/CTA appears: *"See a Live Demo →"* linking to `/p/$slug/demo`.
5. `/p/$slug/demo` renders the saved demo config in **read-only mode** — full HUD preview, working Matterport tours, no "Submit / Purchase" buttons, with a clear *"Build Your Own"* CTA that returns to `/p/$slug`.

### Database
One new table: `sandbox_demos`
```text
- id              uuid pk
- provider_id     uuid (unique — one demo per MSP)
- is_published    boolean default false
- brand_overrides jsonb   (brandName, accentColor, hudBgColor, gateLabel, logo override)
- properties      jsonb   (PropertyModel[])
- behaviors       jsonb   (Record<id, TourBehavior>)
- agent           jsonb   (AgentContact)
- updated_at, created_at
```
RLS:
- Provider: full CRUD on rows where `provider_id = auth.uid()`
- Public (anon + auth): SELECT where `is_published = true` (joined via slug on `branding_settings`)

### Code changes
1. **`/dashboard/demo`** (`_authenticated.dashboard.demo.tsx`)
   - Add Save / Publish toggle UI at the bottom of the left column.
   - Load existing saved demo on mount (so MSP can iterate).
   - Server fn `saveSandboxDemo` + `publishSandboxDemo`.
2. **New route** `src/routes/p.$slug.demo.tsx`
   - Loader fetches branding by slug → fetches `sandbox_demos` where `is_published = true`.
   - Renders a read-only variant of `HudBuilderSandbox` (new prop `mode="demo"` that hides Submit, Pricing, Signup, License banners).
3. **`/p/$slug`** (existing public builder)
   - When a published demo exists, show a **"View Live Demo"** ribbon/CTA at the top.
4. **HudBuilderSandbox refactor (small)**
   - Add `mode?: "build" | "demo"` prop. In `demo` mode: hide purchase card, hide license banner, hide signup modal, change header copy.

### LUS interaction
Demo publishing is gated behind `useLusLicense().isActive` for the MSP — consistent with the "Premium Studio" rule. If LUS lapses, the published demo keeps rendering (so the MSP's marketing surface stays live), but the MSP can't *edit or republish* it until they renew. This matches the existing freeze/standard-mode pattern.

### Out of scope (explicit)
- No analytics on demo views (can add later).
- No multiple demos per MSP — one canonical demo per Studio.
- No "convert this demo into my own build" deep-link prefill (nice future addition).

### File checklist
- `supabase/migrations/{timestamp}_sandbox_demos.sql` — table + RLS
- `src/lib/sandbox-demo.functions.ts` — `saveSandboxDemo`, `getSandboxDemo`, `publishSandboxDemo`
- `src/routes/_authenticated.dashboard.demo.tsx` — load/save/publish UI
- `src/routes/p.$slug.demo.tsx` — new public read-only route
- `src/routes/p.$slug.tsx` — add "View Live Demo" CTA when demo published
- `src/components/portal/HudBuilderSandbox.tsx` — add `mode` prop branching

