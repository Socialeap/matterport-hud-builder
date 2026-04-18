/**
 * Client-side fetch interceptor that attaches the current Supabase access
 * token as a `Bearer` Authorization header to every TanStack Start server
 * function request (paths beginning with `/_serverFn/`).
 *
 * Server functions that use the `requireSupabaseAuth` middleware read this
 * header to authenticate the caller. Without this patch, browser-initiated
 * server-fn calls go out anonymous and the middleware throws a 401 Response,
 * which surfaces as `Error: [object Response]` and a blank screen.
 *
 * Safe to call multiple times — it only patches `window.fetch` once.
 */
import { supabase } from "./client";

let patched = false;

export function installServerFnAuth() {
  if (patched) return;
  if (typeof window === "undefined") return;
  patched = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : "";

      if (url.includes("/_serverFn/")) {
        const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
        if (!headers.has("authorization") && !headers.has("Authorization")) {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token;
          if (token) {
            headers.set("Authorization", `Bearer ${token}`);
            return originalFetch(input, { ...init, headers });
          }
        }
      }
    } catch {
      // fall through to original fetch
    }
    return originalFetch(input, init);
  };
}
