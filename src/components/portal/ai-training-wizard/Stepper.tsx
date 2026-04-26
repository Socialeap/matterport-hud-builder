import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import type { WizardStep } from "./types";

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 1, label: "Profile" },
  { id: 2, label: "Source" },
  { id: 3, label: "Training" },
  { id: 4, label: "Verify" },
];

interface Props {
  current: WizardStep;
  /** When true, the connecting line of the active step pulses. */
  pulsing?: boolean;
}

/**
 * Shadcn-styled, accessible 4-dot stepper for the AI Training wizard.
 * Past steps render as filled checks, current is the accent dot, future
 * are muted outlines. The connector turns to the primary color once a
 * step is complete; pulses while the current step is "working".
 */
export function WizardStepper({ current, pulsing }: Props) {
  return (
    <ol
      className="flex w-full items-center gap-1.5 px-1"
      aria-label="AI training progress"
    >
      {STEPS.map((step, idx) => {
        const isDone = step.id < current;
        const isCurrent = step.id === current;
        const isLast = idx === STEPS.length - 1;
        return (
          <li
            key={step.id}
            className="flex flex-1 items-center gap-1.5"
            aria-current={isCurrent ? "step" : undefined}
          >
            <div className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-full border text-[11px] font-medium transition-colors",
                  isDone &&
                    "border-primary bg-primary text-primary-foreground",
                  isCurrent &&
                    "border-primary bg-primary/15 text-primary ring-2 ring-primary/30",
                  !isDone &&
                    !isCurrent &&
                    "border-border bg-background text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3.5" /> : step.id}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium uppercase tracking-wide",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
            {!isLast && (
              <span
                className={cn(
                  "mb-4 h-px flex-1 rounded-full transition-colors",
                  isDone
                    ? "bg-primary"
                    : isCurrent && pulsing
                      ? "animate-pulse bg-primary/60"
                      : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
