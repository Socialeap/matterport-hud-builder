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

/**
 * Normalized [0,1] cursor position from the agent. `x` / `y` are
 * `null` when the agent's pointer leaves the annotation surface —
 * the visitor hides its remote-pointer indicator in that case.
 */
export interface LiveSessionPointerEvent {
  viewKey: string;
  seq: number;
  x: number | null;
  y: number | null;
  ts: number;
}

/**
 * Incremental stroke update from the agent. `kind` is the lifecycle
 * stage: `begin` opens a stroke (carrying color/width and the first
 * point), `patch` appends more points, `commit` seals the stroke.
 * All points are normalized [0,1] tuples relative to the letterbox.
 */
export interface LiveSessionStrokeEvent {
  kind: "begin" | "patch" | "commit";
  viewKey: string;
  seq: number;
  strokeId: string;
  ts: number;
  color?: string;
  width?: number;
  points?: Array<[number, number]>;
}

/**
 * Agent → Visitor "wipe the canvas" event. Visitor drops all stored
 * strokes whose viewKey matches. Distinct from teleport-triggered
 * auto-clear (handled locally on both sides).
 */
export interface LiveSessionClearEvent {
  viewKey: string;
  seq: number;
  ts: number;
}

/**
 * Agent → Visitor navigation lock toggle. While `locked` is true the
 * visitor should swallow pointer/touch input on the Matterport iframe
 * so the agent's annotations stay aligned to the current sweep. The
 * visitor unlocks automatically when a `nav_lock` with `locked:false`
 * arrives, when the agent leaves the annotation tool, or when the
 * session tears down. Never used to lock the agent's own view.
 */
export interface LiveSessionNavLockEvent {
  viewKey: string;
  locked: boolean;
  seq: number;
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
  incomingPointerEvent: LiveSessionPointerEvent | null;
  incomingStrokeEvent: LiveSessionStrokeEvent | null;
  incomingClearEvent: LiveSessionClearEvent | null;
}

/** Public API surface of the controller returned by `createLiveSession`. */
export interface LiveSessionController {
  getState(): LiveSessionState;
  subscribe(fn: (state: LiveSessionState) => void): () => void;
  initializeAsAgent(): Promise<{ pin: string; peerId: string }>;
  joinAsVisitor(pin: string): Promise<{ pin: string; peerId: string }>;
  teleportVisitor(ss: string, sr: string): boolean;
  sendPointer(viewKey: string, x: number | null, y: number | null): boolean;
  sendStrokeBegin(
    viewKey: string,
    strokeId: string,
    color: string,
    width: number,
    points: Array<[number, number]>,
  ): boolean;
  sendStrokePatch(
    viewKey: string,
    strokeId: string,
    points: Array<[number, number]>,
  ): boolean;
  sendStrokeCommit(viewKey: string, strokeId: string): boolean;
  sendClear(viewKey: string): boolean;
  dispose(): void;
}

