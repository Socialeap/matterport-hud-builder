/**
 * `withTimeout` — race a thenable against a deadline so a hung
 * upstream (Postgres lock wait, slow RPC, etc.) doesn't pin a
 * Cloudflare Worker isolate until the platform kills it.
 *
 * Server-only. Intended for the public/unauthenticated paths in
 * `src/lib/portal.functions.ts` and `src/routes/p.$slug.*.tsx` where
 * anonymous traffic can pile up and a hung query would cascade.
 *
 * Cancellation note: this helper does NOT abort the underlying
 * promise — it only stops waiting for it. supabase-js calls without
 * `.abortSignal()` will continue running on the Postgres side. That
 * is acceptable for the threat model here (we want to free the
 * Worker, not the database); when the database call eventually
 * resolves nothing observes the result. For truly cancellable RPC
 * calls, pass an AbortController.signal to `.abortSignal()` on the
 * builder in addition to wrapping the await with `withTimeout`.
 */

export class TimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`Timeout (${ms}ms) waiting for ${label}`);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
