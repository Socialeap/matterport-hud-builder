import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const { user, roles, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <h1 className="text-xl font-bold text-foreground">Matterport HUD Builder</h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user?.email}</span>
            <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              {roles[0] ?? "user"}
            </span>
            <button
              onClick={signOut}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-12">
        <h2 className="text-3xl font-bold text-foreground">Welcome back</h2>
        <p className="mt-2 text-muted-foreground">
          Your dashboard is being built. Provider and client features coming soon.
        </p>
      </main>
    </div>
  );
}
