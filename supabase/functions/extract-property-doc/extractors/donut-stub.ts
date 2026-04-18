// Donut (vision transformer) extractor — stubbed for Phase 2.
// Wired to the ExtractionProvider interface so swapping in a real
// model later is a one-file change.

import type { ExtractionProvider } from "./types.ts";

export const donutStub: ExtractionProvider = {
  id: "donut",
  version: "0.0.0-stub",
  extract() {
    return Promise.reject(
      new Error("not_implemented: donut extractor is deferred to Phase 2"),
    );
  },
};
