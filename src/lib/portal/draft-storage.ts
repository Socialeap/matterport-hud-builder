/**
 * Client-side draft storage for in-progress Presentation configurations.
 *
 * Saves all serializable builder state to localStorage so users don't lose
 * progress if they close the tab or browser. Files (logo, favicon, avatar)
 * are intentionally NOT persisted in v1 — users re-upload on resume.
 *
 * Zero backend involvement. All data stays in the user's browser.
 */
import type { PropertyModel, AgentContact, TourBehavior } from "@/components/portal/types";
import type { EnhancementsByProperty } from "@/components/portal/EnhancementsSection";

const DRAFT_VERSION = 1;
const KEY_PREFIX = "3dps:draft:";

export interface DraftAccessState {
  passwordProtected: boolean;
  /**
   * Plaintext password persisted to localStorage for agent convenience.
   * NEVER sent to the server or persisted in saved_models.tour_config.
   * The Builder UI surfaces a warning that anyone with browser access
   * can read this value.
   */
  password: string;
  passwordHint: string;
}

export interface DraftState {
  brandName: string;
  accentColor: string;
  hudBgColor: string;
  gateLabel: string;
  models: PropertyModel[];
  behaviors: Record<string, TourBehavior>;
  agent: AgentContact;
  reviewApproved: boolean;
  /**
   * Per-property Vault asset selections. Optional for backwards compatibility
   * with drafts saved before the Enhancements panel shipped.
   */
  enhancements?: EnhancementsByProperty;
  /**
   * Optional password-gate config. Optional for backwards compatibility with
   * drafts saved before the Privacy & Access panel shipped — when missing,
   * the presentation is unprotected.
   */
  access?: DraftAccessState;
  /**
   * Brand asset persistence (optional, backwards-compatible). Data URLs let
   * the preview survive a reload without forcing the user to re-upload.
   * Storage URLs (when present) point to the permanent brand-assets bucket
   * copy and take precedence over the data URL for both display and
   * generation. Both are scrubbed when the asset is removed.
   */
  logoDataUrl?: string | null;
  faviconDataUrl?: string | null;
  logoStorageUrl?: string | null;
  faviconStorageUrl?: string | null;
}

interface DraftEnvelope {
  version: number;
  savedAt: string;
  data: DraftState;
}

function storageKey(providerSlug: string): string {
  return `${KEY_PREFIX}${providerSlug || "default"}`;
}

/** Strip transient blob: avatar URLs which won't survive a reload. */
function sanitizeForStorage(state: DraftState): DraftState {
  const cleanAgent = state.agent.avatarUrl?.startsWith("blob:")
    ? { ...state.agent, avatarUrl: "" }
    : state.agent;
  return { ...state, agent: cleanAgent };
}

export function saveDraft(providerSlug: string, state: DraftState): void {
  try {
    const envelope: DraftEnvelope = {
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
      data: sanitizeForStorage(state),
    };
    localStorage.setItem(storageKey(providerSlug), JSON.stringify(envelope));
  } catch (err) {
    console.warn("[draft-storage] Failed to save draft:", err);
  }
}

export function loadDraft(providerSlug: string): { data: DraftState; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(storageKey(providerSlug));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as DraftEnvelope;
    if (envelope.version !== DRAFT_VERSION) return null;
    if (!envelope.data) return null;
    return { data: envelope.data, savedAt: envelope.savedAt };
  } catch (err) {
    console.warn("[draft-storage] Failed to load draft:", err);
    return null;
  }
}

export function clearDraft(providerSlug: string): void {
  try {
    localStorage.removeItem(storageKey(providerSlug));
  } catch (err) {
    console.warn("[draft-storage] Failed to clear draft:", err);
  }
}

export function exportDraftFile(providerSlug: string, state: DraftState): void {
  const envelope: DraftEnvelope = {
    version: DRAFT_VERSION,
    savedAt: new Date().toISOString(),
    data: sanitizeForStorage(state),
  };
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.download = `${providerSlug || "presentation"}-draft-${stamp}.3dps-draft.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importDraftFile(file: File): Promise<DraftState | null> {
  try {
    const text = await file.text();
    const envelope = JSON.parse(text) as DraftEnvelope;
    if (envelope.version !== DRAFT_VERSION) {
      throw new Error(`Unsupported draft version: ${envelope.version}`);
    }
    if (!envelope.data) throw new Error("Draft file is missing data");
    return envelope.data;
  } catch (err) {
    console.error("[draft-storage] Failed to import draft:", err);
    return null;
  }
}
