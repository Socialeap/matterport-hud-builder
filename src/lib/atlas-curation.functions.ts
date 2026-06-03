/**
 * Server functions for the admin Curated Atlas Listing Assistant.
 *
 * Admin-only. Each handler verifies the `admin` role via `has_role` before any
 * read/write; the `atlas_curation_jobs` RLS policy is admin-only as a second gate.
 * All external enrichment (Google Places, geocoding) and env access live in the
 * dynamically-imported server-only `atlas-curation-server` module, so nothing
 * server-only enters the client bundle.
 *
 * Not prospect outreach, not billing. Created Atlas entries are always INACTIVE
 * (kind='curated_showcase', relationship_status='unclaimed') until an admin
 * activates them in the Atlas Listings admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractMatterportId } from "@/lib/matterport-mhtml";
import type {
  AtlasCurationDraft,
  AtlasCurationJob,
  AtlasCurationStatus,
  AtlasPlaceCandidate,
  GeocodeConfidence,
} from "./atlas-demo-data";

const HTTPS_URL = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https:\/\/[^\s<>"']+$/i, "Must be an https:// URL");

const MATTERPORT_ID_RE = /^[A-Za-z0-9]{11}$/;
const JOB_COLUMNS = "*";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { supabase: any; userId: string };

async function requireAdmin(context: Ctx): Promise<void> {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) {
    throw new Error("Forbidden: admin access required.");
  }
}

const COUNTRY = z
  .union([z.string().trim().min(2).max(2), z.literal("")])
  .optional()
  .transform((v) => (v && v.length > 0 ? v.toUpperCase() : ""));

const draftSchema = z.object({
  title: z.string().trim().max(160),
  category: z.string().trim().max(40),
  summary: z.string().trim().max(600),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  address: z.string().trim().max(200),
  city: z.string().trim().max(120),
  region: z.string().trim().max(120),
  country: z.string().trim().max(2),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  hero_image_url: z.string().trim().max(2048),
});

// ── List ─────────────────────────────────────────────────────────────────────

export const listCurationJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ jobs: AtlasCurationJob[] }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;
    const { data, error } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { jobs: (data ?? []) as AtlasCurationJob[] };
  });

// ── Create + enrich ──────────────────────────────────────────────────────────

const createInput = z.object({
  input_matterport_url: z.string().trim().min(1, "Matterport URL or ID is required").max(2048),
  input_name: z.string().trim().max(200).optional().default(""),
  input_address: z.string().trim().max(300).optional().default(""),
  input_city: z.string().trim().max(120).optional().default(""),
  input_region: z.string().trim().max(120).optional().default(""),
  input_country: COUNTRY,
  input_category: z.string().trim().max(40).optional().default(""),
  rights_note: z.string().trim().max(1000).optional().default(""),
});

export const createCurationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }): Promise<{ job: AtlasCurationJob }> => {
    await requireAdmin(context as Ctx);

    const matterportId = extractMatterportId(data.input_matterport_url);
    if (!MATTERPORT_ID_RE.test(matterportId)) {
      throw new Error(
        "Invalid Matterport URL or ID — expected an 11-character model ID, e.g. https://my.matterport.com/show/?m=XXXXXXXXXXX",
      );
    }
    if (!data.input_name.trim() && !data.input_address.trim() && !data.input_city.trim()) {
      throw new Error("Provide a business/space name, address, or city so the place can be resolved.");
    }

    const enrich = await import("./atlas-curation-server");

    let candidates: AtlasPlaceCandidate[] = [];
    let placeId: string | null = null;
    let formattedAddress: string | null = null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let website: string | null = null;
    let phone: string | null = null;
    let confidence: GeocodeConfidence | null = null;
    let status: AtlasCurationStatus = "draft";
    let needsReview = false;
    let errorMessage: string | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolved: any = null;

    const query = [data.input_name, data.input_address, data.input_city, data.input_region]
      .filter(Boolean)
      .join(", ");

    const placesRes = await enrich.resolvePlaceCandidates(query);
    if (placesRes.candidates.length > 1) {
      candidates = placesRes.candidates;
      status = "needs_selection";
    } else if (placesRes.candidates.length === 1) {
      resolved = await enrich.fetchPlaceDetails(placesRes.candidates[0].place_id);
      if (resolved) {
        placeId = resolved.place_id;
        formattedAddress = resolved.formatted_address;
        latitude = resolved.latitude;
        longitude = resolved.longitude;
        website = resolved.website;
        phone = resolved.phone;
        if (latitude != null && longitude != null) confidence = "google_places";
      }
    }

    // City-level fallback when Places gave no coordinates (and not awaiting selection).
    if ((latitude == null || longitude == null) && status !== "needs_selection") {
      const city = (resolved?.city || data.input_city || "").trim();
      const region = (resolved?.region || data.input_region || "").trim();
      const geo = await enrich.cityLevelGeocode(city, region);
      if (geo) {
        latitude = geo.lat;
        longitude = geo.lng;
        confidence = "city_level";
      }
    }

    const draft: AtlasCurationDraft = enrich.buildDraft({
      inputName: data.input_name,
      inputAddress: data.input_address,
      inputCategory: data.input_category,
      inputCity: data.input_city,
      inputRegion: data.input_region,
      inputCountry: data.input_country,
      resolved,
      latitude,
      longitude,
    });

    if (status !== "needs_selection") {
      if (latitude != null && longitude != null) {
        status = "ready_for_review";
      } else {
        status = "blocked";
        needsReview = true;
        errorMessage =
          "Coordinates needed before a map pin can appear. Add a city/region, enter latitude/longitude manually in review, or configure Google Places.";
      }
    }

    const payload = {
      created_by: (context as Ctx).userId,
      status,
      needs_human_review: needsReview,
      input_matterport_url: data.input_matterport_url,
      extracted_matterport_id: matterportId,
      input_name: data.input_name || null,
      input_address: data.input_address || null,
      input_category: data.input_category || null,
      rights_note: data.rights_note || null,
      google_place_id: placeId,
      formatted_address: formattedAddress,
      latitude,
      longitude,
      geocode_confidence: confidence,
      place_candidates: candidates,
      website_url: website,
      phone,
      drafted_title: draft.title || null,
      drafted_summary: draft.summary || null,
      drafted_category: draft.category || null,
      drafted_tags: draft.tags,
      draft_payload: draft,
      error_message: errorMessage,
    };

    const sb = (context as Ctx).supabase;
    const { data: inserted, error } = await sb
      .from("atlas_curation_jobs")
      .insert(payload)
      .select(JOB_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return { job: inserted as AtlasCurationJob };
  });

// ── Select a place candidate (multi-match → resolve details) ─────────────────

export const selectCurationCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ jobId: z.string().uuid(), placeId: z.string().min(1).max(400) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ job: AtlasCurationJob }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");

    const enrich = await import("./atlas-curation-server");
    const resolved = await enrich.fetchPlaceDetails(data.placeId);
    if (!resolved) throw new Error("Couldn't fetch details for the selected place. Try again or enter coordinates manually.");

    let latitude = resolved.latitude;
    let longitude = resolved.longitude;
    let confidence: GeocodeConfidence | null =
      latitude != null && longitude != null ? "google_places" : null;
    if (latitude == null || longitude == null) {
      const geo = await enrich.cityLevelGeocode(resolved.city, resolved.region);
      if (geo) {
        latitude = geo.lat;
        longitude = geo.lng;
        confidence = "city_level";
      }
    }

    const draft: AtlasCurationDraft = enrich.buildDraft({
      inputName: job.input_name ?? "",
      inputAddress: job.input_address ?? "",
      inputCategory: job.input_category ?? "",
      inputCity: "",
      inputRegion: "",
      inputCountry: "",
      resolved,
      latitude,
      longitude,
    });

    const hasCoords = latitude != null && longitude != null;
    const { data: updated, error } = await sb
      .from("atlas_curation_jobs")
      .update({
        google_place_id: resolved.place_id,
        formatted_address: resolved.formatted_address,
        latitude,
        longitude,
        geocode_confidence: confidence,
        place_candidates: [],
        website_url: resolved.website,
        phone: resolved.phone,
        drafted_title: draft.title || null,
        drafted_summary: draft.summary || null,
        drafted_category: draft.category || null,
        drafted_tags: draft.tags,
        draft_payload: draft,
        status: hasCoords ? "ready_for_review" : "blocked",
        needs_human_review: !hasCoords,
        error_message: hasCoords ? null : "Coordinates needed before a map pin can appear.",
      })
      .eq("id", data.jobId)
      .select(JOB_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return { job: updated as AtlasCurationJob };
  });

// ── Update (admin review/edit, incl. manual coordinates + status) ────────────

const updatableStatus = z.enum([
  "draft",
  "needs_selection",
  "ready_for_review",
  "blocked",
  "rejected",
]);

export const updateCurationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        jobId: z.string().uuid(),
        draft: draftSchema.optional(),
        status: updatableStatus.optional(),
        rights_note: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ job: AtlasCurationJob }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");
    if (job.status === "atlas_entry_created") {
      throw new Error("This job already produced an Atlas entry and can no longer be edited.");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: Record<string, any> = {};
    if (data.rights_note !== undefined) patch.rights_note = data.rights_note || null;

    if (data.draft) {
      const d = data.draft;
      patch.draft_payload = d;
      patch.drafted_title = d.title || null;
      patch.drafted_summary = d.summary || null;
      patch.drafted_category = d.category || null;
      patch.drafted_tags = d.tags;
      patch.latitude = d.latitude;
      patch.longitude = d.longitude;
      patch.formatted_address = d.address || job.formatted_address;
      // Manual coordinate edit → mark confidence accordingly.
      const coordsChanged =
        d.latitude !== job.latitude || d.longitude !== job.longitude;
      if (coordsChanged && d.latitude != null && d.longitude != null) {
        patch.geocode_confidence = "manual";
      }
      patch.needs_human_review = d.latitude == null || d.longitude == null;
    }

    if (data.status !== undefined) patch.status = data.status;
    if (Object.keys(patch).length === 0) return { job: job as AtlasCurationJob };

    const { data: updated, error } = await sb
      .from("atlas_curation_jobs")
      .update(patch)
      .eq("id", data.jobId)
      .select(JOB_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    return { job: updated as AtlasCurationJob };
  });

// ── Create an INACTIVE Atlas entry from a curated job ─────────────────────────

export const createAtlasEntryFromJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ entryId: string; job: AtlasCurationJob }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");
    if (job.atlas_entry_id) {
      throw new Error("An Atlas entry was already created for this job.");
    }
    const draft = job.draft_payload as AtlasCurationDraft | null;
    if (!draft || !draft.title.trim() || !draft.category.trim()) {
      throw new Error("Add a title and category in review before creating an Atlas entry.");
    }

    const entryPayload = {
      kind: "curated_showcase" as const,
      status: "inactive" as const, // never public by default
      relationship_status: "unclaimed" as const,
      owner_user_id: null,
      title: draft.title.trim().slice(0, 160),
      summary: draft.summary.trim() ? draft.summary.trim().slice(0, 600) : null,
      category: draft.category.trim().slice(0, 40),
      tags: (draft.tags ?? []).slice(0, 12),
      hero_image_url: draft.hero_image_url.trim() || null,
      presentation_url: null, // attached later, after the package is built/deployed
      address: draft.address.trim() || null,
      city: draft.city.trim() || null,
      region: draft.region.trim() || null,
      country: (draft.country.trim() || "US").toUpperCase().slice(0, 2),
      latitude: draft.latitude,
      longitude: draft.longitude,
      sort_order: 0,
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      reviewed_by: null,
      rejection_reason: null,
    };

    const { data: entry, error: insErr } = await sb
      .from("atlas_entries")
      .insert(entryPayload)
      .select("id")
      .single();
    if (insErr || !entry) throw new Error(insErr?.message ?? "Failed to create Atlas entry.");

    const { data: updated, error: updErr } = await sb
      .from("atlas_curation_jobs")
      .update({ atlas_entry_id: entry.id, status: "atlas_entry_created", error_message: null })
      .eq("id", data.jobId)
      .select(JOB_COLUMNS)
      .single();
    if (updErr) throw new Error(updErr.message);

    return { entryId: entry.id as string, job: updated as AtlasCurationJob };
  });

// ── Delete ───────────────────────────────────────────────────────────────────

export const deleteCurationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;
    const { error } = await sb.from("atlas_curation_jobs").delete().eq("id", data.jobId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Generate a minimal-but-real presentation package (download) ──────────────

export const generateCuratedPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{
    job: AtlasCurationJob;
    filename: string;
    sizeBytes: number;
    zipBase64: string;
  }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");

    const matterportId = (job.extracted_matterport_id ?? "").trim();
    const draft = job.draft_payload as AtlasCurationDraft | null;
    const fail = async (msg: string): Promise<never> => {
      await sb
        .from("atlas_curation_jobs")
        .update({ build_status: "failed", build_error: msg })
        .eq("id", data.jobId);
      throw new Error(msg);
    };
    if (!MATTERPORT_ID_RE.test(matterportId)) {
      return fail("Missing or invalid Matterport model ID — can't build a presentation.");
    }
    if (!draft || !draft.title.trim()) {
      return fail("Add a title in review before generating the presentation package.");
    }

    await sb
      .from("atlas_curation_jobs")
      .update({ build_status: "building", build_error: null })
      .eq("id", data.jobId);

    try {
      const builder = await import("./atlas-curation-server");
      const pkg = await builder.buildCuratedPackageZip({
        curationJobId: job.id,
        matterportId,
        title: draft.title,
        summary: draft.summary,
        category: draft.category,
        city: draft.city,
        region: draft.region,
        tags: draft.tags ?? [],
        heroImageUrl: draft.hero_image_url,
      });

      const { data: updated, error: updErr } = await sb
        .from("atlas_curation_jobs")
        .update({
          build_status: "built",
          built_at: new Date().toISOString(),
          package_filename: pkg.filename,
          package_size_bytes: pkg.sizeBytes,
          build_error: null,
        })
        .eq("id", data.jobId)
        .select(JOB_COLUMNS)
        .single();
      if (updErr) throw new Error(updErr.message);

      return {
        job: updated as AtlasCurationJob,
        filename: pkg.filename,
        sizeBytes: pkg.sizeBytes,
        zipBase64: pkg.base64,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Package build failed.");
    }
  });

// ── Publish to the showcases repo (GitHub PR) ────────────────────────────────

export const publishCuratedShowcase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ job: AtlasCurationJob; prUrl: string }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");

    const matterportId = (job.extracted_matterport_id ?? "").trim();
    const draft = job.draft_payload as AtlasCurationDraft | null;
    const failPublish = async (msg: string): Promise<never> => {
      await sb
        .from("atlas_curation_jobs")
        .update({ publish_status: "failed", publish_error: msg })
        .eq("id", data.jobId);
      throw new Error(msg);
    };
    if (!MATTERPORT_ID_RE.test(matterportId)) {
      return failPublish("Missing or invalid Matterport model ID — can't publish a presentation.");
    }
    if (!draft || !draft.title.trim()) {
      return failPublish("Add a title in review before publishing the showcase.");
    }

    try {
      // Resolve a stable, unique folder slug. Re-publishing the same job reuses its
      // stored slug (updates the same `<slug>/` folder); a first publish derives the
      // slug from the title and disambiguates it against any OTHER job already using
      // that slug, so two listings with the same/similar title can't silently
      // overwrite each other's folder in the showcases repo.
      let slug = job.showcase_slug as string | null;
      if (!slug) {
        const { slugify } = await import("./atlas-curation-server");
        const baseSlug = slugify(draft.title);
        const { data: clash } = await sb
          .from("atlas_curation_jobs")
          .select("id")
          .eq("showcase_slug", baseSlug)
          .neq("id", job.id)
          .limit(1)
          .maybeSingle();
        slug = clash ? `${baseSlug}-${String(job.id).slice(0, 6)}` : baseSlug;
      }

      const publish = await import("./atlas-showcase-publish");
      const res = await publish.publishShowcasePr({
        slug,
        input: {
          curationJobId: job.id,
          matterportId,
          title: draft.title,
          summary: draft.summary,
          category: draft.category,
          city: draft.city,
          region: draft.region,
          tags: draft.tags ?? [],
          heroImageUrl: draft.hero_image_url,
        },
      });
      const { data: updated, error: updErr } = await sb
        .from("atlas_curation_jobs")
        .update({
          showcase_slug: res.slug,
          publish_status: "pr_open",
          showcase_pr_url: res.prUrl,
          publish_error: null,
        })
        .eq("id", data.jobId)
        .select(JOB_COLUMNS)
        .single();
      if (updErr) throw new Error(updErr.message);
      return { job: updated as AtlasCurationJob, prUrl: res.prUrl };
    } catch (err) {
      return failPublish(err instanceof Error ? err.message : "Showcase publish failed.");
    }
  });

// ── Mark deployed + attach the live URL to the Atlas entry ───────────────────

export const markShowcaseDeployed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ jobId: z.string().uuid(), url: HTTPS_URL.optional() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ job: AtlasCurationJob; deployedUrl: string }> => {
    await requireAdmin(context as Ctx);
    const sb = (context as Ctx).supabase;

    const { data: job, error: loadErr } = await sb
      .from("atlas_curation_jobs")
      .select(JOB_COLUMNS)
      .eq("id", data.jobId)
      .single();
    if (loadErr || !job) throw new Error(loadErr?.message ?? "Curation job not found.");
    if (!job.atlas_entry_id) {
      throw new Error("Create the Atlas entry first — the deployed URL attaches to that listing.");
    }
    if (!job.showcase_slug) {
      throw new Error("Open the showcase PR first so there's a folder/slug to deploy.");
    }

    let deployedUrl = data.url ?? "";
    if (!deployedUrl) {
      const publish = await import("./atlas-showcase-publish");
      deployedUrl = await publish.resolveShowcaseUrl(job.showcase_slug);
    }

    // Attach to the listing's presentation_url. Status is left untouched, so the
    // listing stays inactive until an admin explicitly activates it.
    const { error: entErr } = await sb
      .from("atlas_entries")
      .update({ presentation_url: deployedUrl })
      .eq("id", job.atlas_entry_id);
    if (entErr) throw new Error(`Couldn't attach URL to the Atlas entry: ${entErr.message}`);

    const { data: updated, error: updErr } = await sb
      .from("atlas_curation_jobs")
      .update({
        publish_status: "published",
        deployed_url: deployedUrl,
        published_at: new Date().toISOString(),
        publish_error: null,
      })
      .eq("id", data.jobId)
      .select(JOB_COLUMNS)
      .single();
    if (updErr) throw new Error(updErr.message);
    return { job: updated as AtlasCurationJob, deployedUrl };
  });
