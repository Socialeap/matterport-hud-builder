import type { IntentLabel } from "./ask-intents";

export interface BrainAgent {
  name: string | null;
  titleRole: string | null;
  email: string | null;
  phone: string | null;
  welcomeNote: string | null;
  website: string | null;
  social: {
    linkedin: string | null;
    twitter: string | null;
    instagram: string | null;
    facebook: string | null;
    tiktok: string | null;
  };
}

export interface BrainActions {
  bookingUrl: string | null;
  officialWebsite: string | null;
  phone: string | null;
  email: string | null;
  directionsUrl: string | null;
  neighborhoodMapUrl: string | null;
}

export interface BrainCanonicalQA {
  id: string;
  field: string;
  question: string;
  answer: string;
  source_anchor_id: string;
  embedding: number[] | null;
  intents: IntentLabel[];
}

export interface BrainChunk {
  id: string;
  section: string;
  content: string;
  embedding: number[] | null;
  templateLabel: string;
  kind?: "raw_chunk" | "field_chunk";
  source?: string;
}

export interface BrainEntities {
  restaurants: Array<{ name: string; floor: string | null; raw: string }>;
  ballrooms: Array<{ name: string; capacity: string | null; raw: string }>;
  amenities: Array<{ name: string; raw: string }>;
  rooms: { count: number; raw: unknown } | null;
  floors: { count: number; raw: unknown } | null;
}

export interface PropertyBrain {
  propertyIndex: number;
  propertyUuid: string | null;
  propertyName: string;
  tourName: string;
  // Reserved for PR-2.
  sourceContextHash: null;
  presentationToken: null;
  address: string | null;
  directionsUrl: string | null;
  neighborhoodEnabled: boolean;
  agent: BrainAgent;
  actions: BrainActions;
  canonicalQAs: BrainCanonicalQA[];
  fields: Record<string, unknown>;
  fieldProvenance: Array<Record<string, unknown>>;
  entities: BrainEntities;
  chunks: BrainChunk[];
  curatedQAs: Array<{
    id: string;
    question: string;
    answer: string;
    source_anchor_id: string;
    embedding: number[];
  }>;
  hasDocs: boolean;
  hasQA: boolean;
  extractionTemplates: string[];
}

export interface BuildPropertyBrainInputs {
  propertyIndex: number;
  propertyUuid: string | null;
  configProperty: Record<string, unknown> | null;
  agent: Record<string, unknown>;
  brandName: string;
  extractionEntries: Array<{
    template_label?: string;
    fields?: Record<string, unknown>;
    chunks?: Array<{ id?: string; section?: string; content?: string; embedding?: number[] }>;
    canonical_qas?: Array<{
      id?: string;
      field?: string;
      question?: string;
      answer?: string;
      source_anchor_id?: string;
      embedding?: number[];
    }>;
    field_provenance?: Record<string, unknown>;
  }>;
  curatedQAs?: Array<{
    id: string;
    question: string;
    answer: string;
    source_anchor_id: string;
    embedding: number[];
  }>;
  hasDocs?: boolean;
  hasQA?: boolean;
  tagIntents?: (qa: { field?: string }) => IntentLabel[];
}

export function buildPropertyBrain(inputs: BuildPropertyBrainInputs): PropertyBrain;
