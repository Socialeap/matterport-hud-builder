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
import { Palette, Users, Play, LayoutDashboard, LogOut, CreditCard, ShoppingCart, Archive, Banknote } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const allNavItems = [
  { label: "Overview", to: "/dashboard", icon: LayoutDashboard, roles: ["provider", "client"] },
  { label: "Branding", to: "/dashboard/branding", icon: Palette, roles: ["provider"] },
  { label: "Vault", to: "/dashboard/vault", icon: Archive, roles: ["provider"] },
  { label: "Orders", to: "/dashboard/orders", icon: ShoppingCart, roles: ["provider", "client"] },
  { label: "Clients", to: "/dashboard/clients", icon: Users, roles: ["provider"] },
  { label: "Pricing", to: "/dashboard/pricing", icon: CreditCard, roles: ["provider"] },
  { label: "Payouts", to: "/dashboard/payouts", icon: Banknote, roles: ["provider"], requiresStripe: true },
  { label: "Demo", to: "/dashboard/demo", icon: Play, roles: ["provider"] },
] as const;

export function DashboardSidebar() {
  const { user, roles, signOut } = useAuth();
  const location = useLocation();
  const [stripeConnected, setStripeConnected] = useState(false);

  const isClient = roles.includes("client" as any);

  useEffect(() => {
    if (!user || isClient) return;
    supabase
      .from("branding_settings")
      .select("stripe_onboarding_complete")
      .eq("provider_id", user.id)
      .maybeSingle()
      .then(({ data }) => setStripeConnected(Boolean(data?.stripe_onboarding_complete)));
  }, [user, isClient]);

  // Filter nav items based on role and Stripe gating
  const navItems = (isClient
    ? allNavItems.filter((item) => (item.roles as readonly string[]).includes("client"))
    : allNavItems
  ).filter((item) => !(item as any).requiresStripe || stripeConnected);

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
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.to === "/dashboard"
                    ? location.pathname === "/dashboard"
                    : location.pathname.startsWith(item.to);
                return (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive}>
                      <Link to={item.to}>
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
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
