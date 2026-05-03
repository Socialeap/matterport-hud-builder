/**
 * Public agent-feedback page reached from the footer of a
 * marketplace-outreach email. POST-on-confirm: the GET render is a
 * pure information page so email-link prefetchers don't accidentally
 * apply the spam flag. The user has to click the explicit confirm
 * button, which fires a POST to /api/marketplace-feedback.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/marketplace/feedback/$token")({
  component: MarketplaceFeedbackPage,
});

type Status =
  | "loading"
  | "valid"
  | "already"
  | "invalid"
  | "submitting"
  | "done"
  | "error";

interface ValidationResult {
  valid: boolean;
  brand?: string | null;
  sentAt?: string | null;
  alreadyFlagged?: boolean;
}

function MarketplaceFeedbackPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<Status>("loading");
  const [info, setInfo] = useState<ValidationResult | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    let cancelled = false;
    fetch(`/api/marketplace-feedback?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data: ValidationResult) => {
        if (cancelled) return;
        if (!data?.valid) {
          setStatus("invalid");
          return;
        }
        setInfo(data);
        setStatus(data.alreadyFlagged ? "already" : "valid");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async () => {
    if (!token) return;
    setStatus("submitting");
    try {
      const res = await fetch("/api/marketplace-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json()) as { success?: boolean };
      setStatus(data?.success ? "done" : "error");
    } catch {
      setStatus("error");
    }
  };

  const sentLabel = info?.sentAt
    ? new Date(info.sentAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">
            Marketplace Feedback
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "loading" && (
            <p className="text-muted-foreground">Verifying…</p>
          )}

          {status === "valid" && (
            <>
              <p className="text-sm text-muted-foreground">
                Confirm that the outreach you received from{" "}
                <strong>{info?.brand ?? "this Pro Partner"}</strong>
                {sentLabel ? <> on {sentLabel}</> : null} was inappropriate
                or unwanted. We use this signal to lower the Pro's
                marketplace standing — it does not unsubscribe you from
                future Pro Partners in your area.
              </p>
              <Button variant="destructive" onClick={submit}>
                Yes, flag this outreach
              </Button>
              <p className="text-xs text-muted-foreground">
                Or close this page if it was sent appropriately.
              </p>
            </>
          )}

          {status === "submitting" && (
            <p className="text-muted-foreground">Submitting…</p>
          )}

          {status === "done" && (
            <p className="font-medium text-green-600">
              Thanks — we've recorded your feedback.
            </p>
          )}

          {status === "already" && (
            <p className="text-muted-foreground">
              You've already flagged this outreach. No further action is
              needed.
            </p>
          )}

          {status === "invalid" && (
            <p className="text-destructive">
              This feedback link is invalid or has expired.
            </p>
          )}

          {status === "error" && (
            <p className="text-destructive">
              Something went wrong. Please try again later.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
