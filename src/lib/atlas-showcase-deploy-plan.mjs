// Pure decision helper for the Atlas curated-showcase deploy → attach flow.
//
// Given the result of verifyDeployedShowcase() and the resolved deployed URL,
// decide what the curation job + Atlas listing should become — WITHOUT touching
// the database, GitHub, or Netlify. Shared by the auto-poll server fn
// (pollShowcaseDeployment) so the transition rules are unit-testable in
// isolation and can never drift from the wiring.
//
// Invariants this encodes:
//   - A showcase is only "published" (and only attaches presentation_url) when
//     verification.ok is true — never on an unreachable/unverified URL.
//   - A not-yet-live deploy stays "pending_deploy" (retryable) and is NEVER
//     flipped to "failed" just for being slow. (Auto-poll must be non-destructive.)
//   - The deployed URL is remembered on the job as a target even while pending,
//     but is only attached to the listing once verified.

/**
 * @param {{ ok: boolean, reason?: string|null }} verification - verifyDeployedShowcase() result
 * @param {string} deployedUrl - the resolved canonical showcase URL
 * @param {string} nowIso - ISO timestamp for published_at (pass new Date().toISOString())
 * @returns {{
 *   status: "published" | "pending_deploy",
 *   attachUrl: string | null,            // presentation_url to attach to atlas_entries (only when published)
 *   jobUpdate: { publish_status: string, deployed_url: string, published_at?: string, publish_error: string|null },
 *   reason: string | null,
 * }}
 */
export function planShowcaseDeploymentOutcome(verification, deployedUrl, nowIso) {
  if (verification && verification.ok === true) {
    return {
      status: "published",
      attachUrl: deployedUrl,
      jobUpdate: {
        publish_status: "published",
        deployed_url: deployedUrl,
        published_at: nowIso,
        publish_error: null,
      },
      reason: null,
    };
  }

  const reason = (verification && verification.reason) || "Netlify deploy not confirmed yet.";
  return {
    status: "pending_deploy",
    attachUrl: null,
    jobUpdate: {
      // Deliberately NOT "failed" — a slow deploy stays retryable.
      publish_status: "pending_deploy",
      deployed_url: deployedUrl, // remembered target only; not attached to the listing yet
      publish_error: `Netlify deploy not verified yet — ${reason} Auto-retrying; or click “Retry deploy & attach”.`,
    },
    reason,
  };
}
