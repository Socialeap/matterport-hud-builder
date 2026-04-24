import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";
import { Button } from "@/components/ui/button";
import { IndexingProvider } from "@/lib/rag/indexing-context";

const fetchBrandingForBuilder = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { data: branding, error } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (error || !branding) {
      return { branding: null };
    }
    return { branding };
  });

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
      <HudBuilderSandbox branding={branding} slug={slug} />
    </IndexingProvider>
  );
}
