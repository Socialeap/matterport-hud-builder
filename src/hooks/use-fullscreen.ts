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

function getFsElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/**
 * Toggle fullscreen on a target element. Tries the native Fullscreen API
 * first; if it is unavailable or rejected (typical inside iframes without
 * `allow="fullscreen"`, e.g. embedded previews), falls back to a CSS
 * pseudo-fullscreen by adding `.atlas-shell--pseudo-fs` to the target.
 * `Escape` exits pseudo-fullscreen (native API handles Esc itself).
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

    // Enter: try native, fall back to pseudo.
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (typeof request === "function") {
      try {
        await request.call(el);
        return;
      } catch {
        // Permission denied (e.g. iframe without allow="fullscreen") — fall through.
      }
    }
    setIsPseudoFs(true);
  }, [isPseudoFs, targetRef]);

  return { isFullscreen: isNativeFs || isPseudoFs, toggle };
}
