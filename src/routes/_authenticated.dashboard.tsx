import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tierChecked, setTierChecked] = useState(false);
  const [hasTier, setHasTier] = useState(false);

  const isPricingPage = location.pathname === "/dashboard/pricing";

  useEffect(() => {
    if (!user) return;
    supabase
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("environment", "sandbox")
      .eq("status", "completed")
      .limit(1)
      .then(({ data }) => {
        const purchased = (data?.length ?? 0) > 0;
        setHasTier(purchased);
        setTierChecked(true);
        if (!purchased && !isPricingPage) {
          navigate({ to: "/dashboard/pricing" });
        }
      });
  }, [user, isPricingPage, navigate]);

  if (!tierChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <DashboardSidebar />
        <main className="flex-1">
          <div className="flex items-center gap-2 border-b border-border px-6 py-3">
            <SidebarTrigger />
            {!hasTier && isPricingPage && (
              <span className="text-sm text-amber-600 font-medium">
                Purchase a plan to access the full dashboard.
              </span>
            )}
          </div>
          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
