export type IntentLabel =
  | "booking"
  | "contact_agent"
  | "location"
  | "neighborhood"
  | "amenity_presence"
  | "amenity_count"
  | "rooms_count"
  | "ballrooms_count"
  | "restaurant_presence"
  | "restaurant_count"
  | "restaurant_location"
  | "floor_level"
  | "history_opening"
  | "year_built"
  | "designer_architect"
  | "developer"
  | "pricing"
  | "availability"
  | "parking"
  | "accessibility"
  | "summary"
  | "comparison"
  | "unknown";

export interface FieldCompatRule {
  allow: RegExp[];
  exclude: RegExp[];
}

export interface IntentClassification {
  intent: IntentLabel;
  confidence: number;
  tokens: string[];
}

export const FIELD_COMPAT: Record<IntentLabel, FieldCompatRule>;
export const INTENT_PATTERNS: Array<{ intent: IntentLabel; patterns: RegExp[] }>;
export const ACTION_INTENTS: Partial<Record<IntentLabel, true>>;
export function normalizeQuery(q: string): string;
export function tokenizeQuery(q: string): string[];
export function classifyIntent(q: string): IntentClassification;
export function intentAllows(fieldName: string, intent: IntentLabel | string): boolean;
export function tagQAIntents(qa: { field?: string }): IntentLabel[];
export function isActionIntent(intent: IntentLabel | string): boolean;
