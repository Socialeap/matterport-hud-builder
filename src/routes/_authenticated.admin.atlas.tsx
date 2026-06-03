import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw,
  ShieldAlert,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  ExternalLink,
  MapPinned,
  X,
  CheckCircle2,
  XCircle,
  Wand2,
} from "lucide-react";
import {
  CATEGORY_OPTIONS,
  categoryLabel,
  type AtlasEntry,
  type AtlasEntryKind,
  type AtlasEntryStatus,
} from "@/lib/atlas-demo-data";
import { atlasEntryInput } from "@/lib/atlas.functions";
import { useServerFn } from "@tanstack/react-start";
import { verifyShowcaseDeployment } from "@/lib/atlas-curation.functions";

export const Route = createFileRoute("/_authenticated/admin/atlas")({
  component: AdminAtlas,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sbAny = supabase as unknown as any;

interface FormState {
  id: string | null;
  kind: AtlasEntryKind;
  status: AtlasEntryStatus;
  title: string;
  category: string;
  presentation_url: string;
  summary: string;
  hero_image_url: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
  tags: string;
  sort_order: string;
  rejection_reason: string;
}

const BLANK: FormState = {
  id: null,
  kind: "demo",
  status: "active",
  title: "",
  category: "other",
  presentation_url: "",
  summary: "",
  hero_image_url: "",
  address: "",
  city: "",
  region: "",
  country: "US",
  latitude: "",
  longitude: "",
  tags: "",
  sort_order: "0",
  rejection_reason: "",
};

const DRAFT_KEY = "3dps:atlas:form-draft";

function loadDraft(): FormState {
  if (typeof window === "undefined") return BLANK;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return BLANK;
    return { ...BLANK, ...(JSON.parse(raw) as Partial<FormState>) };
  } catch {
    return BLANK;
  }
}
function saveDraft(state: FormState) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state)); } catch { /* */ }
}
function clearDraft() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
}

const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const labelCls = "text-xs font-medium text-muted-foreground";

const TABS: Array<{ key: string; label: string; filter: (r: AtlasEntry) => boolean }> = [
  { key: "all", label: "All", filter: () => true },
  { key: "pending", label: "Pending review", filter: (r) => r.status === "pending_review" },
  { key: "demo", label: "Demo", filter: (r) => r.kind === "demo" },
  { key: "client", label: "Client", filter: (r) => r.kind === "client_submitted" },
  { key: "curated", label: "Curated", filter: (r) => r.kind === "curated_showcase" },
  { key: "inactive", label: "Inactive", filter: (r) => r.status === "inactive" },
  { key: "rejected", label: "Rejected", filter: (r) => r.status === "rejected" },
];

