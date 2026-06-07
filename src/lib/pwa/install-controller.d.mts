// Type surface for install-controller.mjs (dual-import pattern, same as
// the other runtime .mjs modules in this repo).

export declare const STORAGE_KEY: string;
export declare const DISMISS_COOLDOWN_MS: number;
export declare const RETURN_VISIT_THRESHOLD: number;

export interface InstallStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PromoteOptions {
  standalone?: boolean;
  engagedNow?: boolean;
  now?: number;
}

export declare function recordVisit(storage: InstallStorage | null): number;
export declare function recordEngagement(storage: InstallStorage | null): void;
export declare function recordDismissal(storage: InstallStorage | null, now: number): void;
export declare function isInCooldown(storage: InstallStorage | null, now: number): boolean;
export declare function shouldPromote(storage: InstallStorage | null, opts: PromoteOptions): boolean;
