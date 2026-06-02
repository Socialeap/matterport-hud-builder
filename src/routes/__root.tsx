/**
 * Frontiers3D root layout.
 *
 * Architectural note: this platform is intentionally **spatial-agnostic**.
 * Matterport is the current primary 3D source, but the presentation engine,
 * HUD, AI Concierge, and data model are designed to accept any spatial
 * source — including Google Street View panoramas and Genie 3 generative
 * world coordinates — without core rewrites. Future rollouts will add
 * adapters behind a unified spatial-source interface.
 */
import { Outlet, Link, createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">
          Page not found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Frontiers|3D" },
      { name: "description", content: "Frontiers|3D — a spatial-agnostic 3D presentation platform by Transcendence Media. Build branded, interactive property and world experiences." },
      { name: "author", content: "Transcendence Media" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Frontiers|3D" },
      { property: "og:title", content: "Frontiers|3D" },
      { property: "og:description", content: "Spatial-agnostic 3D presentation platform — Matterport today; Google Street View and Genie 3 generative worlds next." },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "google-site-verification", content: "jjiVIwqcuUy5j_XMvbPFCMGBaNtSUGGQT5PGrcVZXDo" },

    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/favicon.png" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": "https://www.frontiers3d.com/#organization",
              name: "Transcendence Media",
              url: "https://www.frontiers3d.com",
              logo: "https://www.frontiers3d.com/favicon.png",
            },
            {
              "@type": "WebSite",
              "@id": "https://www.frontiers3d.com/#website",
              name: "Frontiers|3D",

              url: "https://www.frontiers3d.com",
              publisher: { "@id": "https://www.frontiers3d.com/#organization" },
            },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
