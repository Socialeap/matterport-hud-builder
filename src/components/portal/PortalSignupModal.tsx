import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

interface PortalSignupModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticated: (userId: string) => void;
  providerId: string;
  accentColor: string;
  brandName: string;
}

export function PortalSignupModal({
  open,
  onOpenChange,
  onAuthenticated,
  providerId: _providerId,
  accentColor,
  brandName,
}: PortalSignupModalProps) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  // If the user signs in via OAuth (or any other surface) while this modal
  // is mounted, close it and propagate the authenticated user id so the
  // portal page rehydrates as a logged-in viewer.
  useEffect(() => {
    if (!open) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        onAuthenticated(session.user.id);
        onOpenChange(false);
      }
    });
    return () => subscription.unsubscribe();
  }, [open, onAuthenticated, onOpenChange]);

  const handleGoogleAuth = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        // Return to the exact same portal URL so the user lands back where
        // they were (e.g. /p/{slug} or /p/{slug}/builder).
        redirect_uri: window.location.href,
      });
      if (result.error) {
        toast.error(
          result.error instanceof Error
            ? result.error.message
            : "Google sign-in failed",
        );
        setLoading(false);
        return;
      }
      if (result.redirected) return; // browser is navigating to Google
      // Tokens already set by the lovable helper — finalize locally.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        onAuthenticated(user.id);
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Google sign-in failed",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === "signup") {
      // Note: We do NOT pre-create a client_providers link here. Studio
      // access entitlement (free vs paid) is resolved server-side by
      // `resolve_studio_access`, which heals from accepted invitations.
      // Pre-creating a row here with `is_free = false` would override an
      // MSP's "free" assignment.
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name },
        },
      });

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        toast.info(
          `If ${brandName || "the provider"} has invited you, please use the invitation link in your email to link your account. Otherwise, contact them for an invitation.`,
        );
        onAuthenticated(data.user.id);
      } else {
        toast.info("Check your email to confirm your account, then sign in.");
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        onAuthenticated(data.user.id);
      }
    }

    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {mode === "signup" ? "Create Your Account" : "Sign In"}
          </DialogTitle>
          <DialogDescription>
            {mode === "signup"
              ? `Sign up to download your presentation from ${brandName || "the provider"}.`
              : `Sign in to download your presentation from ${brandName || "the provider"}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleGoogleAuth}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                Or continue with email
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div className="space-y-1">
                <Label className="text-xs">Full Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your Name"
                  required
                />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <Button
              type="submit"
              className="w-full text-white"
              style={{ backgroundColor: accentColor }}
              disabled={loading}
            >
              {loading
                ? "Please wait…"
                : mode === "signup"
                  ? "Create Account"
                  : "Sign In"}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  style={{ color: accentColor }}
                  onClick={() => setMode("login")}
                >
                  Sign in
                </button>
              </>
            ) : (
              <>
                Don't have an account?{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  style={{ color: accentColor }}
                  onClick={() => setMode("signup")}
                >
                  Sign up
                </button>
              </>
            )}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
