## Problem

When signed in as a **client** at `/dashboard/account` (and adjacent dashboard pages), the UI mixes provider/MSP-only content with client-appropriate content:

- **Orders** page reads "Manage client presentation requests and fulfillment" and queries `order_notifications` by `provider_id = user.id`. That's an MSP fulfillment view; a client signed in just sees an empty MSP dashboard rather than *their own* purchases.
- **Overview** page (`/dashboard`) is MSP "Quick Start — 6 steps to launch" onboarding (Brand Studio, Set Pricing, Stripe Connect, Invite clients…). None of that applies to a client.
- **Account** page exposes the **Ask AI · Bring Your Own Gemini Key (BYOK)** section to clients. Per your correction, BYOK is an **MSP-only** feature — the 20 free Ask AI answers per published presentation are funded by the platform (your Gemini key, `gemini-2.5-flash-lite`), and overflow is funded by the **MSP's** BYOK key, not the end client's. Clients should never see BYOK.

The sidebar already filters nav items by role (clients only see Overview, Orders, Account), but the *pages themselves* still render MSP content.

## Audit — what belongs to whom

**Account page (`/dashboard/account`) sections:**

| Section | MSP / Provider | Client | Notes |
|---|---|---|---|
| Change Password | yes | yes | Universal Supabase auth |
| Ask AI · BYOK Gemini Key (`AskAiByokSection`) | **yes** | **no** | MSP-only — funds overflow Ask AI usage on their clients' published presentations once the platform-funded 20 free answers per property are exhausted |
| Privacy & Terms links | yes | yes | Universal |
| Delete Account (danger zone) | yes | yes | Universal |

**Overview page (`/dashboard`):** Currently 100% MSP onboarding. Clients should see something different — a simple landing pointing them at their Orders, their account, and (if applicable) their published presentation links.

**Orders page (`/dashboard/orders`):** Currently 100% MSP fulfillment view. Clients should see *their own purchases* (`order_notifications` rows where `client_id = auth.uid()`), read-only.

## Plan

### 1. Hide BYOK from clients on the Account page (`src/routes/_authenticated.dashboard.account.tsx`)

- Read `roles` from `useAuth()`; compute `const isClient = roles.includes("client") && !roles.includes("provider");`.
- Render `<AskAiByokSection />` only when **not** a client (i.e., providers/MSPs and admins).
- Soften the delete-account dialog copy when `isClient` so it doesn't reference "Studio settings": e.g. "your account and all associated data."
- Leave Change Password, Privacy & Terms, and Delete Account intact for both roles.

### 2. Role-aware Overview page (`src/routes/_authenticated.dashboard.index.tsx`)

At the top of `DashboardOverview`, branch on `roles.includes("client")`:

- **Client branch** → render a new lightweight `ClientOverview` block:
  - Welcome line using their display name / email
  - Card: "My Orders" → `/dashboard/orders` with their purchase count
  - Card: "Account & Privacy" → `/dashboard/account`
  - Optional: a small "Your provider" panel that shows the MSP brand (`branding_settings.brand_name`) of the provider who invited them (resolved from `client_invitations` or whichever table holds the relationship — confirmed at implementation time).
  - **No** BYOK card, **no** Stripe / pricing / branding cards.
- **Provider branch** → keep the existing 6-step Quick Start unchanged.

### 3. Role-aware Orders page (`src/routes/_authenticated.dashboard.orders.tsx`)

Branch the data fetch and table on role:

- **Provider** (existing, unchanged): query `order_notifications` by `provider_id = user.id`; show fulfillment columns (Mark Paid, Release File, Mark Read); header copy "Orders — Manage client presentation requests and fulfillment."
- **Client** (new): query `order_notifications` by `client_id = user.id`; resolve provider display names instead of client display names; show read-only columns (Presentation, Date, Models, Amount, Payment status, Released? + download link if released). No mutating buttons. Header copy "My Orders — Your purchased presentations."

Empty-state copy also forks (provider: "When clients request presentations…"; client: "When you purchase a presentation, it will appear here.").

### 4. Sidebar label tweak (`src/components/dashboard/DashboardSidebar.tsx`)

For clients, render the Orders nav item label as **"My Orders"** instead of "Orders" so the nav matches the page header. Same route. One-line change inside `navItems.map`.

### 5. RLS verification (no schema changes expected)

`order_notifications` already carries both `provider_id` and `client_id`. At implementation time I'll confirm that the existing select policy permits `client_id = auth.uid()` to read their own rows; if it doesn't, I'll add a single additive `select` policy via a migration. No other backend or schema work.

## Out of scope

- Splitting `/dashboard/...` into a separate `/client/...` route tree — the shared tree with role-aware rendering is simpler and matches the sidebar filter that already exists.
- Hard server-side route guards for the MSP-only pages clients can't reach via nav (`Branding`, `Pricing`, `Vault`, `Payouts`, `Clients`, `Demo`, `Stats`). Already hidden from clients in `DashboardSidebar`. Can revisit as a follow-up if you want belt-and-suspenders protection.
- Any change to how the 20 free Ask AI answers per property are funded or counted — that platform-funded flow stays exactly as it is.

## Risk & verification

- All edits are additive role branches; provider flows are unchanged.
- Manual QA after the change:
  1. **Client login** → `/dashboard` shows client overview; `/dashboard/orders` shows "My Orders" with their own purchases; `/dashboard/account` shows Change Password, Privacy & Terms, Delete Account only — **no BYOK section**.
  2. **Provider login** → all three pages render exactly as today, BYOK still visible on Account.
