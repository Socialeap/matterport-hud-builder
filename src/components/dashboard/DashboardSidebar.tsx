import { Link, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Palette,
  Users,
  Play,
  LayoutDashboard,
  LogOut,
  ShoppingCart,
  Archive,
  Banknote,
  DollarSign,
  UserCog,
  Lock,
  BarChart2,
  Shield,
} from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMspAccess } from "@/hooks/use-msp-access";

type NavRoute =
  | "/dashboard"
  | "/dashboard/branding"
  | "/dashboard/vault"
  | "/dashboard/pricing"
  | "/dashboard/orders"
  | "/dashboard/payouts"
  | "/dashboard/clients"
  | "/dashboard/demo"
  | "/dashboard/stats"
  | "/dashboard/account";

interface NavItem {
  label: string;
  to: NavRoute;
  icon: typeof LayoutDashboard;
  roles: readonly ("provider" | "client")[];
  requiresPro?: boolean;
  requiresPaid?: boolean;
}

const allNavItems: readonly NavItem[] = [
  { label: "Overview", to: "/dashboard", icon: LayoutDashboard, roles: ["provider", "client"] },
  { label: "Branding", to: "/dashboard/branding", icon: Palette, roles: ["provider"] },
  { label: "Production Vault", to: "/dashboard/vault", icon: Archive, roles: ["provider"], requiresPaid: true },
  { label: "Pricing", to: "/dashboard/pricing", icon: DollarSign, roles: ["provider"] },
  { label: "Orders", to: "/dashboard/orders", icon: ShoppingCart, roles: ["provider", "client"] },
  { label: "Payouts", to: "/dashboard/payouts", icon: Banknote, roles: ["provider"], requiresPaid: true },
  { label: "Clients", to: "/dashboard/clients", icon: Users, roles: ["provider"], requiresPaid: true },
  { label: "Demo", to: "/dashboard/demo", icon: Play, roles: ["provider"] },
  { label: "Stats", to: "/dashboard/stats", icon: BarChart2, roles: ["provider"] },
  { label: "Account", to: "/dashboard/account", icon: UserCog, roles: ["provider", "client"] },
];

export function DashboardSidebar() {
  const { user, roles, signOut } = useAuth();
  const location = useLocation();
  const { hasPaid } = useMspAccess();
  const [tier, setTier] = useState<"starter" | "pro" | null>(null);

  const isClient = roles.includes("client");
  const isAdmin = roles.includes("admin");

  useEffect(() => {
    if (!user || isClient) return;
    supabase
      .from("branding_settings")
      .select("tier")
      .eq("provider_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setTier((data?.tier as "starter" | "pro") ?? "starter");
      });
  }, [user, isClient]);

  const isPro = tier === "pro";

  const navItems = isClient
    ? allNavItems.filter((item) => item.roles.includes("client"))
    : allNavItems;

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <span className="text-lg font-bold text-sidebar-foreground">
          3D Presentation Studio
        </span>
        <span className="mt-1 inline-block rounded-full bg-sidebar-accent px-2 py-0.5 text-xs font-medium text-sidebar-accent-foreground">
          {roles[0] ?? "user"}
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarGroupContent>
            <TooltipProvider delayDuration={200}>
              <SidebarMenu>
                {navItems.map((item) => {
                  const isActive =
                    item.to === "/dashboard"
                      ? location.pathname === "/dashboard"
                      : location.pathname.startsWith(item.to);

                  // Client-friendly label override
                  const label =
                    isClient && item.to === "/dashboard/orders"
                      ? "My Orders"
                      : item.label;

                  // Lock conditions:
                  // - Vault stays Pro-only for paid MSPs (existing rule).
                  // - Special Components (Vault/Payouts/Clients) lock for any
                  //   unpaid MSP until purchase.
                  const lockedForPro = item.requiresPro && !isPro && !isClient;
                  const lockedForUnpaid = item.requiresPaid && !hasPaid && !isClient;
                  const isLocked = lockedForPro || lockedForUnpaid;
                  const lockTooltip = lockedForUnpaid
                    ? `Purchase a plan to unlock ${item.label}`
                    : "Upgrade to Pro to unlock the Production Vault";

                  if (isLocked) {
                    return (
                      <SidebarMenuItem key={item.to}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <SidebarMenuButton
                              className="cursor-not-allowed opacity-60"
                              aria-disabled="true"
                              onClick={(e) => e.preventDefault()}
                            >
                              <item.icon className="size-4" />
                              <span>{label}</span>
                              <Lock className="ml-auto size-3" />
                            </SidebarMenuButton>
                          </TooltipTrigger>
                          <TooltipContent side="right">
                            {lockTooltip}
                          </TooltipContent>
                        </Tooltip>
                      </SidebarMenuItem>
                    );
                  }

                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton asChild isActive={isActive}>
                        <Link to={item.to}>
                          <item.icon className="size-4" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </TooltipProvider>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith("/admin")}
                  >
                    <Link to="/admin">
                      <Shield className="size-4" />
                      <span>Admin Portal</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-4">
        <p className="truncate text-xs text-sidebar-foreground/70">
          {user?.email}
        </p>
        <button
          onClick={signOut}
          className="mt-2 flex items-center gap-2 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground"
        >
          <LogOut className="size-3" />
          Sign out
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}
