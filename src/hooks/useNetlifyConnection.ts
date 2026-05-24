import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getNetlifyConnection,
  startNetlifyOAuth,
  disconnectNetlify,
} from "@/lib/portal/netlify.functions";

/**
 * useNetlifyConnection — manages the popup OAuth flow and exposes the
 * current connection status. The popup posts a message back when it
 * completes; we refresh the query on success.
 */
export function useNetlifyConnection() {
  const queryClient = useQueryClient();
  const fetchConnection = useServerFn(getNetlifyConnection);
  const startOAuth = useServerFn(startNetlifyOAuth);
  const disconnect = useServerFn(disconnectNetlify);

  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

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
      setConnecting(false);
      if (data.payload?.ok) {
        setLastError(null);
        void queryClient.invalidateQueries({ queryKey: ["netlify-connection"] });
      } else {
        setLastError(data.payload?.message || "Netlify sign-in failed.");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [queryClient]);

  const connect = useCallback(async () => {
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
        setConnecting(false);
        setLastError(
          "Your browser blocked the Netlify sign-in popup. Allow popups for this site and try again.",
        );
        return;
      }
      // Poll for popup close in case the user dismisses without completing.
      const interval = setInterval(() => {
        if (popup.closed) {
          clearInterval(interval);
          // If still "connecting" after close, assume cancelled.
          setConnecting((c) => {
            if (c) return false;
            return c;
          });
        }
      }, 500);
    } catch (err) {
      setConnecting(false);
      setLastError(err instanceof Error ? err.message : "Could not start sign-in.");
    }
  }, [startOAuth]);

  const handleDisconnect = useCallback(async () => {
    await disconnect({});
    await queryClient.invalidateQueries({ queryKey: ["netlify-connection"] });
  }, [disconnect, queryClient]);

  return {
    connection: query.data,
    loading: query.isLoading,
    connecting,
    lastError,
    connect,
    disconnect: handleDisconnect,
  };
}
