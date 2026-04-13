import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate({ to: "/dashboard" });
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Matterport HUD Builder
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Build professional 3D property presentations with custom branding.
          Generate standalone, host-anywhere HTML files.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Button size="lg" onClick={() => navigate({ to: "/login" })}>
            Sign In
          </Button>
          <Button
            size="lg"
            variant="outline"
            onClick={() => navigate({ to: "/signup", search: { token: "", email: "" } })}
          >
            Sign Up
          </Button>
        </div>
      </div>
    </div>
  );
}
