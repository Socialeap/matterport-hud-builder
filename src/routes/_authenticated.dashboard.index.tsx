import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Palette, Play } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard/")({
  component: DashboardOverview,
});

function DashboardOverview() {
  const _auth = useAuth();

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Welcome back
        </h1>
        <p className="mt-1 text-muted-foreground">
          Manage your branding, clients, and tour configurations.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Link to="/dashboard/branding">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Palette className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">Branding</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Configure your logo, colors, and whitelabel settings.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/dashboard/clients">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Users className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">Clients</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Invite and manage your client accounts.
              </p>
            </CardContent>
          </Card>
        </Link>

        <Link to="/dashboard/demo">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader className="flex flex-row items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Play className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">Demo Mode</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Preview the marketing toolkit with sample data.
              </p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
