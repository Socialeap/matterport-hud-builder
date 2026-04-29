import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ExternalLink, KeyRound, ShieldAlert, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { deleteOwnAccount } from "@/lib/portal.functions";

export const Route = createFileRoute("/_authenticated/dashboard/account")({
  component: AccountPage,
});

function AccountPage() {
  const { user, signOut, roles } = useAuth();
  const navigate = useNavigate();
  const deleteAccount = useServerFn(deleteOwnAccount);
  const isClient = roles.includes("client") && !roles.includes("provider") && !roles.includes("admin");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setSavingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPw(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated.");
    setNewPassword("");
    setConfirmPassword("");
  };

  const handleDelete = async () => {
    if (confirmEmail.trim().toLowerCase() !== (user?.email ?? "").toLowerCase()) {
      toast.error("Email does not match — type your account email exactly.");
      return;
    }
    setDeleting(true);
    try {
      await deleteAccount();
      await signOut();
      toast.success("Account deleted.");
      navigate({ to: "/" });
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete account. Please try again.");
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Account
        </h1>
        <p className="mt-2 text-muted-foreground">
          Manage your password, review legal policies, and delete your account.
        </p>
      </div>

      {/* Reset Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" />
            <CardTitle>Change Password</CardTitle>
          </div>
          <CardDescription>
            Update the password used to sign in to {user?.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_pw">New password</Label>
              <Input
                id="new_pw"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm_pw">Confirm new password</Label>
              <Input
                id="confirm_pw"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" disabled={savingPw}>
              {savingPw ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Updating…
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Ask AI / BYOK is now Client-scoped and lives inside the Builder
          (Property Intelligence section). MSPs no longer manage a Gemini key
          here — each Client adds their own. */}

      {/* Privacy & Terms */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <CardTitle>Privacy &amp; Terms</CardTitle>
          </div>
          <CardDescription>
            Review the legal policies that govern your use of the platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild variant="outline" size="sm">
            <a href="/privacy" target="_blank" rel="noopener noreferrer">
              Privacy Policy <ExternalLink className="size-3" />
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/terms" target="_blank" rel="noopener noreferrer">
              Terms of Service <ExternalLink className="size-3" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            <CardTitle className="text-destructive">Delete Account</CardTitle>
          </div>
          <CardDescription>
            Permanently delete your account and all associated data. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete my account…</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                <AlertDialogDescription>
                  {isClient
                    ? "This will permanently delete your account and all associated data. "
                    : "This will permanently delete your account, your Studio settings, saved presentations, and all associated data. "}
                  Type <span className="font-mono font-semibold">{user?.email}</span> below
                  to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                placeholder={user?.email ?? ""}
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="off"
              />
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => {
                    e.preventDefault();
                    handleDelete();
                  }}
                  disabled={deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Deleting…
                    </>
                  ) : (
                    "Yes, delete my account"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
