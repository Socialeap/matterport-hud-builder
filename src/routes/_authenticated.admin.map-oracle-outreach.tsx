import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw, ShieldAlert, AlertTriangle, Globe, Search, Megaphone, FilePlus2, Eye, Send, FlaskConical, MapPinned,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/map-oracle-outreach")({
  component: AdminMapOracleOutreach,
});

// Hard-coded operator inbox for internal test sends. A test send delivers ONLY
// here (never to the prospect) and does not change the outreach row.
const TEST_RECIPIENT = "shakoure@transcendencemedia.com";

interface ReadinessRow {
  property_id: string;
  business_name: string | null;
  city: string | null;
  region: string | null;
  website_url: string | null;
  email: string | null;
  email_confidence: string | null;
  enrichment_source: string | null;
  enrichment_candidate_count: number | null;
  enrichment_pages_fetched: number | null;
  enrichment_note: string | null;
  enriched_at: string | null;
  beacon_id: string | null;
  beacon_status: string | null;
  promoted: boolean | null;
  outreach_log_id: string | null;
  outreach_status: string | null;
  outreach_at: string | null;
  email_sent: boolean | null;
  readiness: string | null;
}

// The readiness RPC + some Map-Oracle RPCs/functions may lag the generated
// Database types; cast through unknown (repo idiom) for these calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sbAny = supabase as unknown as any;

const STATUS_STYLE: Record<string, string> = {
  not_promoted: "bg-muted text-muted-foreground border border-border",
  no_email: "bg-amber-100 text-amber-900 border border-amber-300",
  ready: "bg-blue-100 text-blue-900 border border-blue-300",
  pending_render: "bg-indigo-100 text-indigo-900 border border-indigo-300",
  queued: "bg-cyan-100 text-cyan-900 border border-cyan-300",
  sent: "bg-green-100 text-green-900 border border-green-300",
  suppressed: "bg-zinc-200 text-zinc-700 border border-zinc-300",
  failed: "bg-red-100 text-red-900 border border-red-300",
};
const STATUS_LABEL: Record<string, string> = {
  queued: "queued / already processed",
  not_promoted: "not promoted",
  no_email: "no email",
};

