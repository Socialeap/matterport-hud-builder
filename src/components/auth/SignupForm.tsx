import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface SignupFormProps {
  /**
   * "invite" — client signup gated behind an invitation token (token + email
   *   are pre-filled, account is auto-linked to the inviting MSP via the
   *   handle_new_user trigger).
   * "open"  — public MSP signup. No token required. New accounts land on
   *   /dashboard; the provider role is granted on first paid tier purchase.
   */
  mode?: "invite" | "open";
  inviteToken?: string;
  inviteEmail?: string;
}

export function SignupForm({ mode = "invite", inviteToken, inviteEmail }: SignupFormProps) {
  const isInvite = mode === "invite";
  const [email, setEmail] = useState(inviteEmail ?? "");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Where the user should land after auth completes.
  // - Invite flow: bounce back to /invite/{token} so it auto-finalizes the
  //   invitation and routes the client into the MSP's Studio.
  // - Open MSP flow: land on /dashboard so the new MSP can pick a tier.
  const postAuthRedirect =
    isInvite && inviteToken
      ? `${window.location.origin}/invite/${inviteToken}`
      : `${window.location.origin}/dashboard`;

  const handleSignup = async (e: FormEvent) => {
    e.preventDefault();
    if (isInvite && !inviteToken) {
      toast.error("An invitation token is required to sign up.");
      return;
    }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: postAuthRedirect,
          data: {
            full_name: fullName,
            ...(isInvite && inviteToken ? { invite_token: inviteToken } : {}),
          },
        },
      });
      if (error) {
        toast.error(error.message);
      } else {
        setIsSubmitted(true);
        toast.success("Check your email to verify your account.");
      }
    } catch {
      toast.error("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    if (isInvite && !inviteToken) {
      toast.error("An invitation token is required to sign up.");
      return;
    }
    setIsLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: postAuthRedirect,
        // Surface the invite token to the handle_new_user trigger via
        // raw_user_meta_data so first-time Google signups are auto-linked
        // to the inviting MSP and assigned the client role.
        ...(isInvite && inviteToken
          ? { extraParams: { invite_token: inviteToken } }
          : {}),
      });
      if (result.error) {
        toast.error(result.error instanceof Error ? result.error.message : "Google sign-up failed");
      }
      if (result.redirected) return;
    } catch {
      toast.error("Google sign-up failed");
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Check Your Email</CardTitle>
          <CardDescription>
            We've sent a verification link to <strong>{email}</strong>. Please check your inbox and click the link to activate your account.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link to="/login" className="text-sm text-primary hover:underline">
            Back to Sign In
          </Link>
        </CardFooter>
      </Card>
    );
  }

  // Invite-mode without a token: show the original "contact your MSP" panel.
  if (isInvite && !inviteToken) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Create Account</CardTitle>
          <CardDescription>An invitation token is required to sign up.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center">
            Please contact your Matterport Service Provider to request an invitation.
          </p>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="text-primary hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

  const headerTitle = isInvite ? "Create Account" : "Create Your MSP Account";
  const headerDesc = isInvite
    ? "You've been invited! Create your account below."
    : "Launch your branded 3D Presentation Studio in minutes.";

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">{headerTitle}</CardTitle>
        <CardDescription>{headerDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogleSignup}
          disabled={isLoading}
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
            <span className="bg-card px-2 text-muted-foreground">Or with email</span>
          </div>
        </div>

        <form onSubmit={handleSignup} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name</Label>
            <Input
              id="fullName"
              placeholder="John Doe"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              readOnly={!!inviteEmail}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? "Creating account..." : "Create Account"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center">
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
