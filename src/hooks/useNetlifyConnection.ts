import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getNetlifyConnection,
  startNetlifyOAuth,
  disconnectNetlify,
} from "@/lib/portal/netlify.functions";

const OAUTH_TIMEOUT_MS = 90_000;

/**
 * useNetlifyConnection — manages the popup OAuth flow and exposes the
 * current connection status. The popup posts a message back when it
 * completes; we refresh the query on success.
 *
 * Terminal states for a connect attempt:
 *   - success: postMessage arrived with ok=true
 *   - error:   postMessage arrived with ok=false, OR timeout fired
 *   - cancelled: popup closed before any postMessage
 */
export function useNetlifyConnection() {
  const queryClient = useQueryClient();
  const fetchConnection = useServerFn(getNetlifyConnection);
  const startOAuth = useServerFn(startNetlifyOAuth);
  const disconnect = useServerFn(disconnectNetlify);

  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Refs so the message/poll/timeout handlers can coordinate without re-renders.
  const settledRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<Window | null>(null);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const settle = useCallback(
    (result: { ok: true } | { ok: false; message: string }) => {
      if (settledRef.current) return;
      settledRef.current = true;
      cleanup();
      setConnecting(false);
      if (result.ok) {
        setLastError(null);
        void queryClient.invalidateQueries({ queryKey: ["netlify-connection"] });
      } else {
        setLastError(result.message);
      }
    },
    [cleanup, queryClient],
  );

  const query = useQuery({
    queryKey: ["netlify-connection"],
    queryFn: () => fetchConnection(),
    staleTime: 60_000,
    retry: false,
  });

  // Listen for the postMessage from the OAuth callback popup.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const data = ev.data as
        | { type?: string; payload?: { ok: boolean; message: string } }
        | undefined;
      if (!data || data.type !== "netlify-oauth-result") return;
      if (data.payload?.ok) {
        settle({ ok: true });
      } else {
        settle({
          ok: false,
          message: data.payload?.message || "Netlify sign-in failed.",
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [settle]);

  // Tear everything down on unmount.
  useEffect(() => cleanup, [cleanup]);

  const clearError = useCallback(() => setLastError(null), []);

  const connect = useCallback(async () => {
    // Reset state for a fresh attempt.
    cleanup();
    settledRef.current = false;
    setLastError(null);
    setConnecting(true);

    try {
      const { authorizeUrl } = await startOAuth({
        data: { origin: window.location.origin },
      });
      const width = 560;
      const height = 720;
      const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
      const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
      const popup = window.open(
        authorizeUrl,
        "netlifyOAuth",
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );
      if (!popup) {
        settle({
          ok: false,
          message:
            "Your browser blocked the Netlify sign-in popup. Allow popups for this site and try again.",
        });
        return;
      }
      popupRef.current = popup;

      // Poll for popup close — if it closes without a postMessage,
      // treat as cancelled / not-found / unregistered redirect URI.
      pollRef.current = setInterval(() => {
        if (popup.closed) {
          settle({
            ok: false,
            message:
              "Sign-in window closed before completing. If you saw 'Not Found', the redirect URI for this site isn't registered on the 3DPS Studio Netlify OAuth app.",
          });
        }
      }, 500);

      // Hard timeout in case the popup is hung on Netlify's error page.
      timeoutRef.current = setTimeout(() => {
        try { popup.close(); } catch { /* ignore */ }
        settle({
          ok: false,
          message:
            "Netlify sign-in timed out. The redirect URI for this site may not be registered on the 3DPS Studio Netlify OAuth app.",
        });
      }, OAUTH_TIMEOUT_MS);
    } catch (err) {
      settle({
        ok: false,
        message: err instanceof Error ? err.message : "Could not start sign-in.",
      });
    }
  }, [cleanup, settle, startOAuth]);

  const handleDisconnect = useCallback(async () => {
    await disconnect({});
    await queryClient.invalidateQueries({ queryKey: ["netlify-connection"] });
  }, [disconnect, queryClient]);

  return {
    connection: query.data,
    loading: query.isLoading,
    connecting,
    lastError,
    clearError,
    connect,
    disconnect: handleDisconnect,
  };
}
