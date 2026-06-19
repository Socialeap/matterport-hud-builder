// Atlas-managed showcase runtime-upgrade decision helpers (pure, no I/O).
//
// The Atlas equivalent of the Builder Patch Tool: an already-published curated
// showcase is upgraded to the current runtime by REGENERATING it from its stored
// curation draft and REDEPLOYING through its GitHub source repo + Netlify — never
// by single-file patching (the Presentation Upgrade Center rejects family=atlas).
//
// These helpers carry the rules the admin server fns + UI share so they can be
// unit-tested in isolation from the DB / GitHub / Netlify:
//   - compareRuntimeVersions / computeShowcaseRuntimeStatus — is an upgrade due?
//   - canRepublishShowcase — may this job be republished in place?
//   - buildShowcaseInputFromJob / resolveRepublishSlug — reuse existing curation
//     data + the existing slug/folder (preserve path).
//   - buildRepublishJobUpdate — the job row update on PR-open that preserves the
//     live URL + the Atlas listing until the new deploy verifies.

const MATTERPORT_ID_RE = /^[A-Za-z0-9]{11}$/;
// Republish (runtime upgrade) is only for a showcase that is already live: it
// regenerates the existing folder. Anything earlier publishes for the first time.
const REPUBLISHABLE_STATES = ["published", "pending_deploy"];

/** Parse a strict "x.y.z" runtime string into [major, minor, patch]; non-semver → null. */
export function parseRuntimeVersion(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Compare two runtime versions numerically (component-wise, so 2.2.10 > 2.2.9).
 * Returns -1 (a < b), 0 (equal), 1 (a > b), or null if either is unparseable.
 */
export function compareRuntimeVersions(a, b) {
  const pa = parseRuntimeVersion(a);
  const pb = parseRuntimeVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Decide whether a deployed showcase should offer a runtime upgrade.
 * upgradeAvailable is true ONLY when the deployed runtime is strictly OLDER than
 * the current build runtime — never a downgrade (a deployed runtime newer than
 * this build is "ahead_of_build", mirroring the Upgrade Center's future_version
 * no-downgrade rule), and never when versions match or can't be read.
 *
 * status ∈ "upgrade_available" | "current" | "ahead_of_build" | "unknown".
 */
export function computeShowcaseRuntimeStatus(deployedRuntime, currentRuntime) {
  const deployed = (typeof deployedRuntime === "string" && deployedRuntime.trim()) || null;
  const cmp = deployed ? compareRuntimeVersions(deployed, currentRuntime) : null;
  let status;
  if (!deployed || cmp === null) status = "unknown";
  else if (cmp < 0) status = "upgrade_available";
  else if (cmp > 0) status = "ahead_of_build";
  else status = "current";
  return {
    deployedRuntime: deployed,
    currentRuntime,
    upgradeAvailable: status === "upgrade_available",
    status,
    reason:
      status === "upgrade_available"
        ? `Deployed runtime ${deployed} is older than current ${currentRuntime}.`
        : status === "ahead_of_build"
          ? `Deployed runtime ${deployed} is newer than this build's ${currentRuntime} — don't downgrade.`
          : status === "current"
            ? null
            : "Deployed runtime version could not be read.",
  };
}

/**
 * Pure guard for the Atlas-managed runtime upgrade (republish) action. Republish
 * is ONLY for an already-published curated showcase that still has its stored
 * slug + Atlas listing + a regenerable curation draft. Returns { ok, reason } so
 * the server fn and any UI gating share one rule. (Family is implicitly atlas —
 * every atlas_curation_jobs row produces a family=atlas showcase; this never
 * touches Builder exports.)
 */
export function canRepublishShowcase(job) {
  if (!job) return { ok: false, reason: "Curation job not found." };
  const matterportId = String(job.extracted_matterport_id ?? "").trim();
  const draft = job.draft_payload ?? null;
  const slug = String(job.showcase_slug ?? "").trim();
  const state = job.publish_status ?? "none";
  if (!MATTERPORT_ID_RE.test(matterportId)) {
    return { ok: false, reason: "Missing or invalid Matterport model ID — can't regenerate the showcase." };
  }
  if (!draft || !String(draft.title ?? "").trim()) {
    return { ok: false, reason: "This job has no curation draft to regenerate from." };
  }
  if (!slug) {
    return {
      ok: false,
      reason: "This showcase has never been published — use 'Open showcase PR' for the first publish.",
    };
  }
  if (!job.atlas_entry_id) {
    return { ok: false, reason: "This showcase has no Atlas listing — nothing to upgrade in place." };
  }
  if (!REPUBLISHABLE_STATES.includes(state)) {
    return {
      ok: false,
      reason:
        "Runtime upgrade is for an already-published showcase. Finish the current publish (Approve & Publish) first.",
    };
  }
  return { ok: true, reason: null };
}

/**
 * The showcase package input for a republish, built from the job's stored
 * curation draft — i.e. it reuses the existing Atlas curation/listing data, never
 * re-derives it. The generator stamps the current ATLAS_RUNTIME_VERSION into this
 * package, so a republish always deploys the current runtime.
 */
export function buildShowcaseInputFromJob(job) {
  const draft = job?.draft_payload ?? {};
  return {
    curationJobId: job?.id,
    matterportId: String(job?.extracted_matterport_id ?? "").trim(),
    title: draft.title,
    summary: draft.summary,
    category: draft.category,
    city: draft.city,
    region: draft.region,
    tags: draft.tags ?? [],
    heroImageUrl: draft.hero_image_url,
  };
}

/**
 * The slug a republish MUST reuse — the job's existing showcase folder. Reusing
 * the slug keeps the same `<slug>/` path and public URL; a republish never
 * derives a fresh slug (that would orphan the live listing's URL).
 */
export function resolveRepublishSlug(job) {
  return String(job?.showcase_slug ?? "").trim();
}

/**
 * The atlas_curation_jobs row update applied when a republish (upgrade) PR opens.
 * Sets the job back to pr_open so the existing Approve & Publish → merge → Netlify
 * verify → attach flow finishes it. Deliberately does NOT clear deployed_url (the
 * live URL stays attached until the new deploy verifies) and never writes to the
 * Atlas listing or its active/inactive state.
 */
export function buildRepublishJobUpdate(prResult) {
  return {
    showcase_slug: prResult.slug,
    publish_status: "pr_open",
    showcase_pr_url: prResult.prUrl,
    showcase_pr_number: prResult.prNumber,
    showcase_branch: prResult.branch,
    merged_at: null,
    publish_error: null,
  };
}
