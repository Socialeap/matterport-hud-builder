/**
 * Atlas opt-in card shown inside the Listing Launch Kit (Publish &
 * Distribute) once the user has pasted their live presentation URL.
 *
 * Lets owners submit their published tour for inclusion on the public
 * Frontiers3D Atlas (`/atlas`). Submissions land as kind='client_submitted'
 * status='pending_review'; only an admin can flip them to 'active'.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Globe2, Loader2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  listMyAtlasEntries,
  submitAtlasClientEntry,
  withdrawForEdit,
} from "@/lib/atlas.functions";
import {
  CATEGORY_LABELS,
  type AtlasEntry,
} from "@/lib/atlas-demo-data";

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
  city: string;
  region: string;
  country: string;
  latitude: string;
  longitude: string;
};

const EMPTY_FORM: FormState = {
  title: "",
  category: "residential",
  summary: "",
  city: "",
  region: "",
  country: "US",
  latitude: "",
  longitude: "",
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
      return { label: "Pending review", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
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
  const submit = useServerFn(submitAtlasClientEntry);
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
          city: match.city ?? "",
          region: match.region ?? "",
          country: match.country ?? "US",
          latitude: match.latitude != null ? String(match.latitude) : "",
          longitude: match.longitude != null ? String(match.longitude) : "",
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

      setSubmitting(true);
      try {
        await submit({
          data: {
            title: form.title.trim(),
            category: form.category,
            summary: form.summary.trim() || undefined,
            presentation_url: liveUrl,
            city: form.city.trim() || undefined,
            region: form.region.trim() || undefined,
            country: form.country.trim() || "US",
            latitude: lat ?? undefined,
            longitude: lng ?? undefined,
            saved_model_id: savedModelId ?? undefined,
            tags: [],
          },
        });
        toast.success("Submitted to the Frontiers|3D Atlas for review");
        setEditMode(false);
        await refresh();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Submission failed";
        setFormError(msg);
        toast.error(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [form, liveUrl, savedModelId, submit, refresh],
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
            List this tour on the Frontiers|3D Atlas
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            The Atlas is our public discovery layer at{" "}
            <span className="font-medium text-foreground">/atlas</span>.
            Approved listings appear publicly with a map pin and an embedded
            preview. Submissions are reviewed by an admin before they go live.
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
            <span>Your listing is live on /atlas.</span>
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

          <p className="text-[11px] text-muted-foreground">
            Listings without coordinates appear in the Atlas sidebar with a
            "Location pending" label. Active approved listings appear in
            Atlas; inactive listings remain hidden until restored by an admin.
          </p>

          {formError && (
            <p className="text-xs text-rose-400">{formError}</p>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
              {existing ? "Resubmit for review" : "Submit to Atlas"}
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
