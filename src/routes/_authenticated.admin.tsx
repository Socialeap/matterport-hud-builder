import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

function AdminLayout() {
  const { user, roles, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!roles.includes("admin")) {
      navigate({ to: "/dashboard" });
    }
  }, [roles, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!roles.includes("admin")) return null;

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-3 flex items-center justify-between">
        <span className="font-semibold text-foreground">Admin Portal</span>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{user?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-destructive hover:underline"
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="p-6">
        <Outlet />
      </div>
    </div>
  );
}
