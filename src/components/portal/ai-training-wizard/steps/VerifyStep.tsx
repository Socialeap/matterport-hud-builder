import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleAlert,
  MessageCircleQuestion,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  describeIntelligenceHealth,
  hasAnyIntelligence,
} from "@/lib/intelligence/health";

import { fieldToQuestion } from "../friendly-errors";
import type { TrainingResult } from "../types";

interface Props {
  result: TrainingResult;
  propertyName: string;
  onClose: () => void;
}

/**
 * Step 4 — the verification screen. Renders status-aware copy from the
 * intelligence_health envelope returned by the edge function. The old
 * unconditional green-card-with-checkmark is gone: a property whose
 * status is `context_only_degraded` cannot show success copy, and a
 * `failed` status falls through to a clear failure UI with a retry CTA.
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

  const health = result.intelligenceHealth;
  const copy = describeIntelligenceHealth(health, propertyName);
  const status = health?.status ?? "failed";

  // Visual: success card only when status === 'ready'. Anything else
  // gets a tone-appropriate banner. The status enum drives the colour
  // scheme so we never accidentally render success state for empty
  // extractions.
  const tone = copy.tone;
  const cardClasses =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/5"
        : "border-destructive/30 bg-destructive/5";
  const iconBgClasses =
    tone === "success"
      ? "bg-emerald-500 text-white"
      : tone === "warning"
        ? "bg-amber-500 text-white"
        : "bg-destructive text-destructive-foreground";
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "warning"
        ? CircleAlert
        : AlertTriangle;
  const headingTint =
    tone === "success"
      ? "text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
        : "text-destructive";

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-4 ${cardClasses}`}>
        <div className="flex items-start gap-3">
          <div
            className={`flex size-10 shrink-0 items-center justify-center rounded-full ${iconBgClasses}`}
          >
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {copy.heading.replace(propertyName, "")}{" "}
              <span className={headingTint}>{propertyName}</span>
            </p>
            <p className="text-xs leading-snug text-muted-foreground">
              {copy.detail}
            </p>
            {copy.nextAction && (
              <p className="pt-1 text-xs leading-snug text-foreground">
                <strong>Next:</strong> {copy.nextAction}
              </p>
            )}
            {health && health.warnings.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
                {health.warnings.slice(0, 3).map((w) => (
                  <li key={w}>• {humaniseWarning(w)}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Suggested questions only render when there's actually
          structured intelligence to ask about. */}
      {hasAnyIntelligence(health) && suggested.length > 0 && (
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
        <Badge
          variant={status === "ready" ? "outline" : "secondary"}
          className="text-[10px]"
        >
          {statusToBadge(status, fieldCount)}
        </Badge>
        <div className="flex items-center gap-2">
          {!testOpen && suggested.length > 0 && hasAnyIntelligence(health) && (
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

function statusToBadge(status: string, fieldCount: number): string {
  switch (status) {
    case "ready":
      return `AI Profile applied · ${fieldCount} field${
        fieldCount === 1 ? "" : "s"
      }`;
    case "degraded":
      return `Indexing in progress · ${fieldCount} field${
        fieldCount === 1 ? "" : "s"
      }`;
    case "context_only_degraded":
      return "Context-only · 0 structured fields";
    case "failed":
    default:
      return "Training did not complete";
  }
}

function humaniseWarning(code: string): string {
  switch (code) {
    case "thin_content":
      return "The source had very little text — answer quality may be limited.";
    case "structuring_skipped_no_llm_key":
      return "The structuring model wasn't available; only deterministic patterns were applied.";
    case "structuring_parse_failed":
      return "The structuring model returned an unparseable response — fell back to deterministic patterns.";
    case "structuring_provider_error":
      return "The structuring model returned an error — fell back to deterministic patterns.";
    case "zero_structured_fields_extracted":
      return "No structured facts were detected. Visitors can ask open questions but specific values may not be returned.";
    case "low_field_count":
      return "Few facts were detected. Add a richer source for stronger answers.";
    default:
      return code.replace(/_/g, " ");
  }
}
