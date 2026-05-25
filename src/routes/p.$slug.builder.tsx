import type React from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { fetchPublicBrandingBySlug } from "@/lib/public-portal.functions";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";
import { Button } from "@/components/ui/button";
import { IndexingProvider } from "@/lib/rag/indexing-context";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useBrandedFavicon } from "@/hooks/use-branded-favicon";


export const Route = createFileRoute("/p/$slug/builder")({
  head: () => ({
    meta: [
      { title: "Presentation Builder" },
      { name: "description", content: "Build your branded 3D property presentation." },
    ],
  }),
  loader: async ({ params }) => fetchBrandingForBuilder({ data: { slug: params.slug } }),
  component: BuilderPage,
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
          <Button onClick={() => router.invalidate()} className="mt-4">Retry</Button>
        </div>
      </div>
    );
  },
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Studio Not Found</h1>
        <p className="mt-2 text-muted-foreground">This provider's Studio does not exist.</p>
      </div>
    </div>
  ),
});

function BuilderPage() {
  const { branding } = Route.useLoaderData();
  const { slug } = Route.useParams();

  // Show the MSP's branded favicon in the browser tab (falls back to logo).
  useBrandedFavicon(
    (branding as { favicon_url?: string | null } | null)?.favicon_url,
    (branding as { logo_url?: string | null } | null)?.logo_url,
  );

  if (!branding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-foreground">Studio Not Found</h1>
          <p className="mt-2 text-muted-foreground">
            This provider's Studio does not exist or hasn't been configured yet.
          </p>
          <Link to="/p/$slug" params={{ slug }}>
            <Button className="mt-4">Back to Studio</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <IndexingProvider>
      <div className="fixed top-3 right-3 z-50">
        <AccountMenu />
      </div>
      <HudBuilderSandbox
        branding={branding as React.ComponentProps<typeof HudBuilderSandbox>["branding"]}
        slug={slug}
      />
    </IndexingProvider>
  );
}
