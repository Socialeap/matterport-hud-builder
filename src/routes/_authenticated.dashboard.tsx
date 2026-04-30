import { createFileRoute, Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, LogOut, Sparkles, User as UserIcon, X } from "lucide-react";
import { MspAccessProvider, useMspAccess } from "@/hooks/use-msp-access";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sendTransactionalEmail } from "@/lib/email/send";
import { checkGrantExpiryEmailNeeded } from "@/lib/grant-expiry.functions";
import { buildStudioUrl } from "@/lib/public-url";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardLayoutWrapper,
});

function DashboardLayoutWrapper() {
  return (
    <MspAccessProvider>
      <DashboardLayout />
    </MspAccessProvider>
  );
}

interface ExpiryAlert {
  daysLeft: number;
  expiryDate: string;
  pricingUrl: string;
}

function DashboardLayout() {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { loading: accessLoading, hasPaid, isClient } = useMspAccess();
  const [expiryAlert, setExpiryAlert] = useState<ExpiryAlert | null>(null);
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false);

  const isUpgradePage = location.pathname === "/dashboard/upgrade";
  const showTrialBanner = !accessLoading && !hasPaid && !isClient && !isUpgradePage && !trialBannerDismissed;

  // Expiry-warning alert (admin grants nearing expiration). Independent
  // of the trial gate — runs only for users who already have access.
  useEffect(() => {
    if (!user || isClient) return;

    let cancelled = false;
    (async () => {
      const [grantRes, brandingRes] = await Promise.all([
        supabase
          .from("admin_grants")
          .select("tier, expires_at")
          .eq("provider_id", user.id)
          .is("revoked_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("branding_settings")
          .select("slug, brand_name")
          .eq("provider_id", user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      const grant = grantRes.data;
      if (!grant?.expires_at) return;

      const msLeft = new Date(grant.expires_at).getTime() - Date.now();
      const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
      if (daysLeft > 14 || daysLeft <= 0) return;

      const slug = brandingRes.data?.slug ?? "";
      const pricingUrl = slug
        ? buildStudioUrl(slug) + "#pricing"
        : window.location.origin + "#pricing";
      const expiryDate = new Date(grant.expires_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      setExpiryAlert({ daysLeft, expiryDate, pricingUrl });

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user.email) {
        try {
          const { shouldSend } = await checkGrantExpiryEmailNeeded({
            data: { recipientEmail: session.user.email },
          });
          if (shouldSend) {
            await sendTransactionalEmail({
              templateName: "grant-expiry-warning",
              recipientEmail: session.user.email,
              idempotencyKey: `grant-expiry-${user.id}-${grant.expires_at}`,
              templateData: {
                brandName: brandingRes.data?.brand_name ?? "Your Studio",
                daysLeft,
                expiryDate,
                pricingUrl,
              },
            });
          }
        } catch {
          // Non-critical: banner still shows even if email fails
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, isClient]);

  if (accessLoading) {
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
            <div className="ml-auto flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-2">
                    <UserIcon className="size-4" />
                    <span className="hidden sm:inline max-w-[180px] truncate">
                      {user?.email ?? "Account"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="truncate">
                    {user?.email ?? "Signed in"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => navigate({ to: "/dashboard/account" })}
                    className="cursor-pointer"
                  >
                    <UserIcon className="mr-2 size-4" />
                    Account
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      void signOut();
                    }}
                    className="cursor-pointer text-destructive focus:text-destructive"
                  >
                    <LogOut className="mr-2 size-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {expiryAlert && (
            <div className="px-6 pt-4">
              <Alert className="border-amber-400 bg-amber-50 text-amber-900">
                <AlertTriangle className="size-4 text-amber-600" />
                <AlertTitle className="text-amber-900">
                  Your complimentary access expires in{" "}
                  {expiryAlert.daysLeft} day{expiryAlert.daysLeft !== 1 ? "s" : ""}
                </AlertTitle>
                <AlertDescription className="text-amber-800">
                  To keep your Studio online, please{" "}
                  <a
                    href={expiryAlert.pricingUrl}
                    className="underline font-medium"
                    target="_blank"
                    rel="noreferrer"
                  >
                    purchase a plan
                  </a>{" "}
                  before {expiryAlert.expiryDate}.
                </AlertDescription>
              </Alert>
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
