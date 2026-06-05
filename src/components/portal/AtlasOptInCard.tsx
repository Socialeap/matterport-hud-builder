/**
 * Atlas listing-details form, shown in Publish & Distribute ONLY after the
 * published URL has passed the verify-first gate in the parent section.
 *
 * Collects the listing-card fields and submits via `verifyAndSubmitAtlasEntry`,
 * which RE-verifies the manifest server-side before activating (so a stale gate
 * or direct call can't bypass verification). An unverified URL creates no row —
 * the card surfaces the specific failure (missing manifest / mismatch / unreachable).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, Image as ImageIcon, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  listMyAtlasEntries,
  verifyAndSubmitAtlasEntry,
  withdrawForEdit,
} from "@/lib/atlas.functions";
import {
  CATEGORY_LABELS,
  MAX_MAP_TAGS,
  PREDEFINED_TAGS,
  type AtlasEntry,
} from "@/lib/atlas-demo-data";

/** Mirrors the server's https-only URL rule in `atlas.functions.ts`. */
const HTTPS_IMAGE_URL_RE = /^https:\/\/[^\s<>"']+$/i;

interface AtlasOptInCardProps {
  liveUrl: string;
  propertyName?: string;
  accentColor: string;
  savedModelId?: string | null;
}

type FormState = {
  title: string;
  category: string;
  summary: string;
  address: string;
  city: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
  heroImageUrl: string;
  tags: string[];
};

const EMPTY_FORM: FormState = {
  title: "",
  category: "residential",
  summary: "",
  address: "",
  city: "",
  region: "",
  country: "US",
  latitude: "",
  longitude: "",
  heroImageUrl: "",
  tags: [],
};

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS ?? {}).length
  ? Object.entries(CATEGORY_LABELS)
  : ([
      ["residential", "Residential"],
      ["commercial", "Commercial"],
      ["hospitality", "Hospitality"],
      ["cultural", "Cultural"],
      ["other", "Other"],
    ] as Array<[string, string]>);

