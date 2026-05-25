import { useEffect } from "react";

/**
 * Override the parent app's favicon with the MSP's branded favicon.
 * TanStack Router concatenates <link> entries from root + leaf without
 * dedup, and browsers honor the first rel="icon" they parse — so we
 * purge competing icons at runtime and inject the brand one.
 *
 * Falls back to logoUrl when no favicon is uploaded. On unmount, restores
 * the parent app's /favicon.png so navigating away from MSP routes
 * doesn't leave a stale brand icon in the tab.
 */
export function useBrandedFavicon(
  faviconUrl?: string | null,
  logoUrl?: string | null,
) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const rawHref = (faviconUrl || logoUrl || "").trim();
    if (!rawHref) return;

    const lower = rawHref.toLowerCase();
    const type = lower.endsWith(".svg")
      ? "image/svg+xml"
      : lower.endsWith(".ico")
      ? "image/x-icon"
      : lower.endsWith(".webp")
      ? "image/webp"
      : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : "image/png";

    document
      .querySelectorAll<HTMLLinkElement>(
        'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
      )
      .forEach((el) => el.parentNode?.removeChild(el));

    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = type;
    icon.href = rawHref;
    document.head.appendChild(icon);

    const apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    apple.href = rawHref;
    document.head.appendChild(apple);

    return () => {
      // Restore parent app favicon on unmount so other routes don't
      // inherit the MSP's brand icon.
      document
        .querySelectorAll<HTMLLinkElement>(
          'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
        )
        .forEach((el) => el.parentNode?.removeChild(el));

      const defaultIcon = document.createElement("link");
      defaultIcon.rel = "icon";
      defaultIcon.type = "image/png";
      defaultIcon.href = "/favicon.png";
      document.head.appendChild(defaultIcon);

      const defaultApple = document.createElement("link");
      defaultApple.rel = "apple-touch-icon";
      defaultApple.href = "/favicon.png";
      document.head.appendChild(defaultApple);
    };
  }, [faviconUrl, logoUrl]);
}
