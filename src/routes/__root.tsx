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
      { title: "3D Presentation Studio" },
      { name: "description", content: "White-label Matterport 3D tour presentation platform by Transcendence Media." },
      { name: "author", content: "Transcendence Media" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "3D Presentation Studio" },
      { property: "og:title", content: "3D Presentation Studio" },
      { property: "og:description", content: "White-label Matterport 3D tour presentation platform by Transcendence Media." },
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
              name: "3D Presentation Studio",
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