function statusBadge(status: AtlasEntry["status"]) {
  switch (status) {
    case "active":
      return { label: "Active on Atlas", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" };
    case "pending_review":
      return { label: "Pending verification", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
    case "inactive":
      return { label: "Inactive", className: "bg-slate-500/15 text-slate-300 border-slate-500/30" };
    case "rejected":
      return { label: "Rejected", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" };
    default:
      return { label: status, className: "bg-slate-500/15 text-slate-300 border-slate-500/30" };
  }
}

export function AtlasOptInCard({
  liveUrl,
  propertyName,
  accentColor,
  savedModelId,
}: AtlasOptInCardProps) {
  const listMine = useServerFn(listMyAtlasEntries);
  const verifyAndSubmit = useServerFn(verifyAndSubmitAtlasEntry);
  const withdraw = useServerFn(withdrawForEdit);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mineError, setMineError] = useState<string | null>(null);
  const [existing, setExisting] = useState<AtlasEntry | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...EMPTY_FORM,
    title: propertyName ?? "",
  }));
  const [formError, setFormError] = useState<string | null>(null);

  // Match the existing client_submitted row for this presentation URL
  // (or saved_model_id) so the card reflects the latest server state.
  const refresh = useCallback(async () => {
    setLoading(true);
    setMineError(null);
    try {
      const { entries } = await listMine();
      const match =
        entries.find((e) =>
          savedModelId
            ? e.saved_model_id === savedModelId
            : e.presentation_url === liveUrl,
        ) ?? null;
      setExisting(match);
      if (match && !editMode) {
        setForm({
          title: match.title ?? propertyName ?? "",
          category: match.category ?? "residential",
          summary: match.summary ?? "",
          address: match.address ?? "",
          city: match.city ?? "",
          region: match.region ?? "",
          country: match.country ?? "US",
          latitude: match.latitude != null ? String(match.latitude) : "",
          longitude: match.longitude != null ? String(match.longitude) : "",
          heroImageUrl: match.hero_image_url ?? "",
          tags: (match.tags ?? []).slice(0, MAX_MAP_TAGS),
        });
      }
    } catch (err) {
      setMineError(err instanceof Error ? err.message : "Failed to load Atlas status");
    } finally {
      setLoading(false);
    }
    // editMode intentionally excluded — only re-pull on URL/model/property change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listMine, liveUrl, savedModelId, propertyName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleChange = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  // Toggle a map tag on/off, capped at MAX_MAP_TAGS selections.
  const toggleTag = useCallback((tag: string) => {
    setForm((prev) => {
      if (prev.tags.includes(tag)) {
        return { ...prev, tags: prev.tags.filter((t) => t !== tag) };
      }
      if (prev.tags.length >= MAX_MAP_TAGS) return prev;
      return { ...prev, tags: [...prev.tags, tag] };
    });
  }, []);

  const heroUrlInvalid = useMemo(() => {
    const v = form.heroImageUrl.trim();
    return v.length > 0 && !HTTPS_IMAGE_URL_RE.test(v);
  }, [form.heroImageUrl]);

  // Pill options: shared vocabulary plus any legacy free-text tags already on
  // this entry (kept visible/selected so they can be deselected, not silently dropped).
  const tagOptions = useMemo(() => {
    const known = PREDEFINED_TAGS as readonly string[];
    const extras = form.tags.filter((t) => !known.includes(t));
    return [...known, ...extras];
  }, [form.tags]);

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setFormError(null);

      if (!form.title.trim()) {
        setFormError("Title is required.");
        return;
      }
      const lat = form.latitude.trim() ? Number(form.latitude) : null;
      const lng = form.longitude.trim() ? Number(form.longitude) : null;
      if (lat != null && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
        setFormError("Latitude must be between -90 and 90.");
        return;
      }
      if (lng != null && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
        setFormError("Longitude must be between -180 and 180.");
        return;
      }
      const hero = form.heroImageUrl.trim();
      if (hero && !HTTPS_IMAGE_URL_RE.test(hero)) {
        setFormError("Hero image must be a valid https:// URL.");
        return;
      }

      setSubmitting(true);
      try {
        const tags = form.tags.slice(0, MAX_MAP_TAGS);
        // Verification-first: the server fetches the manifest at this URL and
        // only activates a listing when the opaque token verifies. We get a
        // structured result (no throw) for verification failures.
        const res = await verifyAndSubmit({
          data: {
            title: form.title.trim(),
            category: form.category,
            summary: form.summary.trim() || undefined,
            hero_image_url: form.heroImageUrl.trim() || undefined,
            presentation_url: liveUrl,
            address: form.address.trim() || undefined,
            city: form.city.trim() || undefined,
            region: form.region.trim() || undefined,
            country: form.country.trim() || "US",
            latitude: lat ?? undefined,
            longitude: lng ?? undefined,
            tags,
          },
        });
        if (res.result === "verified") {
          setFormError(null);
          toast.success(res.message);
          setEditMode(false);
          await refresh();
        } else {
          setFormError(res.message);
          toast.error(res.message);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Verification failed";
        setFormError(msg);
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [form, liveUrl, verifyAndSubmit, refresh],
  );

  const onWithdraw = useCallback(async () => {
    if (!existing) return;
    setSubmitting(true);
    try {
      await withdraw({ data: { id: existing.id } });
      toast.success("Listing withdrawn for editing");
      setEditMode(true);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't withdraw listing");
    } finally {
      setSubmitting(false);
    }
  }, [existing, withdraw, refresh]);

  const badge = useMemo(
    () => (existing ? statusBadge(existing.status) : null),
    [existing],
  );

  const showForm = !existing || editMode;

  return (
    <div
      className="space-y-4 rounded-lg border-2 p-4"
      style={{ borderColor: accentColor }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Globe2 className="size-5" style={{ color: accentColor }} />
            Atlas listing details
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Your published presentation is verified. Add the details shown on your
            public Atlas card at{" "}
            <span className="font-medium text-foreground">/atlas</span> — submitting
            publishes your listing with a map pin and an embedded preview.
          </p>
        </div>
        {badge && (
          <Badge variant="outline" className={`shrink-0 ${badge.className}`}>
            {badge.label}
          </Badge>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking Atlas status…
        </div>
      ) : mineError ? (
        <p className="text-xs text-rose-400">{mineError}</p>
      ) : null}

      {existing?.status === "rejected" && existing.rejection_reason && (
        <p className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
          Rejection reason: {existing.rejection_reason}
        </p>
      )}

      {!loading && existing && !editMode && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {existing.status === "active" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onWithdraw}
              disabled={submitting}
            >
              Withdraw to edit
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setEditMode(true)}
              disabled={submitting}
            >
              Edit submission
            </Button>
          )}
          {existing.status === "active" && (
            <span>Your entry is verified and live on /atlas.</span>
          )}
        </div>
      )}

      {!loading && showForm && (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="atlas-title" className="text-xs">
                Listing title
              </Label>
              <Input
                id="atlas-title"
                value={form.title}
                onChange={(e) => handleChange("title", e.target.value)}
                maxLength={160}
                placeholder="e.g. Lakeside Modern at Tahoe"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="atlas-category" className="text-xs">
                Category
              </Label>
              <select
                id="atlas-category"
                value={form.category}
                onChange={(e) => handleChange("category", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
              >
                {CATEGORY_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="atlas-summary" className="text-xs">
              Summary
            </Label>
            <Textarea
              id="atlas-summary"
              value={form.summary}
              onChange={(e) => handleChange("summary", e.target.value)}
              maxLength={600}
              rows={3}
              placeholder="A short blurb shown on the Atlas card (max 600 characters)."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="atlas-city" className="text-xs">City</Label>
              <Input
                id="atlas-city"
                value={form.city}
                onChange={(e) => handleChange("city", e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="atlas-region" className="text-xs">Region / State</Label>
              <Input
                id="atlas-region"
                value={form.region}
                onChange={(e) => handleChange("region", e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="atlas-country" className="text-xs">Country (ISO-2)</Label>
              <Input
                id="atlas-country"
                value={form.country}
                onChange={(e) => handleChange("country", e.target.value.toUpperCase())}
                maxLength={2}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="atlas-lat" className="text-xs flex items-center gap-1">
                <MapPin className="size-3" /> Latitude
              </Label>
              <Input
                id="atlas-lat"
                value={form.latitude}
                onChange={(e) => handleChange("latitude", e.target.value)}
                inputMode="decimal"
                placeholder="-90 to 90 (optional)"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="atlas-lng" className="text-xs flex items-center gap-1">
                <MapPin className="size-3" /> Longitude
              </Label>
              <Input
                id="atlas-lng"
                value={form.longitude}
                onChange={(e) => handleChange("longitude", e.target.value)}
                inputMode="decimal"
                placeholder="-180 to 180 (optional)"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="atlas-address" className="text-xs">
              Address <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="atlas-address"
              value={form.address}
              onChange={(e) => handleChange("address", e.target.value)}
              maxLength={200}
              placeholder="Street address (optional)"
            />
          </div>

          {/* ── Atlas Map Appearance ──────────────────────────────────────
              Drives the pin's hover card + expanded card on /atlas. */}
          <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <ImageIcon className="size-3.5" style={{ color: accentColor }} />
                Atlas Map Appearance
              </h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Shown when visitors hover or click your pin on the /atlas map.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="atlas-hero" className="text-xs">
                Hero image URL <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="atlas-hero"
                value={form.heroImageUrl}
                onChange={(e) => handleChange("heroImageUrl", e.target.value)}
                type="url"
                inputMode="url"
                placeholder="https://… (hosted image, optional)"
                aria-invalid={heroUrlInvalid}
              />
              {heroUrlInvalid && (
                <p className="text-[11px] text-rose-400">
                  Must be a valid https:// image URL.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">
                Map tags{" "}
                <span className="text-muted-foreground">
                  ({form.tags.length}/{MAX_MAP_TAGS} selected)
                </span>
              </Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atlas map tags">
                {tagOptions.map((tag) => {
                  const selected = form.tags.includes(tag);
                  const atLimit = !selected && form.tags.length >= MAX_MAP_TAGS;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      disabled={atLimit}
                      aria-pressed={selected}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary/15 text-primary"
                          : atLimit
                            ? "cursor-not-allowed border-border/50 text-muted-foreground/50"
                            : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            No coordinates? Your entry shows a "location pin pending" label until
            you add them. Verified entries can appear publicly on /atlas; inactive
            entries stay hidden.
          </p>

          {formError && (
            <p className="text-xs text-rose-400">{formError}</p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {existing ? "Update Atlas Listing" : "Submit Atlas Listing"}
            </Button>
            {existing && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEditMode(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