// Phases for the test-send delivery trace (queued → delivered / failed / timeout).
type TestPhase = "queued" | "pending" | "sent" | "failed" | "dlq" | "suppressed" | "timeout" | "error";
const TEST_PHASE_META: Record<TestPhase, { label: string; cls: string; spin?: boolean }> = {
  queued: { label: "Queued — waiting for dispatcher", cls: "bg-cyan-100 text-cyan-900 border-cyan-300", spin: true },
  pending: { label: "Pending delivery…", cls: "bg-indigo-100 text-indigo-900 border-indigo-300", spin: true },
  sent: { label: "Delivered", cls: "bg-green-100 text-green-900 border-green-300" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-900 border-red-300" },
  dlq: { label: "Dead-lettered (DLQ)", cls: "bg-red-100 text-red-900 border-red-300" },
  suppressed: { label: "Suppressed", cls: "bg-zinc-200 text-zinc-700 border-zinc-300" },
  timeout: { label: "Still queued (timed out)", cls: "bg-amber-100 text-amber-900 border-amber-300" },
  error: { label: "Status unavailable", cls: "bg-amber-100 text-amber-900 border-amber-300" },
};
function StatusPill({ s }: { s: string }) {
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s] ?? STATUS_STYLE.not_promoted}`}>
      {STATUS_LABEL[s] ?? s.replace(/_/g, " ")}
    </span>
  );
}

function AdminMapOracleOutreach() {
  const { roles, isLoading: authLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<ReadinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<
    { label: string; warn?: string; run: () => Promise<void> } | null
  >(null);
  const [preview, setPreview] = useState<{
    businessName: string;
    to: string | null;
    from: string | null;
    senderDomain: string | null;
    subject: string | null;
    unsubscribeUrl: string | null;
    unsubscribeToken: string | null;
    html: string;
    text: string;
    evidenceSummary: string | null;
    verificationNote: string | null;
    evidence: Record<string, boolean> | null;
  } | null>(null);
  const [testStatus, setTestStatus] = useState<{
    businessName: string;
    to: string;
    messageId: string;
    label: string;
    subject: string;
    phase: TestPhase;
    detail?: string | null;
    evidenceSummary?: string | null;
    verificationNote?: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await sbAny.rpc("get_operator_outreach_readiness");
    if (err) {
      setError(err.message);
      setRows([]);
    } else {
      setRows((data ?? []) as ReadinessRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) void load();
    else setLoading(false);
  }, [authLoading, isAdmin, load]);

  const withBusy = async (pid: string, fn: () => Promise<void>) => {
    setBusy(pid);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const sessionToken = async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  };

  // ── Actions ─────────────────────────────────────────────────────────
  const enrich = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      // Read the function response `data`, not only `error`. functions.invoke
      // returns the JSON body in `data` on 2xx; on non-2xx it sets `err` with
      // the body available on err.context.
      const { data, error: err } = await sbAny.functions.invoke("enrich-property-email", {
        body: { property_id: r.property_id },
      });
      if (err) {
        let detail = err.message as string;
        try { const b = await err.context?.json?.(); if (b?.error) detail = b.error; } catch { /* ignore */ }
        toast.error(`Find email failed: ${detail}`);
        return;
      }
      if (data?.reason === "no website_url to enrich") {
        toast.warning("No website available to scan.");
      } else if (data?.wrote_email === true) {
        toast.success(`Email found and saved: ${data.chosen_email}`);
      } else if (data?.chosen_email) {
        toast.warning(`Email found but not written: ${data.chosen_email}`);
      } else {
        toast.warning(`No public email found after checking ${data?.pages_fetched ?? 0} page(s).`);
      }
      await load();
    });

  const promote = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const { error: err } = await sbAny.rpc("promote_property_to_beacon", { p_property_id: r.property_id });
      if (err) toast.error(`Promote failed: ${err.message}`);
      else {
        toast.success("Promoted to beacon.");
        await load();
      }
    });

  const createPending = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const { error: err } = await sbAny.rpc("send_map_oracle_outreach", {
        p_beacon_id: r.beacon_id,
        p_dry_run: false,
      });
      if (err) toast.error(`Create pending failed: ${err.message}`);
      else {
        toast.success("Pending outreach created.");
        await load();
      }
    });

  const renderCall = async (r: ReadinessRow, extra: Record<string, unknown>) => {
    const token = await sessionToken();
    if (!token) {
      toast.error("No active session.");
      return null;
    }
    const res = await fetch("/lovable/email/map-oracle/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ outreach_log_id: r.outreach_log_id, ...extra }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json().catch(() => null)) as Record<string, any> | null;
  };

  // Preview: render the EXACT live email and show it (no enqueue, no send).
  const dryRun = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const j = await renderCall(r, { dryRun: true });
      if (j?.dryRun) {
        const p = j.preview ?? {};
        setPreview({
          businessName: r.business_name ?? "candidate",
          to: p.to ?? null,
          from: p.from ?? null,
          senderDomain: p.sender_domain ?? null,
          subject: p.subject ?? null,
          unsubscribeUrl: p.unsubscribe_url ?? null,
          unsubscribeToken: p.unsubscribe_token ?? null,
          html: p.html ?? "",
          text: p.text ?? "",
          evidenceSummary: p.evidence_summary ?? null,
          verificationNote: p.verification_note ?? null,
          evidence: (p.evidence ?? null) as Record<string, boolean> | null,
        });
      } else {
        toast.error(j?.error || j?.reason || "Preview failed");
      }
    });

  // Send test to admin: the server route delivers the SAME email SYNCHRONOUSLY to
  // the operator inbox and returns a real delivered/failed result — no enqueue, no
  // status RPC, no polling. The prospect is never contacted; row stays pending_render.
  const testSend = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const j = await renderCall(r, { testSend: true });
      if (!j?.test) {
        if (j?.reason) toast.warning(`Test not sent: ${j.reason}`);
        else toast.error(j?.error || "Test send failed");
        return;
      }
      const messageId = String(j.message_id ?? "");
      const delivered = j.delivered === true;
      setTestStatus({
        businessName: r.business_name ?? "candidate",
        to: j.to ?? TEST_RECIPIENT,
        messageId,
        label: j.template_label ?? "map-oracle-preview-offer-test",
        subject: j.subject ?? "",
        phase: delivered ? "sent" : "failed",
        detail: delivered ? null : (j.error ?? "send failed"),
        evidenceSummary: j.evidence_summary ?? null,
        verificationNote: j.verification_note ?? null,
      });
      if (delivered) toast.success(`Test delivered to ${j.to ?? TEST_RECIPIENT}.`);
      else toast.error(`Test send failed: ${j.error ?? "unknown error"}`);
    });

  // Send to prospect: the live send (one row, confirmed). Unchanged.
  const sendOne = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const j = await renderCall(r, { dryRun: false });
      if (j?.success) {
        toast.success("Outreach enqueued (one email to the prospect).");
        await load();
      } else {
        toast.error(j?.error || j?.reason || "Send failed");
      }
    });

  // ── Permission denied (defensive; admin layout also guards) ──────────
  if (!authLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link to="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <MapPinned className="size-6 text-primary" />
            Map Oracle — Outreach Operator
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One-at-a-time: <strong>Find email</strong> (scans the website — never sends) → Promote → Create pending → Preview →
            {" "}<strong>Send test to admin</strong> → <strong>Send to prospect</strong>.
            “Preview” and “Send test to admin” never contact the business — the test copy is sent immediately and only to{" "}
            <span className="font-mono">{TEST_RECIPIENT}</span>, and the panel that appears confirms actual delivery (or the exact
            send error). Only “Send to prospect” emails the business, and it always asks for confirmation.
            Already-sent candidates can’t be re-sent.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" />
            <span className="font-medium">Couldn’t load readiness</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => void load()}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-16 text-center text-muted-foreground">
          No Map-Oracle candidates yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Business</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Website</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Outreach</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.readiness ?? "not_promoted";
                const displayStatus = status === "queued" && r.email_sent ? "sent" : status;
                const isBusy = busy === r.property_id;
                const terminalSent = status === "queued" || status === "sent";
                return (
                  <tr key={r.property_id} className="border-t border-border align-top hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {r.business_name || <span className="italic text-muted-foreground">Unnamed</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                      {[r.city, r.region].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.website_url ? (
                        <a href={r.website_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          <Globe className="size-3.5" /> site
                        </a>
                      ) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.email ? (
                        <div>
                          <div className="text-foreground">{r.email}</div>
                          {r.email_confidence && (
                            <div className="text-xs text-muted-foreground">confidence: {r.email_confidence}{r.enrichment_source ? ` · ${r.enrichment_source}` : ""}</div>
                          )}
                        </div>
                      ) : r.enriched_at ? (
                        <div className="text-xs text-muted-foreground">
                          <div className="font-medium text-foreground/70">no email found</div>
                          <div>
                            {(r.enrichment_candidate_count ?? 0)} candidate(s)
                            {r.enrichment_pages_fetched != null ? ` · ${r.enrichment_pages_fetched} page(s)` : ""}
                            {r.email_confidence ? ` · ${r.email_confidence}` : ""}
                          </div>
                          {r.enrichment_note && <div className="italic">{r.enrichment_note}</div>}
                          <div>scanned {new Date(r.enriched_at).toLocaleString()}</div>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">none — not scanned</span>
                      )}
                    </td>
                    <td className="px-3 py-2"><StatusPill s={displayStatus} /></td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {!r.email && (
                          <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void enrich(r)}
                            title="Scans the business website for a public email. Does not send anything.">
                            <Search className="mr-1 size-3.5" /> Find email
                          </Button>
                        )}
                        {r.email && !r.promoted && (
                          <Button size="sm" variant="outline" disabled={isBusy}
                            onClick={() => setConfirmState({ label: `Promote ${r.business_name ?? "candidate"} to a Map-Oracle beacon?`, run: () => promote(r) })}>
                            <Megaphone className="mr-1 size-3.5" /> Promote
                          </Button>
                        )}
                        {r.promoted && status === "ready" && (
                          <Button size="sm" variant="outline" disabled={isBusy}
                            onClick={() => setConfirmState({ label: `Create a pending outreach for ${r.business_name ?? "candidate"}?`, run: () => createPending(r) })}>
                            <FilePlus2 className="mr-1 size-3.5" /> Create pending
                          </Button>
                        )}
                        {status === "pending_render" && (
                          <>
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void dryRun(r)}
                              title="Renders the exact email and shows it here. Sends nothing.">
                              <Eye className="mr-1 size-3.5" /> Preview
                            </Button>
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void testSend(r)}
                              title={`Delivers a copy of this email only to ${TEST_RECIPIENT}. The prospect is NOT contacted and this row stays pending.`}>
                              <FlaskConical className="mr-1 size-3.5" /> Send test to admin
                            </Button>
                            <Button size="sm" disabled={isBusy}
                              title="Sends ONE real email to the prospect. Requires confirmation."
                              onClick={() => setConfirmState({
                                label: `Send ONE outreach email to the prospect ${r.email}?`,
                                warn: "This enqueues a real email to the BUSINESS that the dispatcher will deliver. It cannot be undone, and this candidate cannot be re-sent. (Use “Send test to admin” first if you only want to preview delivery.)",
                                run: () => sendOne(r),
                              })}>
                              <Send className="mr-1 size-3.5" /> Send to prospect
                            </Button>
                          </>
                        )}
                        {terminalSent && <span className="text-xs text-muted-foreground">already sent</span>}
                        {(status === "suppressed" || status === "failed") && (
                          <span className="text-xs text-muted-foreground">{status} — blocked</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation modal (required for promote / create-pending / send) */}
      {confirmState && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-foreground">Confirm</h3>
            <p className="mt-2 text-sm text-foreground">{confirmState.label}</p>
            {confirmState.warn && (
              <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{confirmState.warn}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmState(null)}>Cancel</Button>
              <Button size="sm" onClick={() => { const c = confirmState; setConfirmState(null); void c.run(); }}>Confirm</Button>
            </div>
          </div>
        </div>
      )}

      {/* Preview modal — renders the EXACT live email; nothing is sent */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card shadow-lg">
            {/* NOT SENT banner */}
            <div className="flex items-center gap-2 rounded-t-lg border-b border-amber-300 bg-amber-50 px-5 py-3 text-amber-900">
              <Eye className="size-4 shrink-0" />
              <span className="text-sm font-semibold">Preview only — NOT SENT. No email was delivered to anyone.</span>
            </div>

            <div className="overflow-y-auto px-5 py-4">
              <h3 className="text-base font-semibold text-foreground">{preview.businessName} — outreach preview</h3>

              {/* Headers / metadata */}
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="font-medium text-muted-foreground">Subject</dt>
                <dd className="text-foreground">{preview.subject ?? "—"}</dd>
                <dt className="font-medium text-muted-foreground">To (prospect)</dt>
                <dd className="font-mono text-foreground">{preview.to ?? "—"}</dd>
                <dt className="font-medium text-muted-foreground">From</dt>
                <dd className="text-foreground">{preview.from ?? "—"}</dd>
                <dt className="font-medium text-muted-foreground">Sender domain</dt>
                <dd className="text-foreground">{preview.senderDomain ?? "—"}</dd>
                <dt className="font-medium text-muted-foreground">Unsubscribe</dt>
                <dd className="break-all text-foreground">
                  {preview.unsubscribeUrl ?? "—"}
                  {preview.unsubscribeToken && (
                    <span className="text-muted-foreground"> (token: {preview.unsubscribeToken})</span>
                  )}
                </dd>
              </dl>

              {/* Evidence basis — what the email is actually allowed to claim */}
              {(preview.evidenceSummary || preview.evidence) && (
                <div className="mt-4 rounded border border-border bg-muted/30 p-3">
                  <div className="text-xs font-semibold text-foreground">Evidence basis</div>
                  {preview.evidenceSummary && (
                    <div className="mt-1 text-xs text-foreground">{preview.evidenceSummary}</div>
                  )}
                  <div className="text-xs text-amber-700">
                    {preview.verificationNote ?? "360 verification: not checked / not verified"}
                  </div>
                  {preview.evidence && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {Object.entries(preview.evidence).map(([k, v]) => (
                        <span
                          key={k}
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                            v ? "border-green-300 bg-green-50 text-green-800" : "border-border bg-muted text-muted-foreground"
                          }`}
                        >
                          {v ? "✓" : "✕"} {k}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    The email only claims what a ✓ flag backs. 360 / Street View / virtual-tour
                    presence is never asserted unless an explicit verified flag is set.
                  </p>
                </div>
              )}

              {/* Rendered HTML — sandboxed iframe so links/scripts are inert */}
              <div className="mt-4">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Rendered HTML</div>
                <iframe
                  title="Rendered email preview"
                  sandbox=""
                  srcDoc={preview.html}
                  className="h-[50vh] w-full rounded border border-border bg-white"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Links are disabled in this preview. Use “Send test to admin” to receive a live copy in your inbox.
                </p>
              </div>

              {/* Plain-text fallback */}
              <details className="mt-4">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Plain-text fallback</summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs text-foreground">{preview.text || "—"}</pre>
              </details>
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Test-send delivery trace — queued → delivered / failed / dlq / timeout */}
      {testStatus && (() => {
        const meta = TEST_PHASE_META[testStatus.phase];
        return (
          <div className="fixed bottom-4 right-4 z-50 w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <FlaskConical className="size-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Test send — {testStatus.businessName}</span>
              </div>
              <button
                onClick={() => setTestStatus(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
                {meta.spin && <span className="size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                {meta.label}
              </span>
            </div>

            {testStatus.phase === "sent" ? (
              <p className="mt-2 text-xs text-green-800">Test delivered to <span className="font-mono">{testStatus.to}</span>. The prospect was not contacted. (Check spam if it isn't in the inbox.)</p>
            ) : (testStatus.phase === "timeout" || testStatus.phase === "error" || testStatus.phase === "failed" || testStatus.phase === "dlq" || testStatus.phase === "suppressed") ? (
              <p className="mt-2 text-xs text-red-700">
                Not delivered. {testStatus.detail ? <span>{testStatus.detail} </span> : null}
                Share the message id and error below with Lovable to inspect the send logs.
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">Sending to the operator inbox only…</p>
            )}

            {(testStatus.evidenceSummary || testStatus.verificationNote) && (
              <div className="mt-2 rounded border border-border bg-muted/30 p-2 text-[11px]">
                {testStatus.evidenceSummary && <div className="text-foreground">{testStatus.evidenceSummary}</div>}
                <div className="text-amber-700">{testStatus.verificationNote ?? "360 verification: not checked / not verified"}</div>
              </div>
            )}

            <dl className="mt-3 space-y-1 rounded bg-muted/50 p-2 text-[11px]">
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">message_id</dt><dd className="break-all font-mono text-foreground">{testStatus.messageId}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">recipient</dt><dd className="font-mono text-foreground">{testStatus.to}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted-foreground">template</dt><dd className="font-mono text-foreground">{testStatus.label}</dd></div>
              <div className="flex flex-col gap-0.5"><dt className="text-muted-foreground">subject</dt><dd className="text-foreground">{testStatus.subject}</dd></div>
            </dl>
          </div>
        );
      })()}
    </div>
  );
}
