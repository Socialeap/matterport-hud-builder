import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  RefreshCw, ShieldAlert, Plus, Pencil, Trash2, Eye, EyeOff, ExternalLink, MapPinned, X,
} from "lucide-react";
import { CATEGORY_OPTIONS, categoryLabel, type AtlasDemoListing } from "@/lib/atlas-demo-data";

export const Route = createFileRoute("/_authenticated/admin/atlas-demo")({
  component: AdminAtlasDemo,
});

// New table isn't in the generated Database types yet — cast (repo idiom).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sbAny = supabase as unknown as any;

interface FormState {
  id: string | null;
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
  is_active: boolean;
  sort_order: string;
}

const BLANK: FormState = {
  id: null, title: "", category: "cafe", presentation_url: "", summary: "",
  hero_image_url: "", address: "", city: "", region: "", country: "US",
  latitude: "", longitude: "", tags: "", is_active: true, sort_order: "0",
};

const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const labelCls = "text-xs font-medium text-muted-foreground";

function AdminAtlasDemo() {
  const { roles, isLoading: authLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const [rows, setRows] = useState<AtlasDemoListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await sbAny
      .from("atlas_demo_listings")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (err) { setError(err.message); setRows([]); }
    else setRows((data ?? []) as AtlasDemoListing[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) void load();
    else setLoading(false);
  }, [authLoading, isAdmin, load]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editing = form.id !== null;

  const startNew = () => setForm({ ...BLANK, sort_order: String(rows.length) });
  const startEdit = (r: AtlasDemoListing) => setForm({
    id: r.id, title: r.title, category: r.category, presentation_url: r.presentation_url ?? "",
    summary: r.summary ?? "", hero_image_url: r.hero_image_url ?? "", address: r.address ?? "",
    city: r.city ?? "", region: r.region ?? "", country: r.country ?? "US",
    latitude: r.latitude != null ? String(r.latitude) : "",
    longitude: r.longitude != null ? String(r.longitude) : "",
    tags: (r.tags ?? []).join(", "), is_active: r.is_active, sort_order: String(r.sort_order),
  });

  const save = async () => {
    if (!form.title.trim()) { toast.error("Title is required."); return; }
    const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : null; };
    const payload = {
      title: form.title.trim(),
      category: form.category,
      presentation_url: form.presentation_url.trim() || null,
      summary: form.summary.trim() || null,
      hero_image_url: form.hero_image_url.trim() || null,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      region: form.region.trim() || null,
      country: form.country.trim() || null,
      latitude: num(form.latitude),
      longitude: num(form.longitude),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      is_active: form.is_active,
      sort_order: parseInt(form.sort_order, 10) || 0,
    };
    setSaving(true);
    const res = editing
      ? await sbAny.from("atlas_demo_listings").update(payload).eq("id", form.id)
      : await sbAny.from("atlas_demo_listings").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(`Save failed: ${res.error.message}`); return; }
    toast.success(editing ? "Listing updated." : "Listing created.");
    setForm(BLANK);
    await load();
  };

  const remove = async (r: AtlasDemoListing) => {
    if (typeof window !== "undefined" && !window.confirm(`Delete “${r.title}”? This cannot be undone.`)) return;
    const { error: err } = await sbAny.from("atlas_demo_listings").delete().eq("id", r.id);
    if (err) toast.error(`Delete failed: ${err.message}`);
    else { toast.success("Listing deleted."); if (form.id === r.id) setForm(BLANK); await load(); }
  };

  const toggleActive = async (r: AtlasDemoListing) => {
    const { error: err } = await sbAny.from("atlas_demo_listings").update({ is_active: !r.is_active }).eq("id", r.id);
    if (err) toast.error(`Update failed: ${err.message}`);
    else await load();
  };

  if (!authLoading && !isAdmin) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-border bg-card p-8 text-center">
        <ShieldAlert className="mx-auto mb-3 size-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Admin access required</h2>
        <Button asChild variant="outline" size="sm" className="mt-4"><Link to="/dashboard">Back to Dashboard</Link></Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <MapPinned className="size-6 text-primary" />
            Atlas Demo Listings
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Curate the Frontiers3D-owned <strong>sample</strong> listings shown on the public{" "}
            <Link to="/atlas" className="text-primary hover:underline">/atlas</Link> demo. Each listing points at a hosted
            3D presentation URL. These are clearly framed as samples — never a prospect-specific preview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" onClick={startNew}><Plus className="mr-1 size-4" /> New listing</Button>
        </div>
      </div>

      {/* Create / edit form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{editing ? "Edit listing" : "New listing"}</h2>
          {editing && (
            <button onClick={() => setForm(BLANK)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <X className="size-3.5" /> Cancel edit
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="sm:col-span-2 lg:col-span-1">
            <span className={labelCls}>Name *</span>
            <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="The Greenhouse Café" />
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
            <span className={labelCls}>Presentation URL (hosted 3D tour)</span>
            <input className={inputCls} value={form.presentation_url} onChange={(e) => set("presentation_url", e.target.value)} placeholder="https://my.matterport.com/show/?m=…" />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Short summary</span>
            <textarea className={`${inputCls} min-h-[60px]`} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="A plant-filled corner café — see the light, the layout, and the patio before you pick your table." />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Hero image URL (optional)</span>
            <input className={inputCls} value={form.hero_image_url} onChange={(e) => set("hero_image_url", e.target.value)} placeholder="https://…/photo.jpg" />
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Address</span>
            <input className={inputCls} value={form.address} onChange={(e) => set("address", e.target.value)} placeholder="123 Main St" />
          </label>
          <label>
            <span className={labelCls}>City</span>
            <input className={inputCls} value={form.city} onChange={(e) => set("city", e.target.value)} placeholder="Austin" />
          </label>
          <label>
            <span className={labelCls}>Region / State</span>
            <input className={inputCls} value={form.region} onChange={(e) => set("region", e.target.value)} placeholder="TX" />
          </label>
          <label>
            <span className={labelCls}>Country</span>
            <input className={inputCls} value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="US" />
          </label>
          <label>
            <span className={labelCls}>Latitude</span>
            <input className={inputCls} value={form.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="30.2672" />
          </label>
          <label>
            <span className={labelCls}>Longitude</span>
            <input className={inputCls} value={form.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="-97.7431" />
          </label>
          <label>
            <span className={labelCls}>Tags (comma-separated)</span>
            <input className={inputCls} value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="coffee, patio, brunch" />
          </label>
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set("is_active", e.target.checked)} />
            <span className="text-sm">Active (visible on /atlas)</span>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {editing && <Button variant="outline" size="sm" onClick={() => setForm(BLANK)}>Cancel</Button>}
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : editing ? "Update listing" : "Create listing"}
          </Button>
        </div>
      </div>

      {/* Existing listings */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Couldn’t load listings</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            If this says the relation does not exist, apply the <code>atlas_demo_listings</code> migration first
            (see BACKEND_ACTIVATION.md).
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-12 text-center text-muted-foreground">
          No demo listings yet. Click <strong>New listing</strong> to add the first Frontiers3D sample space.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Location</th>
                <th className="px-3 py-2 text-left">Category</th>
                <th className="px-3 py-2 text-left">Presentation</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top hover:bg-muted/30">
                  <td className="px-3 py-2 text-muted-foreground">{r.sort_order}</td>
                  <td className="px-3 py-2 font-medium text-foreground">{r.title}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {[r.city, r.region].filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{categoryLabel(r.category)}</td>
                  <td className="px-3 py-2">
                    {r.presentation_url ? (
                      <a href={r.presentation_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                        open <ExternalLink className="size-3.5" />
                      </a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${r.is_active ? "bg-green-100 text-green-900" : "bg-zinc-200 text-zinc-700"}`}>
                      {r.is_active ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => toggleActive(r)} title={r.is_active ? "Hide from /atlas" : "Show on /atlas"}>
                        {r.is_active ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => startEdit(r)}><Pencil className="mr-1 size-3.5" /> Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => remove(r)} className="text-destructive"><Trash2 className="size-3.5" /></Button>
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
