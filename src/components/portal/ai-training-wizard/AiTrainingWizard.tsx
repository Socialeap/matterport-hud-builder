import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ProfileStep } from "./steps/ProfileStep";
import { SourceStep } from "./steps/SourceStep";
import { TrainingStep } from "./steps/TrainingStep";
import { VerifyStep } from "./steps/VerifyStep";
import { WizardStepper } from "./Stepper";
import { INITIAL_STATE, type TrainingPhase, type TrainingResult, type WizardState } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  propertyUuid: string;
  propertyName: string;
  savedModelId: string | null;
  /** Fired after a successful training run so the parent panel can refresh. */
  onComplete?: () => void;
}

/**
 * "Train Your Property's AI Chat" — a 4-step results-focused wizard that
 * replaces the legacy Upload + From-vault + Run-Extraction flow with a
 * single guided journey.
 *
 * State is local (`useState`) and resets each time the modal opens so the
 * user always starts at Step 1 with a clean slate.
 */
export function AiTrainingWizard({
  open,
  onOpenChange,
  propertyUuid,
  propertyName,
  savedModelId,
  onComplete,
}: Props) {
  const [state, setState] = useState<WizardState>(INITIAL_STATE);

  // Reset state every time the modal closes so re-opens are clean.
  useEffect(() => {
    if (!open) {
      // Slight defer so closing animation can play with stable content.
      const t = setTimeout(() => setState(INITIAL_STATE), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const update = (patch: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const goTo = (step: 1 | 2 | 3 | 4) => update({ step });

  const handleTrainingPhaseChange = (
    trainingPhase: TrainingPhase,
    errorCopy?: string | null,
  ) => {
    update({ trainingPhase, errorCopy: errorCopy ?? null });
  };

  const handleTrainingComplete = (result: TrainingResult) => {
    update({ result, trainingPhase: "ready", errorCopy: null });
    // Auto-advance to verification after a brief pause so the success
    // state on Step 3 is visible.
    setTimeout(() => {
      setState((prev) => ({ ...prev, step: 4 }));
    }, 600);
    onComplete?.();
  };

  const handleClose = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-4">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <BookOpen className="size-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">
                Train your AI Chat Assistant
              </DialogTitle>
              <DialogDescription className="text-xs">
                Teach the AI to answer questions about{" "}
                <strong className="text-foreground">{propertyName}</strong>.
              </DialogDescription>
            </div>
          </div>
          <WizardStepper
            current={state.step}
            pulsing={
              state.trainingPhase === "reading" ||
              state.trainingPhase === "extracting" ||
              state.trainingPhase === "optimizing"
            }
          />
        </DialogHeader>

        <div className="min-h-[280px]">
          {state.step === 1 && (
            <ProfileStep
              selected={state.profileCategory}
              onSelect={(key) => update({ profileCategory: key })}
              onContinue={() => goTo(2)}
              propertyName={propertyName}
            />
          )}
          {state.step === 2 && (
            <SourceStep
              source={state.source}
              onChange={(source) => update({ source })}
              onBack={() => goTo(1)}
              onContinue={() => goTo(3)}
            />
          )}
          {state.step === 3 && (
            <TrainingStep
              state={state}
              propertyUuid={propertyUuid}
              propertyName={propertyName}
              savedModelId={savedModelId}
              onPhaseChange={handleTrainingPhaseChange}
              onComplete={handleTrainingComplete}
              onBack={() => {
                // Only allow back when not actively running.
                if (
                  state.trainingPhase === "reading" ||
                  state.trainingPhase === "extracting" ||
                  state.trainingPhase === "optimizing"
                ) {
                  return;
                }
                update({ trainingPhase: "idle", errorCopy: null });
                goTo(2);
              }}
            />
          )}
          {state.step === 4 && state.result && (
            <VerifyStep
              result={state.result}
              propertyName={propertyName}
              onClose={handleClose}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
