/**
 * Wizard Modal — shell that hosts the 4 path components, renders the
 * progress indicator, and owns Next/Back/Save navigation.
 *
 * The draft state is owned here. Path components mutate it via `onChange`.
 * Save delegates back to the parent (which calls useVaultTemplates.create/update).
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JsonSchema } from "@/lib/extraction/provider";

import {
  PATH_STEP_COUNT,
  PATH_STEP_LABELS,
  PATH_TITLES,
  type WizardDraft,
  type WizardPath,
} from "./types";
import { SmartAIPath } from "./paths/SmartAIPath";
import { PdfPath } from "./paths/PdfPath";
import { LibraryPath } from "./paths/LibraryPath";
import { ManualPath } from "./paths/ManualPath";

export interface SavePayload {
  id: string | null;
  label: string;
  doc_kind: string;
  extractor: WizardDraft["extractor"];
  field_schema: JsonSchema;
}

interface Props {
  draft: WizardDraft | null;
  setDraft: (next: WizardDraft | null) => void;
  saving: boolean;
  onSave: (payload: SavePayload) => Promise<boolean | void>;
}

export function WizardModal({ draft, setDraft, saving, onSave }: Props) {
  const open = draft !== null;
  // The Smart-AI path wraps TemplateArchitect which has its own internal phases
  // (Describe → Refine → Finalized). Their "Apply to Editor" callback is what
  // tells us we can advance to the final step. To keep the global progress bar
  // honest, we collapse the AI path's internal phases into a single visual
  // "Build with AI" step + "Name & save" step — even though step counters are
  // 0/1/2 internally for compatibility with the shared structure.
  const totalSteps = draft ? PATH_STEP_COUNT[draft.path] : 0;
  const stepLabels = draft ? PATH_STEP_LABELS[draft.path] : [];

  const close = () => {
    if (saving) return;
    setDraft(null);
  };

  const update = (patch: Partial<WizardDraft>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
  };

  const goNext = () => {
    if (!draft) return;
    if (draft.step < totalSteps - 1) {
      setDraft({ ...draft, step: draft.step + 1 });
    }
  };

  const goBack = () => {
    if (!draft) return;
    if (draft.step > 0) {
      setDraft({ ...draft, step: draft.step - 1 });
    }
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.label.trim()) {
      toast.error("Map name required");
      return;
    }
    let schema: JsonSchema;
    try {
      schema = JSON.parse(draft.schema_text);
      if (schema.type !== "object" || !schema.properties) {
        throw new Error("schema must be { type: 'object', properties: {...} }");
      }
    } catch (err) {
      toast.error(
        `Invalid Field Blueprint: ${err instanceof Error ? err.message : "parse error"}`,
      );
      return;
    }
    const ok = await onSave({
      id: draft.id,
      label: draft.label.trim(),
      doc_kind: (draft.doc_kind || "general").trim(),
      extractor: draft.extractor,
      field_schema: schema,
    });
    if (ok !== false) close();
  };

  // Determine whether Next is disabled (each path has its own gate logic).
  const nextDisabled = useMemo(() => {
    if (!draft) return true;
    if (saving) return true;
    // Smart-AI path: schema must be present before advancing past step 1.
    if (draft.path === "ai" && draft.step < 2) {
      // Internal architect controls advancement; Next is always disabled for
      // these steps because the user advances by finishing inside Architect.
      return true;
    }
    // PDF path: step 0 advances only via "Detect fields" inside the path,
    // step 1 lets the user click Next to continue to review.
    if (draft.path === "pdf" && draft.step === 0) return true;
    // Library path: step 0 advances by picking a card.
    if (draft.path === "library" && draft.step === 0) return true;
    return false;
  }, [draft, saving]);

  if (!draft) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent />
      </Dialog>
    );
  }

  const isFinalStep = draft.step === totalSteps - 1;
  const currentStepLabel = stepLabels[draft.step] ?? "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {draft.id ? "Edit Property Map" : PATH_TITLES[draft.path]}
          </DialogTitle>
          <DialogDescription>
            {draft.id
              ? "Refine your existing map. Changes apply the next time a client uses it."
              : "A reusable blueprint your clients' AI Chat uses to pull facts from their uploaded property docs."}
          </DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        <ProgressBar
          totalSteps={totalSteps}
          currentStep={draft.step}
          labels={stepLabels}
          onJump={(idx) => setDraft({ ...draft, step: idx })}
        />

        <div className="min-h-[260px] py-2">
          {draft.path === "ai" && (
            <SmartAIPath
              draft={draft}
              onChange={update}
              onSchemaApplied={() => setDraft({ ...draft, step: 2 })}
              disabled={saving}
            />
          )}
          {draft.path === "pdf" && (
            <PdfPath
              draft={draft}
              onChange={update}
              onAdvance={() => setDraft({ ...draft, step: Math.max(draft.step + 1, 1) })}
              disabled={saving}
            />
          )}
          {draft.path === "library" && (
            <LibraryPath
              draft={draft}
              onChange={update}
              onAdvance={() => setDraft({ ...draft, step: 1 })}
              disabled={saving}
            />
          )}
          {draft.path === "manual" && (
            <ManualPath draft={draft} onChange={update} disabled={saving} />
          )}
        </div>

        <DialogFooter className="flex w-full items-center !justify-between gap-2 sm:!justify-between">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              Step {draft.step + 1} of {totalSteps}
            </span>
            <span>·</span>
            <span>{currentStepLabel}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={close}
              disabled={saving}
              className="h-8"
            >
              <X className="mr-1 size-3.5" /> Cancel
            </Button>
            {draft.step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={goBack}
                disabled={saving}
                className="h-8"
              >
                <ArrowLeft className="mr-1 size-3.5" /> Back
              </Button>
            )}
            {!isFinalStep && (
              <Button
                size="sm"
                onClick={goNext}
                disabled={nextDisabled}
                className="h-8"
              >
                Next <ArrowRight className="ml-1 size-3.5" />
              </Button>
            )}
            {isFinalStep && (
              <Button size="sm" onClick={handleSave} disabled={saving} className="h-8">
                {saving
                  ? "Saving…"
                  : draft.id
                    ? "Save Changes"
                    : "Create Map"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressBar({
  totalSteps,
  currentStep,
  labels,
  onJump,
}: {
  totalSteps: number;
  currentStep: number;
  labels: string[];
  onJump: (idx: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: totalSteps }).map((_, idx) => {
          const filled = idx <= currentStep;
          const isCurrent = idx === currentStep;
          const clickable = idx < currentStep;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => clickable && onJump(idx)}
              disabled={!clickable}
              title={labels[idx]}
              className={`h-1.5 flex-1 rounded-full transition ${
                filled
                  ? isCurrent
                    ? "bg-primary"
                    : "bg-primary/70 hover:bg-primary"
                  : "bg-muted"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// Re-export hook so the route can stay focused on data wiring.
export function usePreserveStep(draft: WizardDraft | null) {
  // Reserved for future enhancement (e.g. autosave). Currently no-op.
  useEffect(() => {
    /* no-op */
  }, [draft?.step]);
}
