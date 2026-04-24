/**
 * Unified indexing status badge — used everywhere we need to surface
 * "is this property's Ask AI ready?" so the UX is identical across
 * PropertyDocsPanel and PropertyIntelligenceSection.
 *
 * Reads from the shared `IndexingProvider` so two badges for the same
 * property always show the same thing at the same time.
 */
import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIndexing } from "@/lib/rag/indexing-context";

interface Props {
  propertyUuid: string | null;
  /** Disable the retry button (e.g., property is frozen or another
   *  extraction is currently running). */
  disableRetry?: boolean;
  /** Compact rendering for header strips. */
  compact?: boolean;
}

const SLOW_THRESHOLD_MS = 30_000;

/** Rotating phrasings while indexing — helps diagnose where a stuck
 *  spinner is actually stuck from a screenshot. */
function rotatingMessage(message: string | null, tick: number): string {
  if (message) return message;
  const phrases = ["Preparing model…", "Embedding chunks…", "Saving…"];
  return phrases[tick % phrases.length];
}

export function IndexingStatusBadge({
  propertyUuid,
  disableRetry,
  compact,
}: Props) {
  const indexing = useIndexing();
  const status = indexing.statusFor(propertyUuid);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Tick every 2.5s while indexing so the rotating phrasing actually
  // rotates and the "taking longer than usual" hint can appear.
  useEffect(() => {
    if (status.phase !== "indexing") return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setNow(Date.now());
    }, 2500);
    return () => clearInterval(id);
  }, [status.phase]);

  if (!propertyUuid || status.phase === "idle") return null;

  if (status.phase === "indexing") {
    const elapsed = status.startedAt ? now - status.startedAt : 0;
    const slow = elapsed > SLOW_THRESHOLD_MS;
    return (
      <TooltipProvider delayDuration={150}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
          <Loader2 className="size-3 animate-spin" />
          <span className="max-w-[200px] truncate">
            {rotatingMessage(status.message, tick)}
          </span>
          {slow && !compact && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="ml-0.5 underline decoration-dotted underline-offset-2 hover:text-primary/80"
                  onClick={() => indexing.requestForce(propertyUuid)}
                >
                  Taking longer than usual?
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                The embedding model can take 30–60s to download the first
                time. Click to restart from scratch if it appears stuck.
              </TooltipContent>
            </Tooltip>
          )}
        </span>
      </TooltipProvider>
    );
  }

  if (status.phase === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="size-3" />
        Ready for Ask AI
      </span>
    );
  }

  // failed
  return (
    <TooltipProvider delayDuration={150}>
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
        <AlertCircle className="size-3" />
        <span>Indexing failed</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 gap-1 px-1.5 text-[10px] text-destructive hover:bg-destructive/20 hover:text-destructive"
              onClick={() => indexing.requestForce(propertyUuid)}
              disabled={disableRetry}
            >
              <RefreshCw className="size-2.5" />
              Retry
            </Button>
          </TooltipTrigger>
          {status.message && (
            <TooltipContent className="max-w-xs text-xs">
              {status.message}
            </TooltipContent>
          )}
        </Tooltip>
      </span>
    </TooltipProvider>
  );
}
