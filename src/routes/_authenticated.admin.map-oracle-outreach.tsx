import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw, ShieldAlert, AlertTriangle, Globe, Search, Megaphone, FilePlus2, Eye, Send, MapPinned,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/map-oracle-outreach")({
  component: AdminMapOracleOutreach,
});

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
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);

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

  const renderCall = async (r: ReadinessRow, dryRun: boolean) => {
    const token = await sessionToken();
    if (!token) {
      toast.error("No active session.");
      return null;
    }
    const res = await fetch("/lovable/email/map-oracle/render", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ outreach_log_id: r.outreach_log_id, dryRun }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (await res.json().catch(() => null)) as Record<string, any> | null;
  };

  const dryRun = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const j = await renderCall(r, true);
      if (j?.dryRun) {
        const p = j.preview ?? {};
        setPreview({
          title: `Preview — ${r.business_name ?? "candidate"} (not sent)`,
          body: `Subject: ${p.subject}\nTo: ${p.to}\nFrom: ${p.from}\nUnsubscribe token: ${p.unsubscribe_token}\nHTML bytes: ${p.html_bytes}\n\n${p.html_head ?? ""}…`,
        });
      } else {
        toast.error(j?.error || j?.reason || "Dry-run failed");
      }
    });

  const sendOne = (r: ReadinessRow) =>
    withBusy(r.property_id, async () => {
      const j = await renderCall(r, false);
      if (j?.success) {
        toast.success("Outreach enqueued (one email).");
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
            One-at-a-time: <strong>Find email</strong> (scans the website — never sends) → Promote → Create pending → Preview → <strong>Send</strong>.
            Only “Send” emails anyone, and it always asks for confirmation. Already-sent candidates can’t be re-sent.
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
                            <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void dryRun(r)}>
                              <Eye className="mr-1 size-3.5" /> Preview
                            </Button>
                            <Button size="sm" disabled={isBusy}
                              onClick={() => setConfirmState({
                                label: `Send ONE outreach email to ${r.email}?`,
                                warn: "This enqueues a real email that the dispatcher will deliver. It cannot be undone, and this candidate cannot be re-sent.",
                                run: () => sendOne(r),
                              })}>
                              <Send className="mr-1 size-3.5" /> Send
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

      {/* Dry-run preview modal */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-foreground">{preview.title}</h3>
            <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-xs text-foreground">{preview.body}</pre>
            <div className="mt-4 flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
