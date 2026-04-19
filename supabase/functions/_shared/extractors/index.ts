import type { ExtractionProvider, ExtractorId } from "./types.ts";
import { pdfjsHeuristic } from "./pdfjs-heuristic.ts";
import { donutStub } from "./donut-stub.ts";

const REGISTRY: Record<ExtractorId, ExtractionProvider> = {
  pdfjs_heuristic: pdfjsHeuristic,
  donut: donutStub,
};

export function getProvider(id: ExtractorId): ExtractionProvider {
  const p = REGISTRY[id];
  if (!p) throw new Error(`Unknown extractor: ${id}`);
  return p;
}
