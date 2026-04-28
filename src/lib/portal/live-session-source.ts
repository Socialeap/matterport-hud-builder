// Server-side loader for the Live Guided Tour PeerJS controller.
//
// Reads `live-session.mjs` verbatim via Vite's `?raw` import (inlined
// at build time, works on both Node dev and Cloudflare Workers prod),
// strips its single trailing `export { ... }` block, and hands the
// result to portal.functions.ts which interpolates it into the outer
// IIFE of the generated standalone HTML — same pattern as the Ask AI
// runtime in ./ask-runtime-assembler.ts.

import liveSessionSource from "./live-session.mjs?raw";
import {
  findForbiddenTokens,
  stripExports,
} from "./ask-runtime-transformer.mjs";

let _cached: string | null = null;

/**
 * Build the Live Guided Tour runtime JS blob once per process. The
 * returned string is safe to inject as a child of an outer IIFE — all
 * declared symbols become locals there. Throws if the source contains
 * tokens that would break browser execution (TypeScript leaks, stray
 * imports, leftover module markers) so a regression in the .mjs is
 * caught before HTML generation rather than at runtime.
 */
export function getLiveSessionRuntimeJS(): string {
  if (_cached !== null) return _cached;
  const stripped = stripExports(liveSessionSource);
  const offenders = findForbiddenTokens(stripped);
  if (offenders.length > 0) {
    throw new Error(
      `live-session.mjs contains browser-unsafe tokens:\n  ${offenders.join("\n  ")}`,
    );
  }
  _cached = stripped;
  return stripped;
}

/**
 * Wire payload sent over the WebRTC DataChannel from Agent → Visitor.
 * The `ts` field on `incomingTeleportEvent` lets the visitor's UI
 * detect re-teleports to the same coordinates (different timestamp =
 * fire again).
 */
export interface LiveSessionTeleportEvent {
  ss: string;
  sr: string;
  ts: number;
}

export type LiveSessionRole = "agent" | "visitor" | null;
export type LiveSessionStatus =
  | "idle"
  | "initializing"
  | "waiting"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

export interface LiveSessionState {
  role: LiveSessionRole;
  status: LiveSessionStatus;
  pin: string | null;
  peerId: string | null;
  error: string | null;
  isConnected: boolean;
  remoteStream: MediaStream | null;
  incomingTeleportEvent: LiveSessionTeleportEvent | null;
}

/** Public API surface of the controller returned by `createLiveSession`. */
export interface LiveSessionController {
  getState(): LiveSessionState;
  subscribe(fn: (state: LiveSessionState) => void): () => void;
  initializeAsAgent(): Promise<{ pin: string; peerId: string }>;
  joinAsVisitor(pin: string): Promise<{ pin: string; peerId: string }>;
  teleportVisitor(ss: string, sr: string): boolean;
  dispose(): void;
}

