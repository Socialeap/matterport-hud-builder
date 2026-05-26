import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Mail, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { sendTransactionalEmail } from "@/lib/email/send";
import { pollEmailSendStatus } from "@/lib/admin-email-test.functions";
import {
  fetchCheckoutMode,
  updateCheckoutMode,
  type CheckoutMode,
} from "@/lib/site-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  component: AdminSettings,
});

const templateKeys = Object.keys(TEMPLATES);

type TestStatus = "queued" | "pending" | "sent" | "failed" | "suppressed" | "dlq";

interface TestResult {
  status: TestStatus;
  errorMessage?: string;
}

function AdminSettings() {
  const { user } = useAuth();
  const [mode, setMode] = useState<CheckoutMode>("live");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const doUpdate = useServerFn(updateCheckoutMode);

  const [selectedTemplate, setSelectedTemplate] = useState(templateKeys[0]);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [polling, setPolling] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doPoll = useServerFn(pollEmailSendStatus);

  useEffect(() => {
    if (user?.email && !recipientEmail) {
      setRecipientEmail(user.email);
    }
  }, [user?.email]);

  useEffect(() => {
    fetchCheckoutMode()
      .then((res) => setMode(res.mode))
      .catch(() => toast.error("Failed to load checkout mode"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
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

  const startPolling = (messageId: string) => {
    setPolling(true);
    let attempts = 0;
    const maxAttempts = 20;

    const timer = setInterval(async () => {
      attempts++;
      try {
        const result = await doPoll({ data: { messageId } });
        const entries = result.entries;

        const terminal = entries.find(
          (e: { status: string }) =>
            e.status === "sent" ||
            e.status === "failed" ||
            e.status === "suppressed" ||
            e.status === "dlq",
        );

        if (terminal) {
          setTestResult({
            status: terminal.status as TestStatus,
            errorMessage: terminal.error_message ?? undefined,
          });
          clearInterval(timer);
          pollTimerRef.current = null;
          setPolling(false);
          if (terminal.status === "sent") {
            toast.success("Test email delivered successfully");
          } else {
            toast.error(
              `Email ${terminal.status}: ${terminal.error_message || "No details available"}`,
            );
          }
          return;
        }

        const hasPending = entries.some(
          (e: { status: string }) => e.status === "pending",
        );
        if (hasPending) {
          setTestResult({ status: "pending" });
        }
      } catch {
        // polling error — keep trying
      }

      if (attempts >= maxAttempts) {
        clearInterval(timer);
        pollTimerRef.current = null;
        setPolling(false);
        setTestResult({
          status: "pending",
          errorMessage:
            "Timed out waiting for delivery confirmation. The queue processor may not have run yet. Check the email_send_log table directly.",
        });
        toast.error("Polling timed out — check email_send_log manually");
      }
    }, 3000);

    pollTimerRef.current = timer;
  };

  const handleSendTest = async () => {
    if (!recipientEmail) {
      toast.error("Enter a recipient email address");
      return;
    }

    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }

    setSending(true);
    setTestResult(null);

    try {
      const template = TEMPLATES[selectedTemplate];
      const result = await sendTransactionalEmail({
        templateName: selectedTemplate,
        recipientEmail,
        templateData: template?.previewData ?? {},
        idempotencyKey: `admin-test-${Date.now()}`,
      });

      if (result.success && result.messageId) {
        setTestResult({ status: "queued" });
        toast.success("Email enqueued — watching for delivery status...");
        startPolling(result.messageId);
      } else if (result.reason === "email_suppressed") {
        setTestResult({ status: "suppressed" });
        toast.error("Recipient is on the suppression list — email was not sent");
      } else {
        setTestResult({
          status: "failed",
          errorMessage: result.error || "Enqueue returned unsuccessful",
        });
        toast.error(result.error || "Failed to enqueue email");
      }
    } catch (err: any) {
      setTestResult({
        status: "failed",
        errorMessage: err?.message || "Unknown error",
      });
      toast.error(err?.message || "Failed to send test email");
    } finally {
      setSending(false);
    }
  };

  const selectedHasFixedTo = TEMPLATES[selectedTemplate]?.to;

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Email Pipeline Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Send a real test email through the production pipeline to verify
            end-to-end delivery. The email uses the selected template's built-in
            preview data.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Template</label>
              <Select
                value={selectedTemplate}
                onValueChange={setSelectedTemplate}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {templateKeys.map((key) => (
                    <SelectItem key={key} value={key}>
                      {TEMPLATES[key].displayName || key}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Recipient Email</label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="admin@example.com"
              />
              {selectedHasFixedTo && (
                <p className="flex items-center gap-1.5 text-xs text-amber-600">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  This template has a fixed recipient ({selectedHasFixedTo}) —
                  the address above will be ignored.
                </p>
              )}
            </div>

            <Button
              onClick={handleSendTest}
              disabled={sending || polling}
              className="w-full gap-2"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" />
              )}
              {sending
                ? "Sending..."
                : polling
                  ? "Waiting for delivery..."
                  : "Send Test Email"}
            </Button>
          </div>

          {testResult && (
            <div className="flex items-start gap-3 rounded-lg border p-4">
              {testResult.status === "sent" && (
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-green-600" />
              )}
              {(testResult.status === "failed" || testResult.status === "dlq") && (
                <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
              )}
              {testResult.status === "suppressed" && (
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
              )}
              {(testResult.status === "queued" ||
                testResult.status === "pending") && (
                <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              )}

              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Badge
                    variant={
                      testResult.status === "sent"
                        ? "default"
                        : testResult.status === "failed" ||
                            testResult.status === "dlq"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {testResult.status}
                  </Badge>
                  {polling && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
                {testResult.errorMessage && (
                  <p className="text-sm text-muted-foreground break-words">
                    {testResult.errorMessage}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            Test emails go through the full pipeline: template render, suppression
            check, pgmq enqueue, queue processor, and Lovable API delivery. A
            successful send confirms the entire chain is working.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
