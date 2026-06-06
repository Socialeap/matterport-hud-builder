import { useCallback, useEffect, useState, type RefObject } from "react";

// Vendor-prefixed fullscreen surface (Safari/older WebKit).
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}
interface FsElement extends Element {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function getFsElement(): Element | null {
  if (typeof document === "undefined") return null;
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

function isFsEnabled(): boolean {
  if (typeof document === "undefined") return false;
  const d = document as FsDocument;
  return Boolean(d.fullscreenEnabled ?? d.webkitFullscreenEnabled);
}

/**
 * Toggle browser fullscreen on a target element. Hook gracefully no-ops on
 * environments without the Fullscreen API (older iOS Safari) — consumers
 * should hide their trigger when `isEnabled` is false.
 */
export function useFullscreen(targetRef: RefObject<Element | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);

  useEffect(() => {
    setIsEnabled(isFsEnabled());
    const onChange = () => setIsFullscreen(getFsElement() !== null);
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    onChange();
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    const el = targetRef.current as FsElement | null;
    if (!el) return;
    try {
      if (getFsElement()) {
        const d = document as FsDocument;
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // User denied / unsupported — silently ignore.
    }
  }, [targetRef]);

  return { isFullscreen, isEnabled, toggle };
}
