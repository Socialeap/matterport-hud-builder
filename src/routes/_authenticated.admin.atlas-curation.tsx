import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  ShieldAlert,
  ShieldCheck,
  Plus,
  RefreshCw,
  MapPinned,
  Wand2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  MapPin,
  CheckCircle2,
  Globe2,
  ArrowLeft,
  Package,
  Download,
  Rocket,
  Clock,
  Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  CATEGORY_OPTIONS,
  categoryLabel,
  type AtlasCurationJob,
  type AtlasCurationStatus,
  type AtlasCurationDraft,
} from "@/lib/atlas-demo-data";
import { extractMatterportId } from "@/lib/matterport-mhtml";
import {
  listCurationJobs,
  createCurationJob,
  selectCurationCandidate,
  updateCurationJob,
  createAtlasEntryFromJob,
  deleteCurationJob,
  generateCuratedPackage,
  publishCuratedShowcase,
  mergeAndPublishShowcase,
  markShowcaseDeployed,
  publishShowcasesRootIndexPr,
} from "@/lib/atlas-curation.functions";

export const Route = createFileRoute("/_authenticated/admin/atlas-curation")({
  component: AdminAtlasCuration,
});

const inputCls = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";
const labelCls = "text-xs font-medium text-muted-foreground";

const MATTERPORT_ID_RE = /^[A-Za-z0-9]{11}$/;

type DraftForm = {
  title: string;
  category: string;
  summary: string;
  tags: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
  hero_image_url: string;
};

function draftToForm(d: AtlasCurationDraft | null): DraftForm {
  return {
    title: d?.title ?? "",
    category: d?.category ?? "other",
    summary: d?.summary ?? "",
    tags: (d?.tags ?? []).join(", "),
    address: d?.address ?? "",
    city: d?.city ?? "",
    region: d?.region ?? "",
    country: d?.country ?? "US",
    latitude: d?.latitude != null ? String(d.latitude) : "",
    longitude: d?.longitude != null ? String(d.longitude) : "",
    hero_image_url: d?.hero_image_url ?? "",
  };
}

const CREATE_FORM_KEY = "atlas-curation:create-form:v1";
const DRAFT_FORM_KEY_PREFIX = "atlas-curation:draft-form:v1:";
type CreateFormState = {
  matterportUrl: string; name: string; address: string; city: string;
  region: string; country: string; category: string; rightsNote: string;
  rightsAck: boolean;
  summary: string; latitude: string; longitude: string;
};
const EMPTY_CREATE_FORM: CreateFormState = {
  matterportUrl: "", name: "", address: "", city: "",
  region: "", country: "US", category: "", rightsNote: "", rightsAck: false,
  summary: "", latitude: "", longitude: "",
};
function loadPersistedCreateForm(): CreateFormState {
  if (typeof window === "undefined") return EMPTY_CREATE_FORM;
  try {
    const raw = window.localStorage.getItem(CREATE_FORM_KEY);
    if (!raw) return EMPTY_CREATE_FORM;
    return { ...EMPTY_CREATE_FORM, ...(JSON.parse(raw) as Partial<CreateFormState>) };
  } catch { return EMPTY_CREATE_FORM; }
}

