import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Info, Loader2, Trash2, Upload, Wand2, MapPin, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import {
  FLOOR_MAP_MAX_PINS,
  type FloorMapData,
  type FloorMapPin,
} from "@/lib/portal/floor-map";
import { compressFloorPlan } from "@/lib/portal/floor-map-compress";
import { UPLOAD_LIMITS, uploadLimitDescription } from "@/lib/limits";
import { toast } from "sonner";

// `ephemeral_assets` is added by migration
// 20260514130000_ephemeral_floorplan_assets.sql; the auto-generated
// Supabase types.ts won't include it until the next regen, so we
// erase the table-name constraint locally with a typed escape
// hatch. All other tables continue to flow through the full type
// graph via the regular `supabase.*` client.
type AnyTableClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
    delete: () => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
};
const sbAny = supabase as unknown as AnyTableClient;

interface Props {
  /** Currently-selected property id from the Enhancements tab bar. */
  propertyId: string;
  /** Friendly label for the active property (shown in copy). */
  propertyLabel: string;
  /** Persisted floor-map state for this property, or null when unset. */
  value: FloorMapData | null;
  /** Replace the persisted state. Passing null clears the map. */
  onChange: (next: FloorMapData | null) => void;
}

interface VectorizeResponse {
  ok: boolean;
  /** Empty string for the current raster pipeline. Kept in the response
   *  shape so previously-saved floor maps (with real SVG) still round-
   *  trip cleanly through the type. */
  svg?: string;
  /** Base64-encoded JPEG of the resized source image. Renders via
   *  <img src="data:image/jpeg;base64,…">. */
  raster?: { mime: string; data: string } | null;
  viewBox?: string;
  width?: number;
  height?: number;
  detail?: string;
  error?: string;
  /** Server-side build marker — bumped via `PIPELINE_VERSION` in
   *  supabase/functions/vectorize-floorplan/index.ts whenever the
   *  pipeline changes. Current value: "raster-v1". */
  pipeline?: string;
  mode?: "raster" | "ai-vector" | "raster-fallback";
}

const TEMP_BUCKET = "temporary-floorplans";

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

/**
 * Pro-only Interactive Floor Map editor.
 *
 * The agent uploads a raster floor plan (PNG/JPG), the
 * `vectorize-floorplan` Supabase Edge Function converts it to an
 * SVG, and the SVG is rendered here for pin placement. Clicking the
 * SVG creates a pin at the clicked coordinates; pins live alongside
 * the SVG in the draft and are embedded as runtime data in the final
 * exported standalone HTML.
 *
 * The original raster lives in the `temporary-floorplans` bucket for
 * 30 days so the agent can re-vectorize without re-uploading, then
 * the `purge_expired_ephemeral_assets` cron deletes it. The exported
 * presentation is fully self-contained — it never references the
 * storage URL.
 */
