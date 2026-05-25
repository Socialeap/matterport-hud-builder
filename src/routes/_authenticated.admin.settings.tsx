import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  fetchCheckoutMode,
  updateCheckoutMode,
  type CheckoutMode,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: AdminSettings,
});

function AdminSettings() {
  const [mode, setMode] = useState<CheckoutMode>("live");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const doUpdate = useServerFn(updateCheckoutMode);

  useEffect(() => {
    fetchCheckoutMode()
      .then((res) => setMode(res.mode))
      .catch(() => toast.error("Failed to load checkout mode"))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (checked: boolean) => {
    const newMode: CheckoutMode = checked ? "waitlist" : "live";
    setSaving(true);
    try {
      await doUpdate({ data: { mode: newMode } });
      setMode(newMode);
      toast.success(
        newMode === "waitlist"
          ? "Pricing buttons now show the waitlist form"
          : "Pricing buttons now route to Stripe checkout",
      );
    } catch {
      toast.error("Failed to update checkout mode");
    } finally {
      setSaving(false);
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
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Site Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pricing CTA Mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Controls what happens when visitors click the purchase buttons on the
            home page pricing cards (Starter / Pro).
          </p>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">Waitlist Mode</span>
                <Badge variant={mode === "waitlist" ? "default" : "secondary"}>
                  {mode === "waitlist" ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {mode === "waitlist"
                  ? "Purchase buttons open the Jotform waitlist popup"
                  : "Purchase buttons route to Stripe checkout (live)"}
              </p>
            </div>
            <Switch
              checked={mode === "waitlist"}
              onCheckedChange={handleToggle}
              disabled={saving}
            />
          </div>

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <strong>Live Mode:</strong> Stripe checkout (default) &nbsp;·&nbsp;{" "}
            <strong>Waitlist Mode:</strong> Jotform popup form
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
