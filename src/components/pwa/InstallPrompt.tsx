import { useEffect, useState } from "react";
import { Share, X, Plus } from "lucide-react";
import { isStandaloneDisplay, isIosWebKitDevice } from "@/hooks/use-fullscreen";
import {
  recordDismissal,
  shouldPromote,
} from "@/lib/pwa/install-controller.mjs";

// Atlas install promotion. Mounted ONLY inside /atlas, so it can never
// appear in admin / checkout / auth flows. Hidden entirely in standalone.
// Surfaced after meaningful engagement (a presentation was opened, tracked
// by the caller via the controller) or a return visit — never on cold load.
// Reuses isStandaloneDisplay / isIosWebKitDevice (no duplicate detection).

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** `engaged` flips true once the Atlas page reports a presentation open. */
export function InstallPrompt({ engaged }: { engaged: boolean }) {
  const [visible, setVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIos, setIsIos] = useState(false);

  // Capture beforeinstallprompt (Android/desktop Chromium) without showing
  // the browser's own mini-infobar.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneDisplay()) return;
    setIsIos(isIosWebKitDevice());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    const onInstalled = () => {
      setVisible(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Decide visibility from the engagement/cooldown controller.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandaloneDisplay()) {
      setVisible(false);
      return;
    }
    const ok = shouldPromote(getStorage(), {
      standalone: false,
      engagedNow: engaged,
      now: Date.now(),
    });
    // On iOS there is no beforeinstallprompt; we still show guidance.
    // On Chromium we wait until we actually have a deferred prompt OR the
    // user is clearly engaged (some browsers fire bip late).
    if (ok && (isIosWebKitDevice() || deferredPrompt || engaged)) {
      setVisible(true);
    }
  }, [engaged, deferredPrompt]);

  if (!visible) return null;

  const dismiss = () => {
    recordDismissal(getStorage(), Date.now());
    setVisible(false);
  };

  const install = async () => {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* user dismissed the native sheet */
    }
    setDeferredPrompt(null);
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Frontiers3D"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        bottom: "calc(16px + env(safe-area-inset-bottom, 0px))",
        zIndex: 9000,
        width: "min(92vw, 26rem)",
        padding: "14px 16px",
        borderRadius: "14px",
        background: "rgba(10,14,39,0.97)",
        border: "1px solid rgba(59,130,246,0.35)",
        boxShadow: "0 18px 44px rgba(0,0,0,0.5)",
        color: "#f1f5f9",
        font: "500 13px/1.5 'Plus Jakarta Sans','Inter',ui-sans-serif,system-ui,sans-serif",
      }}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          width: "32px",
          height: "32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "none",
          background: "transparent",
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
        }}
      >
        <X className="size-4" />
      </button>
      <div style={{ fontWeight: 700, fontSize: "14px", marginBottom: "4px", paddingRight: "28px" }}>
        Add Frontiers3D to your Home Screen
      </div>
      <p style={{ margin: "0 0 10px", color: "#94a3b8", fontSize: "12.5px" }}>
        Jump back into the Atlas faster, get more viewing space, and enjoy an
        app-like Explore Together.
      </p>
      {isIos ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            flexWrap: "wrap",
            color: "#cbd5e1",
            fontSize: "12.5px",
          }}
        >
          <span>Tap</span>
          <Share className="size-4" aria-label="Share" style={{ color: "#60a5fa" }} />
          <span>then</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 8px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.16)",
            }}
          >
            <Plus className="size-3" /> Add to Home Screen
          </span>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={install}
            disabled={!deferredPrompt}
            style={{
              appearance: "none",
              border: "1px solid #3b82f6",
              background: deferredPrompt ? "#2563eb" : "rgba(37,99,235,0.4)",
              color: "#fff",
              borderRadius: "8px",
              padding: "9px 14px",
              font: "600 13px/1 inherit",
              cursor: deferredPrompt ? "pointer" : "not-allowed",
              minHeight: "40px",
            }}
          >
            Install
          </button>
          <button
            type="button"
            onClick={dismiss}
            style={{
              appearance: "none",
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(255,255,255,0.06)",
              color: "#e2e8f0",
              borderRadius: "8px",
              padding: "9px 14px",
              font: "600 13px/1 inherit",
              cursor: "pointer",
              minHeight: "40px",
            }}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
