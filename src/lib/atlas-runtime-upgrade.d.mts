import type { CuratedPackageInput } from "./atlas-curation-server";

export type ShowcaseRuntimeStatus =
  | "upgrade_available"
  | "current"
  | "ahead_of_build"
  | "unknown";

export interface ShowcaseRuntimeInfo {
  deployedRuntime: string | null;
  currentRuntime: string;
  upgradeAvailable: boolean;
  status: ShowcaseRuntimeStatus;
  reason: string | null;
}

export interface RepublishGate {
  ok: boolean;
  reason: string | null;
}

export interface RepublishPrResult {
  slug: string;
  prUrl: string;
  prNumber: number;
  branch: string;
}

export interface RepublishJobUpdate {
  showcase_slug: string;
  publish_status: "pr_open";
  showcase_pr_url: string;
  showcase_pr_number: number;
  showcase_branch: string;
  merged_at: null;
  publish_error: null;
}

export function parseRuntimeVersion(v: unknown): [number, number, number] | null;

export function compareRuntimeVersions(a: unknown, b: unknown): -1 | 0 | 1 | null;

export function computeShowcaseRuntimeStatus(
  deployedRuntime: string | null | undefined,
  currentRuntime: string,
): ShowcaseRuntimeInfo;

export function canRepublishShowcase(job: unknown): RepublishGate;

export function buildShowcaseInputFromJob(job: unknown): CuratedPackageInput;

export function resolveRepublishSlug(job: unknown): string;

export function buildRepublishJobUpdate(prResult: RepublishPrResult): RepublishJobUpdate;
