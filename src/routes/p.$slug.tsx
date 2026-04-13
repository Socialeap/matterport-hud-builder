import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";

const fetchBrandingBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { data: branding, error } = await supabaseAdmin
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (error || !branding) {
      return { branding: null };
    }
    return { branding };
  });

export const Route = createFileRoute("/p/$slug")({
  head: () => ({
    meta: [
      { title: "3D Property Presentations" },
      { name: "description", content: "Create stunning 3D property tour presentations" },
    ],
  }),
  loader: async ({ params }) => {
    const result = await fetchBrandingBySlug({ data: { slug: params.slug } });
    return result as { branding: Awaited<ReturnType<typeof fetchBrandingBySlug>>["branding"] };
  },
  component: PortalPage,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-foreground">Portal Not Found</h1>
        <p className="mt-2 text-muted-foreground">This provider portal does not exist.</p>
      </div>
    </div>
  ),
});

function PortalPage() {
  const { branding } = Route.useLoaderData();

  if (!branding) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-foreground">Portal Not Found</h1>
          <p className="mt-2 text-muted-foreground">This provider portal does not exist or hasn't been configured yet.</p>
        </div>
      </div>
    );
  }

  return <HudBuilderSandbox branding={branding} />;
}