function AdminAtlas() {
  const { roles, isLoading: authLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<AtlasEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => loadDraft());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await sbAny
      .from("atlas_entries")
      .select("*")
      .order("status", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setRows([]); }
    else setRows((data ?? []) as AtlasEntry[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) void load();
    else setLoading(false);
  }, [authLoading, isAdmin, load]);

  useEffect(() => { saveDraft(form); }, [form]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const editing = form.id !== null;
  const resetForm = () => { setForm(BLANK); clearDraft(); };

  const startNew = () =>
    setForm({ ...BLANK, sort_order: String(rows.length) });

  const startEdit = (r: AtlasEntry) =>
    setForm({
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: r.title,
      category: r.category,
      presentation_url: r.presentation_url ?? "",
      summary: r.summary ?? "",
      hero_image_url: r.hero_image_url ?? "",
      address: r.address ?? "",
      city: r.city ?? "",
      region: r.region ?? "",
      country: r.country ?? "US",
      latitude: r.latitude != null ? String(r.latitude) : "",
      longitude: r.longitude != null ? String(r.longitude) : "",
      tags: (r.tags ?? []).join(", "),
      sort_order: String(r.sort_order),
      rejection_reason: r.rejection_reason ?? "",
    });

  const save = async () => {
    const num = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    // Validate shared input
    const parsed = atlasEntryInput.safeParse({
      title: form.title,
      summary: form.summary,
      category: form.category,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      hero_image_url: form.hero_image_url,
      presentation_url: form.presentation_url,
      address: form.address,
      city: form.city,
      region: form.region,
      country: form.country,
      latitude: num(form.latitude),
      longitude: num(form.longitude),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path?.join(".") ?? "field";
      toast.error(`${field}: ${issue?.message ?? "Validation failed"}`);
      return;
    }
    if (form.status === "rejected" && !form.rejection_reason.trim()) {
      toast.error("Rejection reason is required when status is rejected.");
      return;
    }

    const payload = {
      ...parsed.data,
      kind: form.kind,
      status: form.status,
      sort_order: parseInt(form.sort_order, 10) || 0,
      rejection_reason:
        form.status === "rejected" ? form.rejection_reason.trim() : null,
    };

    setSaving(true);
    const res = editing
      ? await sbAny.from("atlas_entries").update(payload).eq("id", form.id)
      : await sbAny.from("atlas_entries").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(`Save failed: ${res.error.message}`); return; }
    toast.success(editing ? "Listing updated." : "Listing created.");
    resetForm();
    await load();
  };

  const approve = async (r: AtlasEntry) => {
    const { error: err } = await sbAny
      .from("atlas_entries")
      .update({
        status: "active",
        reviewed_at: new Date().toISOString(),
        rejection_reason: null,
      })
      .eq("id", r.id);
    if (err) toast.error(`Approve failed: ${err.message}`);
    else { toast.success(`Approved “${r.title}”.`); await load(); }
  };

  const reject = async (r: AtlasEntry) => {
    const reason = typeof window !== "undefined"
      ? window.prompt("Rejection reason (visible to the owner):", r.rejection_reason ?? "")
      : null;
    if (!reason || !reason.trim()) return;
    const { error: err } = await sbAny
      .from("atlas_entries")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason.trim(),
      })
      .eq("id", r.id);
    if (err) toast.error(`Reject failed: ${err.message}`);
    else { toast.success("Listing rejected."); await load(); }
  };

  const toggleActive = async (r: AtlasEntry) => {
    const next: AtlasEntryStatus = r.status === "active" ? "inactive" : "active";
    const { error: err } = await sbAny
      .from("atlas_entries")
      .update({
        status: next,
        reviewed_at: next === "active" ? new Date().toISOString() : null,
      })
      .eq("id", r.id);
    if (err) toast.error(`Update failed: ${err.message}`);
    else await load();
  };

  const remove = async (r: AtlasEntry) => {
    if (typeof window !== "undefined" &&
      !window.confirm(`Delete “${r.title}”? This cannot be undone.`)) return;
    const { error: err } = await sbAny.from("atlas_entries").delete().eq("id", r.id);
    if (err) toast.error(`Delete failed: ${err.message}`);
    else { toast.success("Listing deleted."); if (form.id === r.id) resetForm(); await load(); }
  };

  const visible = useMemo(() => {
    const fn = TABS.find((t) => t.key === tab)?.filter ?? (() => true);
    return rows.filter(fn);
  }, [rows, tab]);

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
            <MapPinned className="size-6 text-primary" /> Atlas Listings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Manage the public Frontiers|3D{" "}
            <Link to="/atlas" className="text-primary hover:underline">/atlas</Link>{" "}
            map. Approve client submissions and curate Frontiers|3D demo entries.
            Only <strong>active</strong> listings appear publicly.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/atlas-curation"><Wand2 className="mr-1 size-4" /> Curation assistant</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={startNew}>
            <Plus className="mr-1 size-4" /> New listing
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2">
        {TABS.map((t) => {
          const count = rows.filter(t.filter).length;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {t.label} <span className="opacity-60">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{editing ? "Edit listing" : "New listing"}</h2>
          {editing && (
            <button
              onClick={resetForm}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" /> Cancel edit
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="lg:col-span-1">
            <span className={labelCls}>Title *</span>
            <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="The Greenhouse Café" />
          </label>
          <label>
            <span className={labelCls}>Kind</span>
            <select className={inputCls} value={form.kind} onChange={(e) => set("kind", e.target.value as AtlasEntryKind)}>
              <option value="demo">Demo (Frontiers|3D-owned)</option>
              <option value="client_submitted">Client-submitted</option>
              <option value="curated_showcase">Curated showcase</option>
            </select>
          </label>
          <label>
            <span className={labelCls}>Status</span>
            <select className={inputCls} value={form.status} onChange={(e) => set("status", e.target.value as AtlasEntryStatus)}>
              <option value="pending_review">Pending review</option>
              <option value="active">Active (public)</option>
              <option value="inactive">Inactive</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>

          <label>
            <span className={labelCls}>Category</span>
            <select className={inputCls} value={form.category} onChange={(e) => set("category", e.target.value)}>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          </label>
          <label>
            <span className={labelCls}>Sort order</span>
            <input className={inputCls} type="number" value={form.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
          </label>

          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Presentation URL (https only)</span>
            <input className={inputCls} value={form.presentation_url} onChange={(e) => set("presentation_url", e.target.value)} placeholder="https://my.matterport.com/show/?m=…" />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Short summary</span>
            <textarea className={`${inputCls} min-h-[60px]`} value={form.summary} onChange={(e) => set("summary", e.target.value)} />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Hero image URL (optional, https only)</span>
            <input className={inputCls} value={form.hero_image_url} onChange={(e) => set("hero_image_url", e.target.value)} />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Address</span>
            <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>City</span>
            <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>Region / State</span>
            <input className={inputCls} value={form.region} onChange={(e) => set("region", e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>Country (ISO-2)</span>
            <input
              className={inputCls}
              value={form.country}
              maxLength={2}
              placeholder="US"
              onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))}
            />
          </label>
          <label>
            <span className={labelCls}>Latitude</span>
            <input className={inputCls} value={form.latitude} onChange={(e) => set("latitude", e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>Longitude</span>
            <input className={inputCls} value={form.longitude} onChange={(e) => set("longitude", e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>Tags (comma-separated)</span>
            <input className={inputCls} value={form.tags} onChange={(e) => set("tags", e.target.value)} />
          </label>
          {form.status === "rejected" && (
            <label className="sm:col-span-2 lg:col-span-3">
              <span className={labelCls}>Rejection reason *</span>
              <input className={inputCls} value={form.rejection_reason} onChange={(e) => set("rejection_reason", e.target.value)} />
            </label>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing && <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>}
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update listing" : "Create listing"}
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Couldn't load listings</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-12 text-center text-muted-foreground">
          No listings in this view.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Presentation</th>
                <th className="px-3 py-2">Submitted</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.id} className="border-t border-border align-top hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">{r.sort_order}</td>
                  <td className="px-3 py-2 font-medium text-foreground">{r.title}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {r.kind === "demo" ? "Demo" : r.kind === "curated_showcase" ? "Curated" : "Client"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {[r.city, r.region].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.presentation_url ? (
                      <a href={r.presentation_url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 text-primary hover:underline">
                        open <ExternalLink className="size-3.5" />
                      </a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      {r.status !== "active" && (
                        <Button size="sm" variant="outline" onClick={() => approve(r)} title="Approve & make public">
                          <CheckCircle2 className="mr-1 size-3.5" /> Approve
                        </Button>
                      )}
                      {r.status !== "rejected" && r.kind === "client_submitted" && (
                        <Button size="sm" variant="outline" onClick={() => reject(r)} title="Reject submission">
                          <XCircle className="mr-1 size-3.5" /> Reject
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => toggleActive(r)}
                        title={r.status === "active" ? "Hide from /atlas" : "Show on /atlas"}>
                        {r.status === "active" ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                        <Pencil className="mr-1 size-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remove(r)} className="text-destructive">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: AtlasEntryStatus }) {
  const map: Record<AtlasEntryStatus, { label: string; cls: string }> = {
    active:         { label: "active",         cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
    pending_review: { label: "pending review", cls: "bg-amber-100   text-amber-900   dark:bg-amber-500/15   dark:text-amber-200" },
    inactive:       { label: "inactive",       cls: "bg-zinc-200    text-zinc-700    dark:bg-zinc-700/40    dark:text-zinc-200" },
    rejected:       { label: "rejected",       cls: "bg-rose-100    text-rose-900    dark:bg-rose-500/15    dark:text-rose-200" },
  };
  const { label, cls } = map[status];
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
