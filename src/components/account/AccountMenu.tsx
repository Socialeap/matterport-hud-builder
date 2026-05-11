import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User, ClipboardList, LayoutDashboard, ShieldCheck } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getMyAgentProfile } from "@/lib/agent-profile.functions";
import { AuthDialog } from "./AuthDialog";

interface AccountMenuProps {
  /** Optional className for the trigger area (signed-in avatar or signed-out buttons). */
  className?: string;
}

/**
 * Persistent identity affordance for the top-right of any header.
 *
 * - Signed-in: avatar + dropdown (profile, role-aware shortcuts, sign out)
 * - Signed-out: Sign in / Sign up buttons that open AuthDialog
 *
 * Safe to mount on any route — guards against SSR (useAuth returns
 * defaults), and only fetches the agent profile when authenticated.
 */
export function AccountMenu({ className }: AccountMenuProps) {
  const { isAuthenticated, user, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"signup" | "login">("signup");

  const fetchProfile = useServerFn(getMyAgentProfile);
  const profileQuery = useQuery({
    queryKey: ["agent-profile"],
    queryFn: () => fetchProfile(),
    enabled: isAuthenticated,
    staleTime: 60_000,
  });

  if (!isAuthenticated) {
    return (
      <>
        <div className={`flex items-center gap-2 ${className ?? ""}`}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAuthMode("login");
              setAuthOpen(true);
            }}
          >
            Sign in
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setAuthMode("signup");
              setAuthOpen(true);
            }}
          >
            Sign up
          </Button>
        </div>
        <AuthDialog open={authOpen} onOpenChange={setAuthOpen} initialMode={authMode} />
      </>
    );
  }

  const profile = profileQuery.data?.profile;
  const displayName = profile?.display_name?.trim() || user?.user_metadata?.full_name || user?.email || "Account";
  const email = user?.email ?? "";
  const avatarUrl = profile?.avatar_url ?? "";

  const initials = (displayName || email || "?")
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join("") || "?";

  const isProvider = roles.includes("provider");
  const isAdmin = roles.includes("admin");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`relative inline-flex items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ${className ?? ""}`}
          aria-label="Account menu"
        >
          <Avatar className="h-9 w-9 border border-border">
            {avatarUrl ? <AvatarImage src={avatarUrl} alt={displayName} /> : null}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col">
            <span className="text-sm font-medium leading-tight">{displayName}</span>
            {email && <span className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">{email}</span>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate({ to: "/agent-dashboard" })}>
          <User className="mr-2 size-4" />
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/agent-dashboard/work-orders" })}>
          <ClipboardList className="mr-2 size-4" />
          Work Orders
        </DropdownMenuItem>
        {isProvider && (
          <DropdownMenuItem onSelect={() => navigate({ to: "/dashboard" })}>
            <LayoutDashboard className="mr-2 size-4" />
            MSP Dashboard
          </DropdownMenuItem>
        )}
        {isAdmin && (
          <DropdownMenuItem onSelect={() => navigate({ to: "/admin" })}>
            <ShieldCheck className="mr-2 size-4" />
            Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut className="mr-2 size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
