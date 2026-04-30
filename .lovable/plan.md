## Goals

1. **Fix the broken MSP signup flow.** The landing page sends MSPs to `/signup?token=&email=`, but `SignupForm` treats every visitor as an invited client — when the token is empty, it shows "An invitation token is required" and blocks account creation.
2. **Create `/agents`** — a public landing page targeted at agents / property managers / marketers, in the same dark visual style as `/`, including an interactive "MSP Directory (Coming Soon)" shell with a working geo + feature filter UI driven by hardcoded sample MSP cards.

---

## Part 1 — MSP Signup Fix

### Diagnosis

- `src/components/auth/SignupForm.tsx` requires `inviteToken` and renders the dead-end "contact your MSP" panel without it. That logic is correct **for the `/invite/$token` flow** but is wrong as the only entry point.
- The DB trigger `handle_new_user` (migration `20260421044823…`) already handles the no-token case gracefully: it creates a profile and stops. The provider role is granted later by `assign_provider_role_on_purchase` (migration `20260415163913…`) and the Stripe webhook. So opening signup to MSPs requires **no DB changes** — the data path is already safe.

### Changes

**`src/components/auth/SignupForm.tsx`**
- Add a `mode` prop: `"invite"` (current behavior) or `"open"` (new — for MSPs).
- In `"open"` mode:
  - Remove the invite-token gate. Show Google OAuth + email/password form unconditionally.
  - Headline: "Create your MSP account" / sub: "Launch your branded 3D Presentation Studio in minutes."
  - `signUp({ email, password, options: { emailRedirectTo: window.location.origin + '/dashboard', data: { full_name } } })` — no `invite_token` in metadata.
  - Google OAuth: `redirect_uri: window.location.origin + '/dashboard'`, no `invite_token` extraParam.
- Keep the existing invite-mode codepath untouched so `/invite/$token` → `/signup?token=…` still works for clients.

**`src/routes/signup.tsx`**
- Decide mode from the search param: if `token` is present → `mode="invite"`, otherwise → `mode="open"`.
- Render `<SignupForm mode={…} inviteToken={token || undefined} inviteEmail={email || undefined} />`.

**`src/components/auth/LoginForm.tsx`**
- Update the footer link from "Have an invitation? Sign up" to "New here? **Create your MSP account**" (still links to `/signup`).

**Landing page CTAs (`src/routes/index.tsx`)**
- The existing `navigate({ to: "/signup", search: { token: "", email: "" } })` calls already work — the new mode resolution will treat empty token as "open MSP signup". No change required, but I'll double-check each Get Started button still routes correctly.

### Why this is safe
- No SQL migrations. The `handle_new_user` trigger already ignores missing/invalid tokens.
- The invite-acceptance flow (`/invite/$token` → `/signup?token=<uuid>&email=…`) still passes a real token, so clients keep being linked to their MSP exactly as before.
- New MSP accounts land on `/dashboard`. Provider role isn't granted until purchase (existing trigger), which matches the current architecture — until then, the dashboard already shows "choose a tier" prompts (the `DemoButton` flow on the landing page also continues to work for MSPs to test before paying).

---

## Part 2 — `/agents` Landing Page

### New file: `src/routes/agents.tsx`

Same dark color palette, grid overlay, blurred orbs, header/footer pattern as `src/routes/index.tsx`. Reuses the same Tailwind classes and Lucide icons so visual consistency is automatic.

#### Sections (top to bottom)

1. **Header** — same shell as `/`. Links: Home (`/`), For Agents (current), Sign In dropdown.
2. **Hero**
   - H1: "Find a 3D Presentation Studio for Your Listings"
   - Sub: "Hire a Matterport Service Provider who can deliver beautifully branded, interactive 3D tour presentations for the properties you market."
   - Two CTAs: "Browse the MSP Directory" (scroll to directory) + "Learn How It Works" (scroll).
   - Same hero HUD banner image as `/`.
3. **What you get** (4-card grid) — agent-facing benefits only:
   - Branded property presentations (your listing, your story)
   - 24/7 AI Concierge that answers buyer questions
   - Live guided tours with co-presence
   - Lead capture straight to your inbox
   *(Reuses the existing icon set: Sparkles, Bot, Video, MailCheck.)*
4. **How It Works** — 3-step horizontal flow (mirrors the index page's progressive-glow pattern, but with the agent journey):
   - 1. Find your MSP in the directory
   - 2. Provide your Matterport links
   - 3. Receive a branded, interactive 3D presentation
5. **MSP Directory (Coming Soon)** — the centerpiece. See spec below.
6. **FAQ / Trust band** — short reassurance: "MSPs in this directory use the 3D Presentation Studio platform. You work directly with the MSP — we don't take a cut of your engagement."
7. **Footer** — same as `/`.

#### MSP Directory shell (interactive, no backend)

A `<Card>` block titled **"MSP Directory"** with a `Coming Soon` badge.

**Filter rail (left on desktop, top on mobile):**
- **Location search** — `<Input>` with a `MapPin` icon, placeholder "City, state, or ZIP". Filters the placeholder list by case-insensitive substring against `city/state`.
- **Service filters** — checkbox grid of icon-tagged feature chips (multi-select). Initial set:
  - `Palette` Custom branding
  - `Bot` AI Concierge
  - `Video` Live guided tours
  - `Film` Cinematic intros
  - `MapPin` Neighborhood maps
  - `Lock` Private/VIP listings
  - `BarChart3` Traffic analytics
  - `Globe` Custom domain hosting
- **Reset filters** button.

**Results grid (right):**
- 6–8 hardcoded sample MSP cards (e.g. "Transcendence Media — Los Angeles, CA", "Skyline Tours — Austin, TX", etc.). Each card shows: logo placeholder, name, city/state, short tagline, list of feature icons, and a disabled `Request a Quote` button with tooltip "Coming soon".
- A subtle banner at the top of the grid: "Directory launching soon — these listings are previews. **Get notified when we go live →**" with an inline email-capture input + "Notify Me" button (purely cosmetic; submit toasts "Thanks — we'll email you when the directory is live" and clears the field).
- Empty state when filters return no matches: "No matches yet — adjust filters or check back soon."

**Logic:** Pure client-side `useState` for `query` and `selectedFeatures: Set<string>`. `useMemo` filters the static array. No server calls, no DB schema changes.

#### Route registration

`createFileRoute("/agents")` with proper `head()` metadata (title, description, og:title, og:description, og:image — distinct from `/`) per project route-architecture rules.

#### Cross-linking

- Add a "For Agents →" link in the header of `src/routes/index.tsx` (next to other nav items).
- Add a reciprocal "I'm an MSP →" link in the header of `/agents` pointing back to `/`.

---

## Files Touched

```text
EDIT  src/components/auth/SignupForm.tsx     — add mode prop, open-signup branch
EDIT  src/routes/signup.tsx                  — derive mode from token presence
EDIT  src/components/auth/LoginForm.tsx      — relabel footer link
EDIT  src/routes/index.tsx                   — add "For Agents" header link
NEW   src/routes/agents.tsx                  — agent landing + interactive directory shell
```

No DB migrations. No edge function changes. No changes to `/invite/$token` or the client-acceptance flow.

---

## Out of Scope (flag for later)

- Real MSP directory backend (table schema, geo indexing, MSP profile editor inside `/dashboard/branding`, public MSP profile pages). When ready, the static cards on `/agents` will be swapped for a server-fn-backed query — the filter UI is designed to map cleanly onto that future schema.
- Waitlist email persistence (currently a toast-only stub). Wiring it to a `directory_waitlist` table can come with the directory backend.
