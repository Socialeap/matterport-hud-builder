import { useState } from "react";
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
  providerId,
  accentColor,
  brandName,
}: PortalSignupModalProps) {
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: name, provider_id: providerId },
        },
      });

      if (error) {
        toast.error(error.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        // Assign client role and link to provider
        // The handle_new_user trigger creates the profile
        // We need to update provider_id on the profile and add client role
        await supabase
          .from("profiles")
          .update({ provider_id: providerId })
          .eq("user_id", data.user.id);

        await supabase
          .from("client_providers")
          .insert({ client_id: data.user.id, provider_id: providerId });

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
              ? `Sign up to save your presentation and request it from ${brandName || "the provider"}.`
              : "Sign in to continue with your request."}
          </DialogDescription>
        </DialogHeader>

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
        </form>
      </DialogContent>
    </Dialog>
  );
}
