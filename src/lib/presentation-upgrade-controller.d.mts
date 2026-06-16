// Type declarations for presentation-upgrade-controller.mjs.

import type {
  InspectionReport,
  UpgradeReport,
  DownloadPayload,
  UpgradeSessionResult,
  LegacyBootstrapReport,
  LegacyProfileReport,
} from "./presentation-upgrade-session.mjs";

export interface UpgradeControllerState {
  fileName?: string | null;
  fileSize?: number | null;
  inspection?: InspectionReport | null;
  /** Set when the inspection is legacy_unsupported but a bootstrap profile matched. */
  legacyProfile?: LegacyProfileReport | null;
  report?: UpgradeReport | LegacyBootstrapReport | null;
  download?: DownloadPayload | null;
  error?: string | null;
  reading?: boolean;
  upgrading?: boolean;
  /** The raw uploaded HTML (held in a ref by the route — never rendered). */
  html?: string | null;
}

export interface UpgradeControllerSink {
  /** Apply a partial state patch (only called for the current session). */
  setState(partial: UpgradeControllerState): void;
  toastSuccess(message: string): void;
  toastError(message: string): void;
}

export interface BundledRuntimeSources {
  liveSessionJs: string;
  annoInputJs: string;
}

export interface UpgradeController {
  /** Read + inspect a file; invalidates any prior read/upgrade. */
  select(file: {
    name?: unknown;
    type?: unknown;
    size?: unknown;
    text?: () => Promise<string>;
  }): Promise<void>;
  /** Invalidate every pending operation and reset to the blank state. */
  clear(): void;
  /** Upgrade the captured bytes/session; a newer select/clear discards it. */
  upgrade(args: {
    html: string;
    filename?: string | null;
    getRuntimeSources: () => BundledRuntimeSources;
  }): Promise<void>;
  /** Test/diagnostic only: the current monotonic session token. */
  currentSession(): number;
}

export declare function createUpgradeController(deps: {
  checkSize: (size: number) => { ok: boolean; message: string };
  readFile: (file: unknown) => Promise<string>;
  runUpgrade: (args: {
    filename?: string | null;
    html: string;
    runtimeSources: BundledRuntimeSources;
  }) => Promise<UpgradeSessionResult>;
  sink: UpgradeControllerSink;
}): UpgradeController;
