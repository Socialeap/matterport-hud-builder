import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

// Vendor-prefixed fullscreen surface (Safari/older WebKit).
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FsElement extends Element {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const PSEUDO_CLASS = "atlas-shell--pseudo-fs";
const BODY_LOCK_CLASS = "atlas-pseudo-fs-lock";

export type FullscreenMode = "none" | "maximized" | "device";

function getFsElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

async function exitNativeFullscreen(): Promise<void> {
  if (typeof document === "undefined") return;
  const d = document as FsDocument;
  try {
    await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
  } catch {
    /* ignore — already exited / not permitted */
  }
}

/**
 * iOS/iPadOS WebKit detection — a local twin of `annoIsIosWebKit` in
 * src/lib/portal/anno-input.mjs (kept separate so the client bundle does
 * not absorb the injected-runtime module). Covers classic identifiers,
 * iOS Chrome/Firefox (CriOS/FxiOS UAs carry iPhone/iPad), and iPad
 * desktop mode (`MacIntel` with maxTouchPoints > 1).
 */
export function isIosWebKitDevice(
  nav?: Pick<Navigator, "platform" | "userAgent" | "maxTouchPoints"> | null,
): boolean {
  const n = nav ?? (typeof navigator !== "undefined" ? navigator : null);
  if (!n) return false;
  const platform = typeof n.platform === "string" ? n.platform : "";
  const ua = typeof n.userAgent === "string" ? n.userAgent : "";
  if (/iPhone|iPad|iPod/i.test(platform) || /iPhone|iPad|iPod/i.test(ua)) return true;
  return (
    platform === "MacIntel" &&
    typeof n.maxTouchPoints === "number" &&
    n.maxTouchPoints > 1
  );
}

/**
 * True when running as an installed/standalone app (PWA, iOS Add-to-Home).
 * The app window is already an immersive shell there, so native "Device
 * fullscreen" adds nothing and is suppressed (req 5).
 */
export function isStandaloneDisplay(win?: Window | null): boolean {
  const w = win ?? (typeof window !== "undefined" ? window : null);
  if (!w) return false;
  try {
    if (typeof w.matchMedia === "function" && w.matchMedia("(display-mode: standalone)").matches) {
      return true;
    }
  } catch {
    /* ignore */
  }
  const nav = w.navigator as (Navigator & { standalone?: boolean }) | undefined;
  return nav?.standalone === true;
}

/**
 * Whether NATIVE element-fullscreen exists on this platform. iPhone Safari
 * has none for non-video elements; iPad and desktop do. Probed on
 * Element.prototype so it needs no specific element instance.
 */
export function deviceFullscreenApiAvailable(win?: Window | null): boolean {
  const w = (win ?? (typeof window !== "undefined" ? window : null)) as
    | { Element?: { prototype?: FsElement } }
    | null;
  const proto = w?.Element?.prototype;
  if (!proto) return false;
  return typeof (proto.requestFullscreen ?? proto.webkitRequestFullscreen) === "function";
}

/**
 * Decide what the SINGLE primary immersive control should do next. Device
 * fullscreen is the primary mechanism everywhere it works; Maximize is the
 * fallback (iPhone with no element-fullscreen API, or installed/standalone
 * where native fullscreen is unnecessary).
 *   active (native OR maximized) → "exit"
 *   supports device fullscreen   → "device"
 *   otherwise                    → "maximize"
 */
export function planImmersiveToggle(input: {
  nativeActive: boolean;
  maximized: boolean;
  supportsDevice: boolean;
}): "exit" | "device" | "maximize" {
  if (input.nativeActive || input.maximized) return "exit";
  if (input.supportsDevice) return "device";
  return "maximize";
}

/**
 * Label/title/aria for the single immersive button, derived from the
 * COMBINED state. When device fullscreen is unavailable (iPhone /
 * standalone) the control is honestly "Maximize", never "Fullscreen".
 */
export function immersiveButtonLabel(input: {
  active: boolean;
  supportsDevice: boolean;
}): { label: string; title: string; aria: string } {
  if (input.active) {
    return { label: "Exit", title: "Exit immersive view", aria: "Exit immersive view" };
  }
  if (input.supportsDevice) {
    return { label: "Fullscreen", title: "Enter fullscreen", aria: "Enter fullscreen" };
  }
  return { label: "Maximize", title: "Maximize", aria: "Maximize" };
}

/**
 * Attempt NATIVE fullscreen on `el`. Pure: resolves true on success,
 * false on a missing API or a rejected request (e.g. an iframe without
 * `allow="fullscreen"`). No platform refusal — the device-vs-maximize
 * choice lives in planImmersiveToggle() / supportsDeviceFullscreen.
 */
export async function requestNativeFullscreen(el: FsElement): Promise<boolean> {
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (typeof request !== "function") return false;
  try {
    await request.call(el);
    return true;
  } catch {
    return false;
  }
}

/**
 * Single primary immersive control for a target element.
 *
 * - `toggleImmersive()` is THE button action used by both the /atlas shell
 *   and the presentation modal. Device fullscreen is the primary mechanism
 *   wherever it works; Maximize (CSS pseudo-fullscreen via
 *   `.atlas-shell--pseudo-fs`) is the fallback when device fullscreen is
 *   unavailable (iPhone) or unnecessary (installed/standalone) or rejected
 *   (iframe without allow). The button's icon/label/aria use the COMBINED
 *   `isFullscreen` state.
 * - Maximize is NOT a second prominent control. It is the fallback above
 *   AND the auto-safety mode entered by `ensureSafeForInteraction()` when
 *   annotation / live interaction begins on iPad (iPadOS can swipe-exit
 *   native fullscreen mid-draw). `Escape` exits Maximize;
 *   `body.atlas-pseudo-fs-lock` contains background scroll (no
 *   touch-action — embedded Matterport/annotation gestures stay intact).
 * - `maximize` / `enterDeviceFullscreen` remain as internals (used by the
 *   unified actions + the auto-safety path); the UI exposes only one
 *   immersive button.
 */
export function useFullscreen(targetRef: RefObject<Element | null>) {
  const [isNativeFs, setIsNativeFs] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  const isIos = useMemo(() => isIosWebKitDevice(), []);
  const isStandalone = useMemo(() => isStandaloneDisplay(), []);
  const supportsDeviceFullscreen = useMemo(
    () => deviceFullscreenApiAvailable() && !isStandalone,
    [isStandalone],
  );

  // Track native fullscreen changes (incl. OS-driven exit, e.g. the
  // iPadOS swipe gesture — keeps our state honest).
  useEffect(() => {
    const onChange = () => setIsNativeFs(getFsElement() !== null);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  // Sync the pseudo-fullscreen (Maximize) class on the target.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    if (isMaximized) el.classList.add(PSEUDO_CLASS);
    else el.classList.remove(PSEUDO_CLASS);
  }, [isMaximized, targetRef]);

  // Lock background page scroll while Maximize is active. Scroll
  // containment only (overflow/overscroll on <body>) — deliberately NO
  // touch-action, so Matterport navigation + annotation gestures inside
  // the embedded presentation are untouched. Cleanup on exit/unmount.
  useEffect(() => {
    if (!isMaximized) return;
    document.body.classList.add(BODY_LOCK_CLASS);
    return () => document.body.classList.remove(BODY_LOCK_CLASS);
  }, [isMaximized]);

  // Escape exits Maximize (native fullscreen handles Esc itself).
  useEffect(() => {
    if (!isMaximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsMaximized(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isMaximized]);

  const maximize = useCallback(async () => {
    if (isMaximized) {
      setIsMaximized(false);
      return;
    }
    // Maximize and native device fullscreen are mutually exclusive.
    if (getFsElement()) await exitNativeFullscreen();
    setIsMaximized(true);
  }, [isMaximized]);

  const enterDeviceFullscreen = useCallback(async () => {
    const el = targetRef.current as FsElement | null;
    if (!el) return;
    if (isMaximized) setIsMaximized(false);
    if (getFsElement()) {
      await exitNativeFullscreen();
      return;
    }
    const ok = await requestNativeFullscreen(el);
    // Rejected / unavailable (e.g. iframe without allow) → Maximize.
    if (!ok) setIsMaximized(true);
  }, [isMaximized, targetRef]);

  const exitImmersive = useCallback(async () => {
    if (getFsElement()) {
      await exitNativeFullscreen();
      return;
    }
    if (isMaximized) setIsMaximized(false);
  }, [isMaximized]);

  // Enter the primary immersive mode: Device fullscreen where supported,
  // else Maximize; on a native reject (e.g. iframe without allow) fall
  // back to Maximize. No-op if already immersive.
  const enterImmersive = useCallback(async () => {
    const el = targetRef.current as FsElement | null;
    if (!el) return;
    if (getFsElement() || isMaximized) return;
    const plan = planImmersiveToggle({
      nativeActive: false,
      maximized: false,
      supportsDevice: supportsDeviceFullscreen,
    });
    if (plan === "device") {
      const ok = await requestNativeFullscreen(el);
      if (ok) return;
    }
    setIsMaximized(true);
  }, [isMaximized, supportsDeviceFullscreen, targetRef]);

  // THE single button action for the shell + the modal.
  const toggleImmersive = useCallback(async () => {
    const plan = planImmersiveToggle({
      nativeActive: getFsElement() !== null,
      maximized: isMaximized,
      supportsDevice: supportsDeviceFullscreen,
    });
    if (plan === "exit") {
      await exitImmersive();
      return;
    }
    await enterImmersive();
  }, [isMaximized, supportsDeviceFullscreen, enterImmersive, exitImmersive]);

  // Req 3: an interaction needing stable touch gestures began. iPadOS can
  // swipe-exit native fullscreen mid-draw, so if we are in it, drop to
  // Maximize. Returns true when it switched (caller shows brief copy).
  // No-op (returns false) when already in Maximize or windowed — those
  // are already gesture-stable.
  const ensureSafeForInteraction = useCallback((): boolean => {
    if (getFsElement()) {
      void exitNativeFullscreen();
      setIsMaximized(true);
      return true;
    }
    return false;
  }, []);

  const mode: FullscreenMode = isNativeFs ? "device" : isMaximized ? "maximized" : "none";

  return {
    mode,
    isMaximized,
    isDeviceFullscreen: isNativeFs,
    isFullscreen: isNativeFs || isMaximized,
    isIos,
    isStandalone,
    supportsDeviceFullscreen,
    // Single primary immersive control used by the shell + modal.
    enterImmersive,
    exitImmersive,
    toggleImmersive,
    ensureSafeForInteraction,
    // Internals (fallback + auto-safety); not a second prominent button.
    maximize,
    enterDeviceFullscreen,
  };
}