function statusBadge(status: AtlasCurationStatus) {
  const map: Record<AtlasCurationStatus, { label: string; cls: string }> = {
    draft: { label: "draft", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700/40 dark:text-zinc-200" },
    needs_selection: { label: "needs place selection", cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200" },
    ready_for_review: { label: "ready for review", cls: "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-200" },
    blocked: { label: "blocked", cls: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200" },
    atlas_entry_created: { label: "atlas entry created", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200" },
    rejected: { label: "rejected", cls: "bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200" },
  };
  const { label, cls } = map[status];
  return <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

/** Trigger a browser download of a base64-encoded zip. */
function downloadZip(base64: string, filename: string) {
  if (typeof document === "undefined") return;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function AdminAtlasCuration() {
  const { roles, isLoading: authLoading } = useAuth();
  const isAdmin = roles.includes("admin");

  const list = useServerFn(listCurationJobs);
  const create = useServerFn(createCurationJob);
  const selectCandidate = useServerFn(selectCurationCandidate);
  const update = useServerFn(updateCurationJob);
  const createEntry = useServerFn(createAtlasEntryFromJob);
  const removeJob = useServerFn(deleteCurationJob);
  const genPackage = useServerFn(generateCuratedPackage);
  const pubShowcase = useServerFn(publishCuratedShowcase);
  const mergeDeploy = useServerFn(mergeAndPublishShowcase);
  const markDeployed = useServerFn(markShowcaseDeployed);
  const publishRootIndex = useServerFn(publishShowcasesRootIndexPr);
  const [publishingRootIndex, setPublishingRootIndex] = useState(false);

  const onPublishRootIndex = async () => {
    setPublishingRootIndex(true);
    try {
      const res = await publishRootIndex();
      if (res.alreadyExists) {
        toast.info("Root index.html already exists on the showcases repo.");
      } else if (res.prUrl) {
        toast.success("Opened PR to add root landing page.");
        if (typeof window !== "undefined") window.open(res.prUrl, "_blank", "noopener");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to open root index PR.");
    } finally {
      setPublishingRootIndex(false);
    }
  };

  const [jobs, setJobs] = useState<AtlasCurationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reviewPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedId) return;
    const id = requestAnimationFrame(() => {
      reviewPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId]);

  // Create form (persisted to localStorage so navigating away or refreshing
  // does not wipe in-progress input).
  const initialCreate = useMemo(loadPersistedCreateForm, []);
  const [matterportUrl, setMatterportUrl] = useState(initialCreate.matterportUrl);
  const [name, setName] = useState(initialCreate.name);
  const [address, setAddress] = useState(initialCreate.address);
  const [city, setCity] = useState(initialCreate.city);
  const [region, setRegion] = useState(initialCreate.region);
  const [country, setCountry] = useState(initialCreate.country);
  const [category, setCategory] = useState(initialCreate.category);
  const [rightsNote, setRightsNote] = useState(initialCreate.rightsNote);
  const [rightsAck, setRightsAck] = useState(initialCreate.rightsAck);
  const [summary, setSummary] = useState(initialCreate.summary);
  const [latitude, setLatitude] = useState(initialCreate.latitude);
  const [longitude, setLongitude] = useState(initialCreate.longitude);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(CREATE_FORM_KEY, JSON.stringify({
        matterportUrl, name, address, city, region, country, category, rightsNote, rightsAck,
        summary, latitude, longitude,
      }));
    } catch { /* ignore quota errors */ }
  }, [matterportUrl, name, address, city, region, country, category, rightsNote, rightsAck, summary, latitude, longitude]);

  // Review/edit form (mirrors the selected job's draft)
  const [draft, setDraft] = useState<DraftForm>(() => draftToForm(null));

  const extractedId = useMemo(() => extractMatterportId(matterportUrl), [matterportUrl]);
  const matterportValid = MATTERPORT_ID_RE.test(extractedId);

  const selected = useMemo(
    () => jobs.find((j) => j.id === selectedId) ?? null,
    [jobs, selectedId],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { jobs: rows } = await list();
      setJobs(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load curation jobs.");
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [list]);

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) void load();
    else setLoading(false);
  }, [authLoading, isAdmin, load]);

  // Sync the editable draft when the selected job changes. If the user has
  // unsaved edits in localStorage for this job, restore those instead of
  // resetting to the server payload.
  useEffect(() => {
    if (!selectedId) {
      setDraft(draftToForm(null));
      return;
    }
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(DRAFT_FORM_KEY_PREFIX + selectedId);
        if (raw) {
          setDraft({ ...draftToForm(selected?.draft_payload ?? null), ...(JSON.parse(raw) as Partial<DraftForm>) });
          return;
        }
      } catch { /* ignore */ }
    }
    setDraft(draftToForm(selected?.draft_payload ?? null));
  }, [selectedId, selected?.draft_payload]);

  // Persist in-progress draft edits per job id.
  useEffect(() => {
    if (!selectedId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(DRAFT_FORM_KEY_PREFIX + selectedId, JSON.stringify(draft));
    } catch { /* ignore */ }
  }, [selectedId, draft]);

  const resetCreate = () => {
    setMatterportUrl(""); setName(""); setAddress(""); setCity("");
    setRegion(""); setCountry("US"); setCategory(""); setRightsNote(""); setRightsAck(false);
    if (typeof window !== "undefined") {
      try { window.localStorage.removeItem(CREATE_FORM_KEY); } catch { /* ignore */ }
    }
  };

  const handleCreate = async () => {
    if (!matterportValid) {
      toast.error("Enter a valid Matterport URL or 11-character model ID.");
      return;
    }
    if (!name.trim() && !address.trim() && !city.trim()) {
      toast.error("Provide a name, address, or city so the place can be resolved.");
      return;
    }
    if (!rightsAck) {
      toast.error("Confirm you have legitimate access/permission before curating this listing.");
      return;
    }
    setBusy(true);
    try {
      const { job } = await create({
        data: {
          input_matterport_url: matterportUrl.trim(),
          input_name: name.trim(),
          input_address: address.trim(),
          input_city: city.trim(),
          input_region: region.trim(),
          input_country: country.trim(),
          input_category: category.trim(),
          rights_note: rightsNote.trim(),
        },
      });
      toast.success(
        job.status === "needs_selection"
          ? "Job created — multiple places found, select one below."
          : job.status === "blocked"
            ? "Job created — coordinates needed before a map pin."
            : "Curation job created and enriched.",
      );
      setJobs((prev) => [job, ...prev]);
      setSelectedId(job.id);
      resetCreate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create job.");
    } finally {
      setBusy(false);
    }
  };

  const replaceJob = (job: AtlasCurationJob) =>
    setJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));

  const handleSelectCandidate = async (placeId: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const { job } = await selectCandidate({ data: { jobId: selected.id, placeId } });
      replaceJob(job);
      toast.success("Place selected and details resolved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Selection failed.");
    } finally {
      setBusy(false);
    }
  };

  const parsedDraft = (): AtlasCurationDraft => {
    const numOrNull = (s: string) => {
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    return {
      title: draft.title.trim(),
      category: draft.category.trim() || "other",
      summary: draft.summary.trim(),
      tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
      address: draft.address.trim(),
      city: draft.city.trim(),
      region: draft.region.trim(),
      country: (draft.country.trim() || "US").toUpperCase().slice(0, 2),
      latitude: numOrNull(draft.latitude),
      longitude: numOrNull(draft.longitude),
      hero_image_url: draft.hero_image_url.trim(),
    };
  };

  const saveDraft = async (status?: AtlasCurationStatus) => {
    if (!selected) return;
    const d = parsedDraft();
    if (d.latitude != null && (d.latitude < -90 || d.latitude > 90)) {
      toast.error("Latitude must be between -90 and 90."); return;
    }
    if (d.longitude != null && (d.longitude < -180 || d.longitude > 180)) {
      toast.error("Longitude must be between -180 and 180."); return;
    }
    setBusy(true);
    try {
      const { job } = await update({
        data: {
          jobId: selected.id,
          draft: d,
          ...(status && (status === "draft" || status === "needs_selection" || status === "ready_for_review" || status === "blocked" || status === "rejected")
            ? { status }
            : {}),
        },
      });
      replaceJob(job);
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem(DRAFT_FORM_KEY_PREFIX + selected.id); } catch { /* ignore */ }
      }
      toast.success(status === "ready_for_review" ? "Saved — ready for review." : "Draft saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { job } = await update({ data: { jobId: selected.id, status: "rejected" } });
      replaceJob(job);
      toast.success("Job rejected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reject failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateEntry = async () => {
    if (!selected) return;
    const d = parsedDraft();
    if (!d.title || !d.category) {
      toast.error("Add a title and category before creating an Atlas entry.");
      return;
    }
    setBusy(true);
    try {
      // Persist any edits first, then create the inactive entry.
      const saved = await update({ data: { jobId: selected.id, draft: d } });
      replaceJob(saved.job);
      const { job } = await createEntry({ data: { jobId: selected.id } });
      replaceJob(job);
      toast.success("Inactive curated Atlas entry created. Activate it in Atlas Listings when ready.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create Atlas entry.");
    } finally {
      setBusy(false);
    }
  };

  const handleGeneratePackage = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await genPackage({ data: { jobId: selected.id } });
      replaceJob(res.job);
      downloadZip(res.zipBase64, res.filename);
      toast.success(`Package built (${(res.sizeBytes / 1024).toFixed(1)} KB) and downloaded.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Package build failed.");
    } finally {
      setBusy(false);
    }
  };

  const handlePublishShowcase = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await pubShowcase({ data: { jobId: selected.id } });
      replaceJob(res.job);
      toast.success("Showcase PR opened. Merge it, then mark it deployed to attach the URL.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleMergeAndDeploy = async () => {
    if (!selected) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Approve & Publish this showcase?\n\nThis merges the open showcase PR in the showcases repo via the GitHub API, waits for Netlify to deploy, then attaches the live URL to the listing. The Atlas listing stays INACTIVE — you still activate it separately in Atlas Listings.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await mergeDeploy({ data: { jobId: selected.id } });
      replaceJob(res.job);
      if (res.status === "published") {
        toast.success(
          "Merged, deployed & URL attached. Listing is still inactive — activate it in Atlas Listings when ready.",
        );
      } else {
        toast.info(
          "PR merged. Netlify is still deploying — re-run “Approve & Publish” in a moment to finish attaching the URL.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Merge & deploy failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleMarkDeployed = async (url?: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await markDeployed({ data: { jobId: selected.id, ...(url ? { url } : {}) } });
      replaceJob(res.job);
      toast.success("Deployed URL attached to the listing (still inactive — activate it in Atlas Listings).");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't attach the deployed URL.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (job: AtlasCurationJob) => {
    if (typeof window !== "undefined" && !window.confirm("Delete this curation job? This cannot be undone.")) return;
    setBusy(true);
    try {
      await removeJob({ data: { jobId: job.id } });
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (selectedId === job.id) setSelectedId(null);
      if (typeof window !== "undefined") {
        try { window.localStorage.removeItem(DRAFT_FORM_KEY_PREFIX + job.id); } catch { /* ignore */ }
      }
      toast.success("Curation job deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusy(false);
    }
  };

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

  const coordsMissing = !draft.latitude.trim() || !draft.longitude.trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Wand2 className="size-6 text-primary" /> Curated Atlas Listing Assistant
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Seed the public{" "}
            <Link to="/atlas" className="text-primary hover:underline">/atlas</Link>{" "}
            with curated showcase listings. Provide minimal inputs; the assistant
            extracts the Matterport ID, resolves the place, and drafts metadata for
            your review. Entries are created <strong>inactive</strong> and{" "}
            <strong>unclaimed</strong> — they never go public until you activate them in{" "}
            <Link to="/admin/atlas" className="text-primary hover:underline">Atlas Listings</Link>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/admin/atlas"><ArrowLeft className="mr-1 size-4" /> Atlas Listings</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1 size-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onPublishRootIndex()}
            disabled={publishingRootIndex}
            title="Open a PR adding /index.html so the bare showcases site URL is not a 404."
          >
            <Globe2 className={`mr-1 size-4 ${publishingRootIndex ? "animate-spin" : ""}`} /> Publish root index
          </Button>
        </div>
      </div>

      {/* Rights / safety reminder */}
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200/90">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Curate responsibly</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>Only curate spaces where Frontiers3D has legitimate access to the Matterport tour or permission to build a presentation.</li>
            <li>Curated listings are <strong>not official business listings</strong> until claimed or approved by the business — they are labelled “Curated showcase” and “Unclaimed”.</li>
            <li>Businesses must have a path to claim, correct, or request removal later.</li>
          </ul>
        </div>
      </div>

      {/* Create form */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">New curated listing job</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Matterport URL or model ID *</span>
            <input className={inputCls} value={matterportUrl} onChange={(e) => setMatterportUrl(e.target.value)} placeholder="https://my.matterport.com/show/?m=XXXXXXXXXXX" />
            {matterportUrl.trim() && (
              <span className={`mt-1 block text-[11px] ${matterportValid ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                {matterportValid ? `Model ID: ${extractedId}` : "No valid 11-character Matterport model ID found in this input."}
              </span>
            )}
          </label>
          <label className="lg:col-span-1">
            <span className={labelCls}>Business / space name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="The Greenhouse Gallery" />
          </label>
          <label className="sm:col-span-2 lg:col-span-2">
            <span className={labelCls}>Street address / location</span>
            <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Springfield" />
          </label>
          <label>
            <span className={labelCls}>City</span>
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </label>
          <label>
            <span className={labelCls}>Region / State</span>
            <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="CA" />
          </label>
          <label>
            <span className={labelCls}>Country (ISO-2)</span>
            <input className={inputCls} value={country} maxLength={2} onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))} />
          </label>
          <label>
            <span className={labelCls}>Category override (optional)</span>
            <select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Auto-detect</option>
              {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
            </select>
          </label>
          <label className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Rights / access note (optional)</span>
            <input className={inputCls} value={rightsNote} onChange={(e) => setRightsNote(e.target.value)} placeholder="e.g. Public Matterport tour; building permission on file." />
          </label>
        </div>
        <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" className="mt-0.5" checked={rightsAck} onChange={(e) => setRightsAck(e.target.checked)} />
          <span>I confirm Frontiers3D has legitimate access to this Matterport tour or permission to build a presentation, and that this will be a <strong>curated, unclaimed</strong> listing (not an official/partner listing).</span>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={resetCreate} disabled={busy}>Clear</Button>
          <Button size="sm" onClick={() => void handleCreate()} disabled={busy || !matterportValid || !rightsAck}>
            <Plus className="mr-1 size-4" /> {busy ? "Working…" : "Create & enrich"}
          </Button>
        </div>
      </div>

      {/* Review panel */}
      {selected && (
        <div ref={reviewPanelRef} id="curation-review-panel" style={{ scrollMarginTop: "5rem" }}>
          <JobReviewPanel
            job={selected}
            draft={draft}
            setDraft={setDraft}
            coordsMissing={coordsMissing}
            busy={busy}
            onSelectCandidate={handleSelectCandidate}
            onSaveDraft={() => void saveDraft()}
            onMarkReady={() => void saveDraft("ready_for_review")}
            onCreateEntry={() => void handleCreateEntry()}
            onGeneratePackage={() => void handleGeneratePackage()}
            onPublishShowcase={() => void handlePublishShowcase()}
            onMergeAndDeploy={() => void handleMergeAndDeploy()}
            onMarkDeployed={(url) => void handleMarkDeployed(url)}
            onReject={() => void handleReject()}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      {/* Jobs table */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Couldn't load curation jobs</p>
          <p className="mt-1 text-muted-foreground">{error}</p>
        </div>
      ) : jobs.length === 0 ? (
        <div className="rounded-md border border-border bg-card px-3 py-12 text-center text-muted-foreground">
          No curation jobs yet. Start one above.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2">Name / title</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Matterport</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2">Coords</th>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr
                  key={j.id}
                  className={`border-t border-border align-top hover:bg-muted/30 ${selectedId === j.id ? "bg-muted/40" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {j.drafted_title || j.input_name || "(untitled)"}
                  </td>
                  <td className="px-3 py-2">{statusBadge(j.status)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{j.extracted_matterport_id ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {[j.draft_payload?.city, j.draft_payload?.region].filter(Boolean).join(", ") || j.input_address || "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {j.latitude != null && j.longitude != null ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><MapPin className="size-3.5" /> yes</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" /> needed</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(j.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setSelectedId(j.id)}>Review</Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => void handleDelete(j)} disabled={busy}>
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

function JobReviewPanel({
  job, draft, setDraft, coordsMissing, busy,
  onSelectCandidate, onSaveDraft, onMarkReady, onCreateEntry, onGeneratePackage,
  onPublishShowcase, onMergeAndDeploy, onMarkDeployed, onReject, onClose,
}: {
  job: AtlasCurationJob;
  draft: DraftForm;
  setDraft: React.Dispatch<React.SetStateAction<DraftForm>>;
  coordsMissing: boolean;
  busy: boolean;
  onSelectCandidate: (placeId: string) => void;
  onSaveDraft: () => void;
  onMarkReady: () => void;
  onCreateEntry: () => void;
  onGeneratePackage: () => void;
  onPublishShowcase: () => void;
  onMergeAndDeploy: () => void;
  onMarkDeployed: (url?: string) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const set = <K extends keyof DraftForm>(k: K, v: DraftForm[K]) =>
    setDraft((f) => ({ ...f, [k]: v }));
  const created = job.status === "atlas_entry_created";
  const canBuild = !!draft.title.trim() && /^[A-Za-z0-9]{11}$/.test(job.extracted_matterport_id ?? "");
  const buildStatus = job.build_status ?? "none";
  const publishStatus = job.publish_status ?? "none";
  const hasEntry = !!job.atlas_entry_id;
  const [manualUrl, setManualUrl] = useState("");
  const confidenceLabel =
    job.geocode_confidence === "google_places" ? "Google Places (precise)"
    : job.geocode_confidence === "city_level" ? "City-level (approximate — refine for a precise pin)"
    : job.geocode_confidence === "manual" ? "Manual"
    : "Not resolved";

  return (
    <div className="rounded-lg border-2 border-primary/40 bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MapPinned className="size-5 text-primary" /> Review curated job
          {statusBadge(job.status)}
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {/* Public-label disclosure */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 px-2 py-0.5 text-indigo-700 dark:text-indigo-300"><Globe2 className="size-3.5" /> Curated by Frontiers3D</span>
        <span className="inline-flex items-center gap-1 rounded bg-zinc-500/10 px-2 py-0.5">Curated showcase</span>
        <span className="inline-flex items-center gap-1 rounded bg-zinc-500/10 px-2 py-0.5">Unclaimed · Claimable</span>
        <span>Created entries are <strong>inactive</strong> until you activate them.</span>
      </div>

      {job.error_message && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-900 dark:text-amber-200/90">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {job.error_message}
        </div>
      )}

      {/* Multi-match candidate selection */}
      {job.status === "needs_selection" && job.place_candidates.length > 0 && (
        <div className="mb-4 rounded-md border border-border bg-muted/20 p-3">
          <p className="mb-2 text-xs font-medium text-foreground">Multiple places matched — select the correct one:</p>
          <ul className="space-y-2">
            {job.place_candidates.map((c) => (
              <li key={c.place_id} className="flex items-center justify-between gap-3 rounded border border-border bg-background p-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.formatted_address}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onSelectCandidate(c.place_id)} disabled={busy}>Use this place</Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Resolved meta */}
      <div className="mb-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="font-medium text-foreground">Matterport ID:</span> <span className="font-mono">{job.extracted_matterport_id ?? "—"}</span></div>
        <div><span className="font-medium text-foreground">Coordinates:</span> {confidenceLabel}</div>
        <div className="truncate"><span className="font-medium text-foreground">Place ID:</span> {job.google_place_id ?? "—"}</div>
        <div className="truncate">
          <span className="font-medium text-foreground">Website:</span>{" "}
          {job.website_url ? <a href={job.website_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">link <ExternalLink className="inline size-3" /></a> : "—"}
        </div>
      </div>

      {coordsMissing && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs text-amber-900 dark:text-amber-200/90">
          <AlertTriangle className="size-4 shrink-0" /> Coordinates needed before map pin. Enter latitude/longitude below, or fix the address and re-resolve.
        </div>
      )}

      {/* Editable draft */}
      <fieldset disabled={created} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="lg:col-span-1">
          <span className={labelCls}>Title *</span>
          <input className={inputCls} value={draft.title} onChange={(e) => set("title", e.target.value)} />
        </label>
        <label>
          <span className={labelCls}>Category</span>
          <select className={inputCls} value={draft.category} onChange={(e) => set("category", e.target.value)}>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
        </label>
        <label>
          <span className={labelCls}>Tags (comma-separated)</span>
          <input className={inputCls} value={draft.tags} onChange={(e) => set("tags", e.target.value)} />
        </label>
        <label className="sm:col-span-2 lg:col-span-3">
          <span className={labelCls}>Summary</span>
          <textarea className={`${inputCls} min-h-[60px]`} value={draft.summary} onChange={(e) => set("summary", e.target.value)} />
        </label>
        <label className="sm:col-span-2 lg:col-span-3">
          <span className={labelCls}>Address</span>
          <input className={inputCls} value={draft.address} onChange={(e) => set("address", e.target.value)} />
        </label>
        <label>
          <span className={labelCls}>City</span>
          <input className={inputCls} value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </label>
        <label>
          <span className={labelCls}>Region / State</span>
          <input className={inputCls} value={draft.region} onChange={(e) => set("region", e.target.value)} />
        </label>
        <label>
          <span className={labelCls}>Country (ISO-2)</span>
          <input className={inputCls} value={draft.country} maxLength={2} onChange={(e) => set("country", e.target.value.toUpperCase().slice(0, 2))} />
        </label>
        <label>
          <span className={labelCls}>Latitude</span>
          <input className={inputCls} value={draft.latitude} onChange={(e) => set("latitude", e.target.value)} placeholder="-90 to 90" />
        </label>
        <label>
          <span className={labelCls}>Longitude</span>
          <input className={inputCls} value={draft.longitude} onChange={(e) => set("longitude", e.target.value)} placeholder="-180 to 180" />
        </label>
        <label className="sm:col-span-2 lg:col-span-3">
          <span className={labelCls}>Hero image URL (optional, https)</span>
          <input className={inputCls} value={draft.hero_image_url} onChange={(e) => set("hero_image_url", e.target.value)} />
        </label>
      </fieldset>

      {/* Presentation package */}
      <div className="mt-4 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Package className="size-4 text-primary" /> Presentation package
            {buildStatus === "built" && (
              <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> built</span>
            )}
            {buildStatus === "failed" && (
              <span className="text-xs font-normal text-rose-600 dark:text-rose-400">build failed</span>
            )}
          </div>
          <Button size="sm" variant="outline" onClick={onGeneratePackage} disabled={busy || !canBuild}>
            {buildStatus === "built"
              ? <><Download className="mr-1 size-4" /> Re-generate &amp; download</>
              : <><Package className="mr-1 size-4" /> Generate Presentation Package</>}
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Builds a minimal Frontiers3D package (an <code>index.html</code> embedding the Matterport
          tour + <code>atlas-manifest.json</code>) from the Matterport ID and this draft, then
          downloads it. Publish it (e.g. via Netlify), then attach the live URL to the listing.
          Generating does not deploy or activate anything.
        </p>
        {!canBuild && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Needs a title and a valid 11-character Matterport model ID before building.
          </p>
        )}
        {buildStatus === "built" && job.package_filename && (
          <p className="mt-1 text-[11px] text-muted-foreground">
            Last build: <span className="font-mono">{job.package_filename}</span>
            {job.package_size_bytes ? ` · ${(job.package_size_bytes / 1024).toFixed(1)} KB` : ""}
            {job.built_at ? ` · ${new Date(job.built_at).toLocaleString()}` : ""}
          </p>
        )}
        {buildStatus === "failed" && job.build_error && (
          <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{job.build_error}</p>
        )}
      </div>

      {/* Publish to the Atlas showcases repo (GitHub PR → merge → Netlify) */}
      <div className="mt-3 rounded-md border border-border bg-muted/20 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Globe2 className="size-4 text-primary" /> Publish to Atlas showcases
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded text-[11px] font-normal text-muted-foreground hover:text-foreground"
                >
                  <Info className="size-3.5" /> Merge requirements
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 text-xs leading-relaxed">
                <p className="font-medium text-foreground">About “Approve &amp; Publish”</p>
                <p className="mt-1 text-muted-foreground">
                  Merges this showcase PR for you via the GitHub API using a server-only token
                  (Contents + Pull requests write) — no new secrets, and the token never reaches
                  the browser.
                </p>
                <p className="mt-2 text-muted-foreground">
                  It can only merge if the <code>frontiers3d-atlas-showcases</code> default branch
                  has <strong>no branch-protection rule</strong> requiring a review or status check.
                  If protection is on, GitHub returns 403/405 and you'll see a clear error — merge
                  that PR manually in GitHub, then click <strong>Mark deployed &amp; attach URL</strong>.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Either way, the Atlas listing stays <strong>inactive</strong> until you activate it
                  in Atlas Listings.
                </p>
              </PopoverContent>
            </Popover>
            {publishStatus === "pr_open" && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">PR open</span>}
            {publishStatus === "merged" && <span className="inline-flex items-center gap-1 text-xs font-normal text-sky-600 dark:text-sky-400"><Clock className="size-3.5" /> merged · deploying</span>}
            {publishStatus === "pending_deploy" && <span className="inline-flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400"><Clock className="size-3.5" /> awaiting deploy</span>}
            {publishStatus === "published" && <span className="inline-flex items-center gap-1 text-xs font-normal text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" /> published</span>}
            {publishStatus === "failed" && <span className="text-xs font-normal text-rose-600 dark:text-rose-400">failed</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={onPublishShowcase} disabled={busy || !canBuild}>
              <Globe2 className="mr-1 size-4" /> {publishStatus === "none" ? "Open showcase PR" : "Re-open showcase PR"}
            </Button>
            {(publishStatus === "pr_open" || publishStatus === "merged" || publishStatus === "pending_deploy") && (
              <Button
                size="sm"
                onClick={onMergeAndDeploy}
                disabled={busy || !hasEntry || !job.showcase_pr_url}
                title="Merge the showcase PR via the GitHub API, wait for Netlify, then attach the live URL. Keeps the listing inactive."
              >
                <Rocket className="mr-1 size-4" />
                {publishStatus === "pr_open" ? "Approve & Publish" : "Retry deploy & attach"}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Commits <code>/{job.showcase_slug || "<slug>"}/</code> to the{" "}
          <code>frontiers3d-atlas-showcases</code> repo as a PR. <strong>Approve &amp; Publish</strong>{" "}
          merges that PR for you via the GitHub API (no manual GitHub step), waits for the connected
          Netlify site to deploy, verifies it, then attaches the live URL. The listing stays{" "}
          <strong>inactive</strong> until you activate it in Atlas Listings.
        </p>
        {!hasEntry && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            Create the Atlas entry first — the deployed URL attaches to that listing.
          </p>
        )}
        {job.showcase_pr_url && (
          <p className="mt-1 text-[11px]">
            <a href={job.showcase_pr_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              View showcase PR{job.showcase_pr_number ? ` #${job.showcase_pr_number}` : ""} <ExternalLink className="inline size-3" />
            </a>
          </p>
        )}
        {(publishStatus === "merged" || publishStatus === "pending_deploy") && (
          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-sky-700 dark:text-sky-300">
            <Clock className="mt-0.5 size-3.5 shrink-0" />
            PR merged{job.merged_at ? ` ${new Date(job.merged_at).toLocaleString()}` : ""}. Netlify deploys can take a minute —
            click <strong>Retry deploy &amp; attach</strong> (or use the manual field below) to finish once it's live.
          </p>
        )}
        {(publishStatus === "pr_open" || publishStatus === "merged" || publishStatus === "pending_deploy" || publishStatus === "published") && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className={`${inputCls} sm:flex-1`}
              placeholder="Deployed URL (optional — leave blank to resolve from Netlify)"
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={() => onMarkDeployed(manualUrl.trim() || undefined)} disabled={busy || !hasEntry}>
              Mark deployed &amp; attach URL
            </Button>
          </div>
        )}
        {publishStatus === "published" && job.deployed_url && (
          <p className="mt-1 text-[11px] text-emerald-700 dark:text-emerald-300">
            Attached: <a href={job.deployed_url} target="_blank" rel="noopener noreferrer" className="underline">{job.deployed_url}</a> — listing still inactive.
          </p>
        )}
        {(publishStatus === "failed" || publishStatus === "pending_deploy") && job.publish_error && (
          <p className={`mt-1 text-[11px] ${publishStatus === "failed" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"}`}>{job.publish_error}</p>
        )}
      </div>

      {created ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="size-4 shrink-0" />
          Inactive curated Atlas entry created.{" "}
          <Link to="/admin/atlas" className="font-medium underline">Open Atlas Listings</Link>{" "}
          to attach the presentation URL and activate when ready.
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onReject} disabled={busy} className="text-destructive">Reject</Button>
          <Button variant="outline" size="sm" onClick={onSaveDraft} disabled={busy}>Save draft</Button>
          {job.status !== "ready_for_review" && (
            <Button variant="outline" size="sm" onClick={onMarkReady} disabled={busy}>Save & mark ready</Button>
          )}
          <Button size="sm" onClick={onCreateEntry} disabled={busy || !draft.title.trim()}>
            <Plus className="mr-1 size-4" /> Create inactive Atlas entry
          </Button>
        </div>
      )}
    </div>
  );
}
