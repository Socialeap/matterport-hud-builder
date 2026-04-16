import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/unsubscribe")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: (search.token as string) || undefined,
  }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useSearch();
  const [status, setStatus] = useState<"loading" | "valid" | "already" | "invalid" | "done" | "error">("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("invalid");
      return;
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.valid) setStatus("valid");
        else if (data.reason === "already_unsubscribed") setStatus("already");
        else setStatus("invalid");
      })
      .catch(() => setStatus("error"));
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const res = await fetch("/email/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.success) setStatus("done");
      else if (data.reason === "already_unsubscribed") setStatus("already");
      else setStatus("error");
    } catch {
      setStatus("error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-xl">Email Preferences</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {status === "loading" && <p className="text-muted-foreground">Verifying…</p>}
          {status === "valid" && (
            <>
              <p className="text-muted-foreground">
                Click below to unsubscribe from future emails.
              </p>
              <Button onClick={handleUnsubscribe} disabled={processing}>
                {processing ? "Processing…" : "Confirm Unsubscribe"}
              </Button>
            </>
          )}
          {status === "done" && (
            <p className="text-green-600 font-medium">You have been unsubscribed successfully.</p>
          )}
          {status === "already" && (
            <p className="text-muted-foreground">You are already unsubscribed.</p>
          )}
          {status === "invalid" && (
            <p className="text-destructive">This unsubscribe link is invalid or has expired.</p>
          )}
          {status === "error" && (
            <p className="text-destructive">Something went wrong. Please try again later.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
