import { useCallback, useEffect, useState, type RefObject } from "react";

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

function getFsElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
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
 * Try to enter NATIVE fullscreen on `el`. Returns false WITHOUT
 * attempting on iOS/iPadOS WebKit: system edge-swipes terminate native
 * element fullscreen there, and iPad users trigger them constantly while
 * drawing annotations — CSS pseudo-fullscreen is immune, so it is the
 * primary path on those devices. Also returns false when the API is
 * missing or the request rejects (typical inside iframes without
 * `allow="fullscreen"`), preserving the existing pseudo fallback.
 */
export async function requestNativeFullscreen(
  el: FsElement,
  nav?: Pick<Navigator, "platform" | "userAgent" | "maxTouchPoints"> | null,
): Promise<boolean> {
  if (isIosWebKitDevice(nav)) return false;
  const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (typeof request !== "function") return false;
  try {
    await request.call(el);
    return true;
  } catch {
    // Permission denied (e.g. iframe without allow="fullscreen").
    return false;
  }
}

/**
 * Toggle fullscreen on a target element. On desktop, tries the native
 * Fullscreen API first; if it is unavailable or rejected (typical inside
 * iframes without `allow="fullscreen"`, e.g. embedded previews), falls
 * back to a CSS pseudo-fullscreen by adding `.atlas-shell--pseudo-fs` to
 * the target. On iOS/iPadOS WebKit (incl. iPad desktop mode and iOS
 * Chrome) the pseudo path is PRIMARY — native fullscreen there is
 * terminated by system edge-swipe gestures, which iPad users trigger
 * while drawing annotations in the presentation modal. While pseudo
 * fullscreen is active, `body.atlas-pseudo-fs-lock` contains background
 * scroll (no touch-action — embedded gestures stay intact). `Escape`
 * exits pseudo-fullscreen (native API handles Esc itself).
 */
export function useFullscreen(targetRef: RefObject<Element | null>) {
  const [isNativeFs, setIsNativeFs] = useState(false);
  const [isPseudoFs, setIsPseudoFs] = useState(false);

  // Track native fullscreen changes.
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

  // Sync pseudo-fullscreen class on target + handle Esc.
  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    if (isPseudoFs) el.classList.add(PSEUDO_CLASS);
    else el.classList.remove(PSEUDO_CLASS);
  }, [isPseudoFs, targetRef]);

  // Lock background page scroll while pseudo-fullscreen is active.
  // Scroll containment only (overflow/overscroll on <body> via class) —
  // deliberately NO touch-action anywhere, so gestures inside the
  // embedded presentation (Matterport navigation, annotations) are
  // untouched. Cleanup runs on exit and on unmount.
  useEffect(() => {
    if (!isPseudoFs) return;
    document.body.classList.add(BODY_LOCK_CLASS);
    return () => document.body.classList.remove(BODY_LOCK_CLASS);
  }, [isPseudoFs]);

  useEffect(() => {
    if (!isPseudoFs) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsPseudoFs(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPseudoFs]);

  const toggle = useCallback(async () => {
    const el = targetRef.current as FsElement | null;
    if (!el) return;

    // Exit paths first.
    if (getFsElement()) {
      try {
        const d = document as FsDocument;
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } catch {
        /* ignore */
      }
      return;
    }
    if (isPseudoFs) {
      setIsPseudoFs(false);
      return;
    }

    // Enter: native where it is stable; CSS pseudo-fullscreen on
    // iOS/iPadOS WebKit (edge-swipes kill native fullscreen mid-
    // annotation there) and as the rejection/missing-API fallback.
    if (await requestNativeFullscreen(el)) return;
    setIsPseudoFs(true);
  }, [isPseudoFs, targetRef]);

  return { isFullscreen: isNativeFs || isPseudoFs, toggle };
}
