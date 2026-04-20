import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { sendTransactionalEmail } from "@/lib/email/send";
import { setClientFreeFlag } from "@/lib/portal.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserPlus, Mail, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { buildPlatformUrl } from "@/lib/public-url";

export const Route = createFileRoute("/_authenticated/dashboard/clients")({
  component: ClientsPage,
});

interface Invitation {
  id: string;
  email: string;
  status: "pending" | "accepted" | "expired";
  created_at: string;
  expires_at: string;
  is_free: boolean;
}

function ClientsPage() {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [inviteFree, setInviteFree] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const setFreeFlagFn = useServerFn(setClientFreeFlag);

  const fetchInvitations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("invitations")
      .select("id, email, status, created_at, expires_at, is_free")
      .eq("provider_id", user.id)
      .order("created_at", { ascending: false });

    if (data) {
      setInvitations(data as Invitation[]);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchInvitations();
  }, [fetchInvitations]);

  const handleInvite = async () => {
    if (!user || !email.trim()) return;
    setSending(true);

    const trimmedEmail = email.trim().toLowerCase();
    const { data: inserted, error } = await supabase.from("invitations").insert({
      provider_id: user.id,
      email: trimmedEmail,
      is_free: inviteFree,
    }).select("id, token").single();

    if (error) {
      setSending(false);
      toast.error(error.message.includes("duplicate")
        ? "This email has already been invited"
        : "Failed to send invitation");
      return;
    }

    // Send the invitation email
    try {
      const signupUrl = buildPlatformUrl(`/signup?token=${inserted.token}`);
      await sendTransactionalEmail({
        templateName: "invitation",
        recipientEmail: trimmedEmail,
        idempotencyKey: `invitation-${inserted.id}`,
        templateData: {
          providerName: user.user_metadata?.full_name || user.email,
          signupUrl,
        },
      });
    } catch (emailError) {
      console.error("Failed to send invitation email:", emailError);
      // Invitation was recorded, just the email failed
    }

    setSending(false);
    toast.success(`Invitation sent to ${email}`);
    setEmail("");
    setInviteFree(false);
    fetchInvitations();
  };

  const handleToggleFree = async (inv: Invitation, next: boolean) => {
    setTogglingId(inv.id);
    // Optimistic update
    setInvitations((prev) =>
      prev.map((i) => (i.id === inv.id ? { ...i, is_free: next } : i))
    );
    try {
      await setFreeFlagFn({ data: { invitationId: inv.id, isFree: next } });
      toast.success(`${inv.email} is now ${next ? "Free" : "Pay"}`);
    } catch (err) {
      // Revert on failure
      setInvitations((prev) =>
        prev.map((i) => (i.id === inv.id ? { ...i, is_free: !next } : i))
      );
      toast.error(err instanceof Error ? err.message : "Failed to update attribute");
    } finally {
      setTogglingId(null);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "accepted": return <CheckCircle2 className="size-4 text-green-500" />;
      case "expired": return <Clock className="size-4 text-destructive" />;
      default: return <Mail className="size-4 text-muted-foreground" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Invite clients to your platform. They'll receive an email with a signup link.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="size-5" />
            Send Invitation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label htmlFor="invite-email">Client Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${!inviteFree ? "text-foreground" : "text-muted-foreground"}`}>
                Pay
              </span>
              <Switch
                id="invite-free"
                checked={inviteFree}
                onCheckedChange={setInviteFree}
                aria-label="Toggle Free or Pay"
              />
              <span className={`text-sm font-medium ${inviteFree ? "text-foreground" : "text-muted-foreground"}`}>
                Free
              </span>
            </div>

            <Button onClick={handleInvite} disabled={sending || !email.trim()}>
              {sending ? "Sending…" : "Send Invite"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Free clients can download their Presentation at no cost. Default is <strong>Pay</strong>.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invitations</CardTitle>
        </CardHeader>
        <CardContent>
          {invitations.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No invitations yet. Send your first invite above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Charge</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {statusIcon(inv.status)}
                        <Badge
                          variant={
                            inv.status === "accepted"
                              ? "default"
                              : inv.status === "expired"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {inv.status}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={inv.is_free}
                          disabled={togglingId === inv.id}
                          onCheckedChange={(next) => handleToggleFree(inv, next)}
                          aria-label={`Toggle Free/Pay for ${inv.email}`}
                        />
                        <Badge variant={inv.is_free ? "default" : "outline"}>
                          {inv.is_free ? "Free" : "Pay"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