export function InteractiveFloorMap({
  propertyId,
  propertyLabel,
  value,
  onChange,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyStage, setBusyStage] = useState<string>("");
  const [editingPinId, setEditingPinId] = useState<string | null>(null);

  // Reset the edit popover when the active property changes so a
  // pin from property A can't bleed into property B's view.
  useEffect(() => {
    setEditingPinId(null);
  }, [propertyId]);

  const editingPin = useMemo(
    () => value?.pins.find((p) => p.id === editingPinId) ?? null,
    [value, editingPinId],
  );

  const handleUploadAndVectorize = useCallback(
    async (file: File) => {
      // Strict client-side limit BEFORE upload — the Edge Function
      // also enforces it but we want to fail fast to keep storage
      // clean.
      if (file.size > UPLOAD_LIMITS.image_bytes) {
        toast.error(
          `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB — please keep floor plans under ${uploadLimitDescription("image_bytes")}.`,
        );
        return;
      }
      const isImage = file.type.startsWith("image/");
      if (!isImage) {
        toast.error("Please choose a PNG or JPG file.");
        return;
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session?.user) {
        toast.error("Please sign in before uploading a floor plan.");
        return;
      }
      const userId = session.user.id;
      setBusy(true);
      setBusyStage("Compressing image…");

      // Resize + JPEG-encode in the browser. Eliminates the Edge
      // Function CPU-budget failure mode and shrinks the upload
      // (and the embedded data URI in the final HTML) by ~10×.
      let compressed;
      try {
        compressed = await compressFloorPlan(file);
      } catch (err) {
        setBusy(false);
        setBusyStage("");
        toast.error(
          err instanceof Error ? err.message : "Couldn't process that image.",
        );
        return;
      }

      const baseName = sanitizeFileName(file.name).replace(/\.[^.]+$/, "");
      const storagePath = `${userId}/${Date.now()}-${baseName}.jpg`;
      const uploadFile = new File([compressed.blob], `${baseName}.jpg`, {
        type: "image/jpeg",
      });
      try {
        setBusyStage("Uploading…");
        const { error: upErr } = await supabase.storage
          .from(TEMP_BUCKET)
          .upload(storagePath, uploadFile, {
            upsert: false,
            contentType: "image/jpeg",
          });
        if (upErr) {
          toast.error(`Upload failed: ${upErr.message}`);
          return;
        }

        // Insert the tracking row so the Edge Function can verify
        // ownership and the nightly cron job knows when to purge.
        setBusyStage("Tagging for auto-cleanup…");
        const { data: tracking, error: trackErr } = await sbAny
          .from("ephemeral_assets")
          .insert({
            user_id: userId,
            bucket_id: TEMP_BUCKET,
            file_path: storagePath,
            mime_type: "image/jpeg",
            file_size_bytes: compressed.compressedBytes,
            purpose: "floorplan_vectorize",
          })
          .select("id")
          .single();
        if (trackErr || !tracking) {
          // The upload succeeded but tracking failed — try to clean
          // the orphaned object so we don't leak quota.
          await supabase.storage.from(TEMP_BUCKET).remove([storagePath]);
          toast.error(`Couldn't register the upload: ${trackErr?.message ?? "no_row"}`);
          return;
        }

        setBusyStage("Compressing image…");
        // Guard against the supabase-js fetch hanging on a slow cold
        // start. 30 s is generous for a download + JPEG re-encode and
        // sits well under the platform's hard 60 s ceiling so we
        // surface a friendly message rather than a connection drop.
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30_000);
        let data: VectorizeResponse | null = null;
        let fnErr: { message?: string } | null = null;
        let timedOut = false;
        try {
          const res = await supabase.functions.invoke<VectorizeResponse>(
            "vectorize-floorplan",
            {
              body: { storage_path: storagePath },
              ...({ signal: controller.signal } as Record<string, unknown>),
            },
          );
          data = res.data ?? null;
          fnErr = res.error ?? null;
        } catch (err: unknown) {
          if ((err as { name?: string })?.name === "AbortError") {
            timedOut = true;
          } else {
            fnErr = { message: (err as Error)?.message ?? "network_error" };
          }
        } finally {
          clearTimeout(timeoutId);
        }

        const hasSvg = !!data?.svg;
        const hasRaster = !!(data?.raster && data.raster.data && data.raster.mime);
        if (timedOut || fnErr || !data?.ok || (!hasSvg && !hasRaster)) {
          const detail = timedOut
            ? "Compression took too long — try a smaller image."
            : data?.detail || data?.error || fnErr?.message || "compression_failed";
          toast.error(timedOut ? detail : `Couldn't process the floor plan: ${detail}`);
          // Best-effort cleanup of the orphan upload + row.
          await sbAny.from("ephemeral_assets").delete().eq("id", tracking.id);
          await supabase.storage.from(TEMP_BUCKET).remove([storagePath]);
          return;
        }

        // Constrain raster mime to the allowlist on the client side
        // too — the edge function enforces it but we want a clean
        // type at the call site.
        let normalizedRaster: FloorMapData["raster"] = null;
        if (hasRaster && data?.raster) {
          const m = data.raster.mime;
          if (m === "image/jpeg" || m === "image/png" || m === "image/webp") {
            normalizedRaster = { mime: m, data: data.raster.data };
          }
        }
        const next: FloorMapData = {
          svg: data.svg ?? "",
          raster: normalizedRaster,
          viewBox: data.viewBox || `0 0 ${data.width ?? 1024} ${data.height ?? 768}`,
          width: data.width ?? 1024,
          height: data.height ?? 768,
          pins: value?.pins ?? [],
          ephemeralAssetId: tracking.id,
          storagePath,
        };
        onChange(next);

        const pipelineLabel = data.pipeline ?? "raster-v1";
        const sizeKb = hasRaster
          ? ((data!.raster!.data.length * 0.75) / 1024).toFixed(0)
          : "0";
        toast.success(
          `Floor plan ready (${pipelineLabel} · ${sizeKb} KB). Click anywhere on the image to add a pin.`,
        );
      } finally {
        setBusy(false);
        setBusyStage("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onChange, value],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleUploadAndVectorize(f);
    },
    [handleUploadAndVectorize],
  );

  const handleClear = useCallback(async () => {
    if (!value) return;
    if (!confirm("Remove this floor map? Pins placed here will be lost.")) return;
    // Best-effort cleanup of the upload + tracking row. We don't
    // block on failures — the nightly cron purges anything we miss.
    if (value.ephemeralAssetId) {
      await sbAny.from("ephemeral_assets").delete().eq("id", value.ephemeralAssetId);
    }
    if (value.storagePath) {
      await supabase.storage.from(TEMP_BUCKET).remove([value.storagePath]);
    }
    onChange(null);
    setEditingPinId(null);
  }, [value, onChange]);

  const handleMapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!value) return;
      // Ignore clicks on existing pins — those handle their own
      // edit state.
      const target = e.target as HTMLElement;
      if (target.closest("[data-pin-marker]")) return;
      if (value.pins.length >= FLOOR_MAP_MAX_PINS) {
        toast.error(`Maximum ${FLOOR_MAP_MAX_PINS} pins per floor map.`);
        return;
      }
      const container = svgContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      const pin: FloorMapPin = {
        id: genId(),
        x: Math.max(0, Math.min(100, Math.round(x * 100) / 100)),
        y: Math.max(0, Math.min(100, Math.round(y * 100) / 100)),
        label: `Pin ${value.pins.length + 1}`,
        description: "",
      };
      onChange({ ...value, pins: [...value.pins, pin] });
      setEditingPinId(pin.id);
    },
    [value, onChange],
  );

  const updatePin = useCallback(
    (id: string, patch: Partial<FloorMapPin>) => {
      if (!value) return;
      onChange({
        ...value,
        pins: value.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      });
    },
    [value, onChange],
  );

  const deletePin = useCallback(
    (id: string) => {
      if (!value) return;
      onChange({ ...value, pins: value.pins.filter((p) => p.id !== id) });
      setEditingPinId((cur) => (cur === id ? null : cur));
    },
    [value, onChange],
  );

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs leading-snug text-foreground/80">
        Upload a top-down floor plan for{" "}
        <strong>{propertyLabel}</strong>. The image is downsized and
        compressed to a small JPEG (typically 150–400 KB), then embedded
        directly in your exported presentation — no external hosting. Click
        anywhere on the image to drop an interactive pin with a label and
        description. Originals auto-delete after 30 days for privacy.
      </div>

      {!value && (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-muted/30 px-4 py-8 text-center">
          <Upload className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No floor map yet</p>
          <p className="text-xs text-muted-foreground">
            PNG or JPG · {uploadLimitDescription("image_bytes")} · {" "}
            top-down Matterport renders work great.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            className="hidden"
            onChange={handleFileChange}
            disabled={busy}
          />
          <Button
            type="button"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="gap-2"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {busy ? busyStage || "Working…" : "Upload floor plan"}
          </Button>
        </div>
      )}

      {value && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3.5 text-primary" />
              <span>
                {value.pins.length} pin{value.pins.length === 1 ? "" : "s"} ·{" "}
                {value.raster
                  ? `${((value.raster.data.length * 0.75) / 1024).toFixed(0)} KB image`
                  : `${(value.svg.length / 1024).toFixed(1)} KB SVG`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg"
                className="hidden"
                onChange={handleFileChange}
                disabled={busy}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                className="gap-1.5"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                {busy ? busyStage || "Working…" : "Replace"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClear}
                disabled={busy}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
                Remove
              </Button>
            </div>
          </div>

          <div
            ref={svgContainerRef}
            onClick={handleMapClick}
            className="relative w-full overflow-hidden rounded-md border bg-background"
            style={{
              aspectRatio: `${value.width} / ${value.height}`,
              cursor: value.pins.length < FLOOR_MAP_MAX_PINS ? "crosshair" : "not-allowed",
              color: "#111827",
            }}
          >
            {value.raster ? (
              // Raster fallback render. The image fills the stage
              // (aspect ratio matches source dims), pin overlays
              // sit on top via percentage positioning — same as
              // for SVG, so no other change is needed.
              <img
                src={`data:${value.raster.mime};base64,${value.raster.data}`}
                alt={`${propertyLabel} floor plan`}
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain select-none"
              />
            ) : (
              /* SVG render layer. dangerouslySetInnerHTML is safe here:
                 the Edge Function owns SVG byte production and strips
                 script/event handlers, and the export-side scrubber
                 runs again before the HTML is built. */
              <div
                className="absolute inset-0 [&>svg]:h-full [&>svg]:w-full"
                dangerouslySetInnerHTML={{ __html: value.svg }}
              />
            )}
            {value.pins.map((pin) => (
              <button
                key={pin.id}
                data-pin-marker
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingPinId(pin.id === editingPinId ? null : pin.id);
                }}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                aria-label={`Edit pin ${pin.label || "Untitled"}`}
              >
                <span
                  className={`flex size-7 items-center justify-center rounded-full border-2 border-white shadow-md transition-transform ${
                    pin.id === editingPinId
                      ? "scale-110 bg-primary"
                      : "bg-primary/85 hover:scale-110"
                  }`}
                >
                  <MapPin className="size-3.5 text-white" />
                </span>
                <span className="block max-w-[120px] -translate-x-1/2 truncate rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-foreground shadow ring-1 ring-black/5">
                  {pin.label || "Untitled"}
                </span>
              </button>
            ))}
          </div>

          {editingPin && (
            <div className="rounded-md border bg-card p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Edit pin
                </span>
                <button
                  type="button"
                  onClick={() => setEditingPinId(null)}
                  className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Close pin editor"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid gap-2">
                <div className="grid gap-1">
                  <Label htmlFor={`pin-label-${editingPin.id}`} className="text-xs">
                    Label
                  </Label>
                  <Input
                    id={`pin-label-${editingPin.id}`}
                    value={editingPin.label}
                    onChange={(e) =>
                      updatePin(editingPin.id, { label: e.target.value.slice(0, 60) })
                    }
                    placeholder="e.g. Living Room"
                    maxLength={60}
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor={`pin-desc-${editingPin.id}`} className="text-xs">
                    Description
                  </Label>
                  <Textarea
                    id={`pin-desc-${editingPin.id}`}
                    value={editingPin.description}
                    onChange={(e) =>
                      updatePin(editingPin.id, {
                        description: e.target.value.slice(0, 600),
                      })
                    }
                    placeholder="What makes this room special?"
                    rows={3}
                    maxLength={600}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {editingPin.description.length} / 600
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Position: {editingPin.x.toFixed(1)}%, {editingPin.y.toFixed(1)}%
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => deletePin(editingPin.id)}
                    className="gap-1.5 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                    Delete pin
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
