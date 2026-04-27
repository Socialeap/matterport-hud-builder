import type { IntentLabel } from "./ask-intents";
import type { PropertyBrain, BrainCanonicalQA, BrainChunk } from "./property-brain";

export const TIER1_SOFT: number;
export const TIER1_FLOOR: number;
export const TIER1_FIELD_BOOST: number;
export const TIER2_MIN: number;
export const RAW_CHUNK_DIRECT_FLOOR: number;
export const RRF_K: number;
export const ACTION_MISS_COPY: Record<string, string>;
export const STRICT_UNKNOWN_COPY: string;

export type AskPath =
  | "action"
  | "canonical"
  | "curated"
  | "chunk"
  | "synthesis"
  | "strict_unknown"
  | "unknown";

export interface CuratedHit {
  id?: string;
  question?: string;
  answer: string;
  source_anchor_id?: string;
  field?: string;
  score: number;
}

export interface ChunkHit {
  id: string;
  parentId?: string;
  source?: string;
  section?: string;
  content: string;
  templateLabel?: string;
  score: number;
  /** Phase A — present when the chunk was emitted by an extractor that
   *  participates in the metadata contract (pdfjs-heuristic, groq-
   *  cleaner). Older rows leave it undefined; the runtime treats
   *  missing as `raw_chunk`. */
  kind?: "raw_chunk" | "field_chunk";
}

export interface Tier1Scored {
  qa: BrainCanonicalQA;
  score: number;
}

export interface ActionResolution {
  path: "action";
  intent: IntentLabel | string;
  text: string;
  href: string | null;
  sourceLabel: string;
}

export interface AskDecision {
  path: AskPath;
  text: string;
  intent: IntentLabel | string;
  strictUnknown: boolean;
  needsSynthesis: boolean;
  synthChunks: Array<{ id: string; section: string; content: string; score: number }>;
  sourceLabel?: string | null;
  anchorId?: string | null;
  href?: string | null;
}

export interface DecideAnswerInputs {
  brain: PropertyBrain;
  query: string;
  queryVec: number[] | null;
  intent: IntentLabel | string;
  intentAllows: (field: string, intent: string) => boolean;
  curatedHits?: CuratedHit[];
  chunkHits?: ChunkHit[];
  canSynthesize?: boolean;
}

export function rrf(
  tier1List: Tier1Scored[],
  tier3List: ChunkHit[],
): Array<{ kind: "tier1" | "tier3"; rank: number; score: number; item: Tier1Scored | ChunkHit }>;

export function resolveAction(
  brain: PropertyBrain,
  intent: IntentLabel | string,
): ActionResolution | null;

export function tier1Rank(
  queryVec: number[] | null,
  query: string,
  canonicalQAs: BrainCanonicalQA[],
  intent: IntentLabel | string,
  intentAllows: (field: string, intent: string) => boolean,
): Tier1Scored[];

export function curatedFilter(
  hits: CuratedHit[],
  intent: IntentLabel | string,
  intentAllows: (field: string, intent: string) => boolean,
): CuratedHit[];

export function rescoreChunksByIntent(
  chunks: ChunkHit[],
  intent: IntentLabel | string,
  intentAllows: (field: string, intent: string) => boolean,
): Array<ChunkHit & { _intentAllowed?: boolean; _intentMatched?: boolean }>;

export function assembleSynthChunks(
  tier3: ChunkHit[],
  tier1: Tier1Scored[],
): Array<{ id: string; section: string; content: string; score: number }>;

export function decideAnswer(inputs: DecideAnswerInputs): AskDecision;
