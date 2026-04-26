import { useMemo, useState } from "react";
import { CheckCircle2, MessageCircleQuestion, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import { fieldToQuestion } from "../friendly-errors";
import type { TrainingResult } from "../types";

interface Props {
  result: TrainingResult;
  propertyName: string;
  onClose: () => void;
}

/**
 * Step 4 — the payoff. Big green confirmation card listing what the AI
 * learned plus 3 auto-generated suggested questions. A "Test now" button
 * reveals an inline preview of one of those answers using the already-
 * extracted facts (no extra round-trip needed).
 */
export function VerifyStep({ result, propertyName, onClose }: Props) {
  const [testOpen, setTestOpen] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  const populatedEntries = useMemo(
    () =>
      Object.entries(result.fields).filter(([, v]) => {
        if (v === null || v === undefined) return false;
        if (typeof v === "string" && v.trim() === "") return false;
        return true;
      }),
    [result.fields],
  );

  const fieldCount = populatedEntries.length;

  // Pick 3 high-signal suggested questions from extracted keys.
  const suggested = useMemo(() => {
    return populatedEntries
      .slice(0, 8)
      .map(([key, value]) => ({
        key,
        question: fieldToQuestion(key),
        answer: value,
      }))
      .slice(0, 3);
  }, [populatedEntries]);

  const activeAnswer = useMemo(() => {
    if (!activeQuestion) return null;
    const hit = suggested.find((s) => s.question === activeQuestion);
    if (!hit) return null;
    const v = hit.answer;
    if (typeof v === "boolean") return v ? "Yes." : "No.";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  }, [activeQuestion, suggested]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <CheckCircle2 className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">
              Your AI is now familiar with{" "}
              <span className="text-emerald-700 dark:text-emerald-300">
                {propertyName}
              </span>
              .
            </p>
            <p className="text-xs leading-snug text-muted-foreground">
              It learned <strong className="text-foreground">{fieldCount}</strong>{" "}
              fact{fieldCount === 1 ? "" : "s"} and indexed{" "}
              <strong className="text-foreground">{result.chunkCount}</strong>{" "}
              context chunk{result.chunkCount === 1 ? "" : "s"} for instant
              Q&amp;A on your published tour.
            </p>
          </div>
        </div>
      </div>

      {suggested.length > 0 && (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <Sparkles className="size-3 text-primary" />
            Try asking your AI:
          </p>
          <ul className="space-y-1.5">
            {suggested.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => {
                    setTestOpen(true);
                    setActiveQuestion(s.question);
                  }}
                  className="flex w-full items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5"
                >
                  <MessageCircleQuestion className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <span className="text-foreground">{s.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {testOpen && (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
            Preview answer
          </p>
          {activeQuestion ? (
            <>
              <p className="text-xs font-medium text-foreground">
                {activeQuestion}
              </p>
              <div className="rounded bg-background/70 p-2 text-xs text-foreground">
                {activeAnswer ?? "Tap a question above to see the answer."}
              </div>
              <p className="text-[10px] leading-snug text-muted-foreground">
                Your AI will compose richer, conversational answers for live
                visitors using the same indexed knowledge.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pick a suggested question above to preview the answer.
            </p>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="text-[10px]">
          AI Profile applied · {fieldCount} field{fieldCount === 1 ? "" : "s"}
        </Badge>
        <div className="flex items-center gap-2">
          {!testOpen && suggested.length > 0 && (
            <Button variant="outline" onClick={() => setTestOpen(true)}>
              Test now
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
