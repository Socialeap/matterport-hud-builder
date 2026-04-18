

## Plan: Rename tab + add Agent/Manager avatar

### Changes

**1. Rename "Agent" → "Agent/Manager"** (`src/routes/_authenticated.dashboard.demo.tsx`)
- Update the Tabs trigger label.
- Also update the section title in `AgentContactSection.tsx` from "Agent Contact" → "Agent/Manager Contact".

**2. Add avatar field to `AgentContact` type** (`src/components/portal/types.ts`)
- Add `avatarUrl: string` to the `AgentContact` interface.
- Add `avatarUrl: ""` to `DEFAULT_AGENT`.

**3. Add avatar upload UI** (`src/components/portal/AgentContactSection.tsx`)
- Add a new prop `onAvatarFileChange?: (file: File | null) => void` so the parent can manage the upload (consistent with how the dashboard already manages `logoFile` / `faviconFile`).
- Render a small circular preview (using existing `Avatar` component from `src/components/ui/avatar.tsx`) at the top of the card next to Name/Title, with an "Upload" button and "Remove" button.
- Client-side validation: file must be image, ≤ 500 KB (thumbnail-sized). Show inline error toast if exceeded.
- Show preview from either a local `blob:` (just-selected) or the persisted `agent.avatarUrl`.

**4. Wire avatar persistence** (`src/routes/_authenticated.dashboard.demo.tsx`)
- Add `agentAvatarFile` state + `agentAvatarPreview` state, mirroring existing `logoFile`/`faviconFile` pattern.
- In hydration `useEffect`, populate from saved `agent.avatarUrl` (skip `blob:` URLs as we already do for logo/favicon).
- In `handleSave` and publish path, reuse the existing `uploadIfFile` helper to upload to `brand-assets` bucket under `agent-avatars/{providerId}/{timestamp}-avatar.{ext}` and write the public URL back to `agent.avatarUrl` before calling `saveSandboxDemo`.
- Strip stale `blob:` from `agent.avatarUrl` as a safety net before save.

**5. Render avatar in Contact drawer** (`src/components/portal/HudPreview.tsx`)
- In the slide-in "Get in Touch" drawer, render the `Avatar` next to the agent's name (top of the drawer card), falling back to initials if no `avatarUrl`.
- Sized ~48–56px, circular, with subtle border for the glassmorphism aesthetic.
- If no avatar and no name, hide the avatar block entirely.

**6. Public site coercion** (`src/routes/p.$slug.demo.tsx`)
- Extend the existing blob-URL coercion to also clear `agent.avatarUrl` if it starts with `blob:` (defensive, matching what we already do for `logoUrl`).

### Files touched
- `src/components/portal/types.ts` — add `avatarUrl` field + default
- `src/components/portal/AgentContactSection.tsx` — section title rename, avatar upload UI + validation
- `src/routes/_authenticated.dashboard.demo.tsx` — tab label rename, avatar state + upload + hydration
- `src/components/portal/HudPreview.tsx` — render avatar in Contact drawer
- `src/routes/p.$slug.demo.tsx` — defensive blob-URL coercion for `agent.avatarUrl`

### Out of scope
- No DB schema change (`agent` is already a `jsonb` column — adding a key needs no migration).
- No new storage bucket (reuse existing public `brand-assets`).
- No changes to the public Studio (`/p/$slug`) which stays blank per prior decision.

