import { createFileRoute, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [tierChecked, setTierChecked] = useState(false);
  const [hasTier, setHasTier] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState<"active" | "expiring" | "expired" | null>(null);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState<string | null>(null);

  const isPricingPage = location.pathname === "/dashboard/pricing";

  useEffect(() => {
    if (!user) return;

    // Check purchase status (existing gate)
    const purchaseCheck = supabase
      .from("purchases")
      .select("id")
      .eq("user_id", user.id)
      .eq("environment", "sandbox")
      .eq("status", "completed")
      .limit(1)
      .then(({ data }) => {
        const purchased = (data?.length ?? 0) > 0;
        setHasTier(purchased);
        if (!purchased && !isPricingPage) {
          navigate({ to: "/dashboard/pricing" });
        }
      });

    // Check license status
    const licenseCheck = supabase
      .from("branding_settings")
      .select("license_status, license_expiry_date")
      .eq("provider_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.license_expiry_date) {
          setLicenseExpiryDate(data.license_expiry_date);
          const expiry = new Date(data.license_expiry_date);
          const now = new Date();
          const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          if (data.license_status !== "active" || daysUntilExpiry < 0) {
            setLicenseStatus("expired");
          } else if (daysUntilExpiry <= 30) {
            setLicenseStatus("expiring");
          } else {
            setLicenseStatus("active");
          }
        }
      });

    Promise.all([purchaseCheck, licenseCheck]).then(() => setTierChecked(true));
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

          {/* License expiry banners */}
          {licenseStatus === "expired" && (
            <div className="mx-6 mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">
                  Your operating license has expired.
                </p>
                <p className="text-xs text-red-500/80 dark:text-red-400/70 mt-0.5">
                  Renew for $49/year to restore full studio access including AI exports and hosting.
                </p>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => navigate({ to: "/dashboard/pricing" })}
              >
                Renew Now
              </Button>
            </div>
          )}
          {licenseStatus === "expiring" && (
            <div className="mx-6 mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  Your operating license expires on{" "}
                  {licenseExpiryDate ? new Date(licenseExpiryDate).toLocaleDateString() : "soon"}.
                </p>
                <p className="text-xs text-amber-500/80 dark:text-amber-400/70 mt-0.5">
                  Renew early to avoid any interruption to your studio.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate({ to: "/dashboard/pricing" })}
              >
                Renew
              </Button>
            </div>
          )}

          <div className="p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
