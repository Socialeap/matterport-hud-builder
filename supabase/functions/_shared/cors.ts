/**
 * Shared CORS headers + preflight handler for the user-facing edge
 * functions. Two variants:
 *
 *   - `authedCorsHeaders`  — for endpoints that require a Supabase JWT
 *     in the `Authorization` header (extract-property-doc,
 *     extract-url-content, induce-schema, dryrun-template).
 *
 *   - `publicCorsHeaders`  — for endpoints called anonymously by the
 *     generated portal runtime (synthesize-answer, capture-beacon,
 *     etc.) where the only allowed request header is `content-type`.
 *
 * Centralizing these:
 *   1. Closes the audit's "inconsistent CORS" finding — every function
 *      now agrees on `Access-Control-Allow-Methods`, which previously
 *      only `synthesize-answer` was sending.
 *   2. Makes "add a new edge function" a one-import affair instead of
 *      another copy-paste of the same constants.
 *
 * Per-function customization is still supported by spreading either
 * constant into a new object before returning: e.g. an endpoint that
 * needs `cache-control` allowed can do
 *   { ...authedCorsHeaders, "Access-Control-Allow-Headers":
 *       authedCorsHeaders["Access-Control-Allow-Headers"] + ", cache-control" }
 * — but the audit didn't surface any such case in the current code.
 */

const COMMON = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
} as const;

export const authedCorsHeaders = {
  ...COMMON,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
} as const;

export const publicCorsHeaders = {
  ...COMMON,
  "Access-Control-Allow-Headers": "content-type",
} as const;

/**
 * Returns a 204-No-Content Response with the supplied CORS headers
 * when the request is a preflight; otherwise returns null so callers
 * can continue handling the request.
 */
export function handlePreflight(
  req: Request,
  headers: typeof authedCorsHeaders | typeof publicCorsHeaders,
): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }
  return null;
}
