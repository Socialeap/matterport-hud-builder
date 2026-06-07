import { useEffect, useRef, useState } from "react";

// Client-only service-worker registration + a restrained "Update available"
// action. Registers in production builds only (the Vite dev server and a SW
// fight over caching). Never silently activates a new worker under an open
// tab — the user confirms, then we SKIP_WAITING and reload exactly once.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

export function ServiceWorkerManager() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  // True only once the user has accepted an update (clicked Update). The
  // FIRST registration also fires `controllerchange` — the new worker
  // calls clients.claim() to control the previously-uncontrolled page —
  // and reloading there would discard in-progress Atlas interaction right
  // after first load. So we reload on controllerchange ONLY when an update
  // was actually accepted.
  const updateAcceptedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Only in production — dev relies on Vite's module server, and a SW
    // cache layer there causes stale-asset confusion.
    if (!import.meta.env.PROD) return;

    let reloading = false;
    const onControllerChange = () => {
      // Ignore the first-registration claim; reload only for an accepted
      // update.
      if (!updateAcceptedRef.current) return;
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    const trackWaiting = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) {
        setWaitingWorker(reg.waiting);
      }
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          // A new worker finished installing while one already controls the
          // page → an update is genuinely available.
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            setWaitingWorker(reg.waiting ?? installing);
          }
        });
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        trackWaiting(reg);
        // Periodically check for a new worker on long-lived sessions.
        const id = window.setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);
        return () => window.clearInterval(id);
      })
      .catch(() => {
        // Registration failure must never break the app.
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  const applyUpdate = () => {
    // Mark acceptance BEFORE asking the worker to take over, so the
    // resulting controllerchange is recognized as user-initiated and
    // performs the single reload.
    updateAcceptedRef.current = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        maxWidth: "min(92vw, 28rem)",
        padding: "10px 14px",
        borderRadius: "10px",
        background: "rgba(10,14,39,0.96)",
        border: "1px solid rgba(59,130,246,0.4)",
        boxShadow: "0 12px 32px rgba(0,0,0,0.4)",
        color: "#f1f5f9",
        font: "500 13px/1.4 'Plus Jakarta Sans','Inter',ui-sans-serif,system-ui,sans-serif",
      }}
    >
      <span style={{ flex: 1 }}>A new version of Frontiers3D is available.</span>
      <button
        type="button"
        onClick={applyUpdate}
        style={{
          appearance: "none",
          border: "1px solid #3b82f6",
          background: "#2563eb",
          color: "#fff",
          borderRadius: "7px",
          padding: "7px 12px",
          font: "600 13px/1 inherit",
          cursor: "pointer",
          flexShrink: 0,
          minHeight: "36px",
        }}
      >
        Update
      </button>
      <button
        type="button"
        onClick={() => setWaitingWorker(null)}
        aria-label="Dismiss update notice"
        style={{
          appearance: "none",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.6)",
          fontSize: "18px",
          lineHeight: 1,
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        &times;
      </button>
    </div>
  );
}

export type { BeforeInstallPromptEvent };
