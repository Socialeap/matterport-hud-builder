export interface ShowcaseDeploymentOutcome {
  status: "published" | "pending_deploy";
  /** presentation_url to attach to atlas_entries (only when published). */
  attachUrl: string | null;
  jobUpdate: {
    publish_status: string;
    deployed_url: string;
    published_at?: string;
    publish_error: string | null;
  };
  reason: string | null;
}

export function planShowcaseDeploymentOutcome(
  verification: { ok: boolean; reason?: string | null },
  deployedUrl: string,
  nowIso: string,
): ShowcaseDeploymentOutcome;
