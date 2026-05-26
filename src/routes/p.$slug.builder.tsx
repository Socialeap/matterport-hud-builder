import type React from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { fetchPublicBrandingBySlug } from "@/lib/public-portal.functions";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";
import { Button } from "@/components/ui/button";
import { IndexingProvider } from "@/lib/rag/indexing-context";
import { AccountMenu } from "@/components/account/AccountMenu";
import { useBrandedFavicon } from "@/hooks/use-branded-favicon";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Lock } from "lucide-react";


export const Route = createFileRoute("/p/$slug/builder")({
  head: () => ({
    meta: [
      { title: "Presentation Builder" },
      { name: "description", content: "Build your branded 3D property presentation." },
    ],
  }),
  loader: async ({ params }) => fetchPublicBrandingBySlug({ data: { slug: params.slug } }),
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

function TrialExpiredPaywall({ slug }: { slug: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="mx-auto max-w-md text-center">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <Lock className="size-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">
          Trial Period Expired
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your 30-day free evaluation has ended and your workspace is now
          restricted. To continue editing presentations and keep your studio
          live, please purchase a setup tier.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link to="/" hash="pricing">
            <Button className="w-full">View Plans &amp; Upgrade</Button>
          </Link>
          <Link to="/p/$slug" params={{ slug }}>
            <Button variant="outline" className="w-full">
              Back to Studio
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function BuilderPage() {
  const { branding } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const { user, roles } = useAuth();
  const [previewBlocked, setPreviewBlocked] = useState(false);

  useBrandedFavicon(
    (branding as { favicon_url?: string | null } | null)?.favicon_url,
    (branding as { logo_url?: string | null } | null)?.logo_url,
  );

  useEffect(() => {
    if (!user || !roles.includes("provider")) return;
    (supabase as any)
      .rpc("provider_preview_allowed", { _provider_id: user.id })
      .then(({ data }: { data: boolean | null }) => {
        if (data === false) setPreviewBlocked(true);
      });
  }, [user, roles]);

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

  if (previewBlocked) {
    return <TrialExpiredPaywall slug={slug} />;
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
