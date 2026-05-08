## Problem

`/agent-dashboard` crashes with "No QueryClient set, use QueryClientProvider to set one". The page uses `useQuery`/`useMutation`/`useQueryClient` from `@tanstack/react-query`, but the app has never mounted a `QueryClientProvider` — it isn't in `src/routes/__root.tsx` or `src/router.tsx`. This is the first route in the project to use TanStack Query hooks, so the missing provider only surfaced now.

## Fix

Mount a single `QueryClientProvider` at the app root so any current/future route can use Query hooks.

### 1. `src/router.tsx`
- Create a fresh `QueryClient` inside `getRouter()` (per-request, SSR-safe — never module-level).
- Pass it on the router `context` alongside the existing `auth` field.
- Keep `defaultPreloadStaleTime: 0`.

### 2. `src/routes/__root.tsx`
- Wrap `<Outlet />` with `<QueryClientProvider client={queryClient}>` inside `RootComponent`, reading `queryClient` from route context (or via a small accessor). Toaster stays mounted at root.
- Leave `AuthProvider` in place; QueryClientProvider goes inside it so hooks under authenticated routes work.

### 3. No changes to `_authenticated.agent-dashboard.tsx`
- Existing `useQuery`/`useMutation`/`useQueryClient` calls will resolve once the provider is mounted.

### 4. Verification
- Reload `/agents` → click Dashboard → confirm `/agent-dashboard` renders profile + history without the QueryClient error.
- Confirm other routes (`/dashboard`, `/`, `/p/$slug`) still render — they don't use Query hooks, so behavior is unchanged.

## Why this is minimal and safe

- Adds one provider; touches two files.
- Per-request `QueryClient` avoids SSR data leakage.
- No schema, RLS, or server-fn changes.
- No edits to `agent-dashboard` logic, so the previously approved feature behavior is preserved.
