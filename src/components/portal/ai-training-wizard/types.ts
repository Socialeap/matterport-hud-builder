/**
 * Shared types for the "Train Your Property's AI Chat" wizard.
 *
 * The wizard owns a single source-of-truth `WizardState` from open → close.
 * Step components mutate it via the `update()` callback exposed by the shell.
 * No persistence — all state lives in memory until the run completes.
 */

import type { CategoryKey } from "./profiles";

export type WizardStep = 1 | 2 | 3 | 4;

export type WizardSource =
  | { kind: "file"; file: File }
  | { kind: "vault"; assetId: string; label: string }
  | { kind: "url"; url: string }
  | null;

export type TrainingPhase =
  | "idle"
  | "reading"
  | "extracting"
  | "optimizing"
  | "ready"
  | "error";

export interface TrainingResult {
  /** vault_assets row id created (or reused) for this run. */
  vaultAssetId: string;
  /** vault_templates row id resolved (curated, cloned starter, or auto-induced). */
  templateId: string;
  /** Top-level field bag returned by extract-property-doc. */
  fields: Record<string, unknown>;
  /** Number of indexed text chunks. */
  chunkCount: number;
}

export interface WizardState {
  step: WizardStep;
  /** Selected property category card — drives template resolution. */
  profileCategory: CategoryKey | null;
  /** Resolved template id once Step 1 advances or Step 3 starts. */
  resolvedTemplateId: string | null;
  /** What the user picked in Step 2. */
  source: WizardSource;
  /** Phase of the long-running training pipeline (Step 3). */
  trainingPhase: TrainingPhase;
  /** Friendly error string when phase = "error". */
  errorCopy: string | null;
  /** Populated when training succeeds → drives Step 4. */
  result: TrainingResult | null;
}

export const INITIAL_STATE: WizardState = {
  step: 1,
  profileCategory: null,
  resolvedTemplateId: null,
  source: null,
  trainingPhase: "idle",
  errorCopy: null,
  result: null,
};
