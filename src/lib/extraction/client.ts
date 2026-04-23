/**
 * Thin client helper to invoke the extract-property-doc edge function.
 * The extraction itself runs server-side (Deno) so that the PDF bytes
 * never leave our infra in the browser.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ExtractionRequest,
  ExtractionResponse,
} from "./provider";

/**
 * Structured error thrown by the invoke helpers when the edge function
 * returns a non-2xx status. Carries the JSON-decoded `stage`/`detail`/
 * `diagnostics` payload so toasts and badges can surface real reasons
 * instead of "non-2xx status code".
 */
export class ExtractionError extends Error {
  status: number;
  stage: string;
  detail: string;
  diagnostics: Record<string, unknown>;
  constructor(opts: {
    status: number;
    stage: string;
    detail: string;
    diagnostics?: Record<string, unknown>;
  }) {
    super(`${opts.stage}: ${opts.detail}`);
    this.name = "ExtractionError";
    this.status = opts.status;
    this.stage = opts.stage;
    this.detail = opts.detail;
    this.diagnostics = opts.diagnostics ?? {};
  }
}

/** Decode the JSON body sitting inside a FunctionsHttpError. */
async function decodeFunctionError(
  err: unknown,
  fallbackName: string,
): Promise<ExtractionError> {
  // supabase-js attaches the raw `Response` on `error.context` for
  // FunctionsHttpError. Read it once and parse as JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = err as any;
  const ctx: Response | undefined = e?.context;
  const status: number = ctx?.status ?? 500;

  if (status === 423) {
    return new ExtractionError({
      status: 423,
      stage: "freeze",
      detail:
        "LUS freeze active for this property — unfreeze to continue",
    });
  }

  if (ctx && typeof ctx.text === "function") {
    try {
      const txt = await ctx.text();
      if (txt) {
        try {
          const body = JSON.parse(txt) as {
            ok?: boolean;
            stage?: string;
            detail?: string;
            error?: string;
            diagnostics?: Record<string, unknown>;
          };
          return new ExtractionError({
            status,
            stage: body.stage ?? "unknown",
            detail: body.detail ?? body.error ?? `HTTP ${status}`,
            diagnostics: body.diagnostics ?? {},
          });
        } catch {
          return new ExtractionError({
            status,
            stage: "unknown",
            detail: txt.slice(0, 200),
          });
        }
      }
    } catch {
      /* fall through */
    }
  }

  const msg = e?.message ?? `${fallbackName} returned a non-2xx status`;
  return new ExtractionError({
    status,
    stage: "unknown",
    detail: msg,
  });
}

/**
 * If the SDK returns a 401, retry once with explicit headers in case the
 * SDK dropped the Authorization header mid-token-refresh.
 */
async function fallback401<T>(
  fnName: string,
  body: unknown,
): Promise<T | null> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
    | string
    | undefined;
  if (!accessToken || !supabaseUrl || !publishableKey) return null;

  const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: publishableKey,
    },
    body: JSON.stringify(body),
  });
  if (res.status === 401) return null;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    const errBody = (parsed ?? {}) as {
      stage?: string;
      detail?: string;
      error?: string;
      diagnostics?: Record<string, unknown>;
    };
    throw new ExtractionError({
      status: res.status,
      stage: errBody.stage ?? "unknown",
      detail: errBody.detail ?? errBody.error ?? `HTTP ${res.status}`,
      diagnostics: errBody.diagnostics ?? {},
    });
  }
  return (parsed as T) ?? null;
}

export async function invokeExtraction(
  req: ExtractionRequest,
): Promise<ExtractionResponse> {
  const { data, error } = await supabase.functions.invoke<ExtractionResponse>(
    "extract-property-doc",
    { body: req },
  );

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (error as any)?.context?.status;
    if (status === 401) {
      const fallback = await fallback401<ExtractionResponse>(
        "extract-property-doc",
        req,
      );
      if (fallback) return fallback;
      throw new ExtractionError({
        status: 401,
        stage: "auth",
        detail: "no_session",
      });
    }
    throw await decodeFunctionError(error, "extract-property-doc");
  }
  if (!data) throw new ExtractionError({
    status: 500,
    stage: "unknown",
    detail: "extract-property-doc returned no data",
  });
  return data;
}

export interface UrlExtractionRequest {
  vault_asset_id: string;
  property_uuid: string;
  url: string;
  saved_model_id?: string | null;
  template_id?: string | null;
}

/**
 * Companion to invokeExtraction for URL-based assets. The server-side
 * extract-url-content function fetches the page, runs SSRF guards,
 * structures fields via the LLM, chunks the cleaned text, and writes a
 * property_extractions row identical in shape to the file path's output.
 */
export async function invokeUrlExtraction(
  req: UrlExtractionRequest,
): Promise<ExtractionResponse> {
  const { data, error } = await supabase.functions.invoke<ExtractionResponse>(
    "extract-url-content",
    { body: req },
  );

  if (error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = (error as any)?.context?.status;
    if (status === 401) {
      const fallback = await fallback401<ExtractionResponse>(
        "extract-url-content",
        req,
      );
      if (fallback) return fallback;
      throw new ExtractionError({
        status: 401,
        stage: "auth",
        detail: "no_session",
      });
    }
    throw await decodeFunctionError(error, "extract-url-content");
  }
  if (!data) throw new ExtractionError({
    status: 500,
    stage: "unknown",
    detail: "extract-url-content returned no data",
  });
  return data;
}
