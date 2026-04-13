import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserPlus, Mail, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard/clients")({
  component: ClientsPage,
});

interface Invitation {
  id: string;
  email: string;
  status: "pending" | "accepted" | "expired";
  created_at: string;
  expires_at: string;
}

function ClientsPage() {
  const { user } = useAuth();
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const fetchInvitations = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("invitations")
      .select("id, email, status, created_at, expires_at")
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

    const { error } = await supabase.from("invitations").insert({
      provider_id: user.id,
      email: email.trim().toLowerCase(),
    });

    setSending(false);
    if (error) {
      toast.error(error.message.includes("duplicate")
        ? "This email has already been invited"
        : "Failed to send invitation");
    } else {
      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      fetchInvitations();
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
          <div className="flex items-end gap-3">
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
            <Button onClick={handleInvite} disabled={sending || !email.trim()}>
              {sending ? "Sending…" : "Send Invite"}
            </Button>
          </div>
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
