import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { HudBuilderSandbox } from "@/components/portal/HudBuilderSandbox";
import { checkDemoPublished } from "@/lib/sandbox-demo.functions";

const fetchBrandingBySlug = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    const { data: branding, error } = await supabase
      .from("branding_settings")
      .select("*")
      .eq("slug", data.slug)
      .maybeSingle();

    if (error || !branding) {
      return { branding: null, demoPublished: false };
    }
    const demoCheck = await checkDemoPublished({ data: { providerId: branding.provider_id } });
    return { branding, demoPublished: demoCheck.published };
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
    return result;
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
  const { branding, demoPublished } = Route.useLoaderData();
  const { slug } = Route.useParams();

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

  return (
    <>
      {demoPublished && (
        <div
          className="w-full px-4 py-2 text-center text-sm font-medium text-white"
          style={{ backgroundColor: branding.accent_color }}
        >
          ✨ See a Live Demo of {branding.brand_name}'s 3D Studio →{" "}
          <Link to="/p/$slug/demo" params={{ slug }} className="underline font-semibold">
            View Demo
          </Link>
        </div>
      )}
      <HudBuilderSandbox branding={branding} />
    </>
  );
}
