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
  const { user, roles } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tierChecked, setTierChecked] = useState(false);
  const [hasTier, setHasTier] = useState(false);

  const isUpgradePage = location.pathname === "/dashboard/upgrade";
  const isClient = roles.includes("client");

  useEffect(() => {
    if (!user) return;

    // Clients skip the purchase gate — their provider owns the license
    if (isClient) {
      setHasTier(true);
      setTierChecked(true);
      return;
    }

    // Check for license OR legacy purchase
    const checkAccess = async () => {
      const [licenseRes, purchaseRes] = await Promise.all([
        supabase
          .from("licenses")
          .select("id")
          .eq("user_id", user.id)
          .limit(1),
        supabase
          .from("purchases")
          .select("id")
          .eq("user_id", user.id)
          .eq("environment", "sandbox")
          .eq("status", "completed")
          .limit(1),
      ]);
      const hasAccess =
        (licenseRes.data?.length ?? 0) > 0 ||
        (purchaseRes.data?.length ?? 0) > 0;
      setHasTier(hasAccess);
      setTierChecked(true);
      if (!hasAccess && !isUpgradePage) {
        navigate({ to: "/dashboard/upgrade" });
      }
    };
    checkAccess();
  }, [user, isUpgradePage, navigate, isClient]);

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
            {!hasTier && isUpgradePage && (
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
