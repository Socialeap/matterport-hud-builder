import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Check,
  Loader2,
  Pencil,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  listIntelligenceCandidates,
  reviewIntelligenceCandidate,
  type CandidateExtractionRow,
  type CandidateField,
} from "@/lib/portal/intelligence-review.functions";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  propertyUuid: string;
  propertyName: string;
  /** Notified after at least one candidate was approved or discarded
   *  so callers can refresh derived UI (e.g. the trained doc list). */
  onChanged?: () => void;
}

interface CardKey {
  extractionId: string;
  index: number;
  key: string;
}

/** Pretty-print a candidate value for the read-only confirmation row. */
function formatValue(value: unknown): string {
  if (value === null || typeof value === "undefined") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function IntelligenceReviewPanel({
  open,
  onOpenChange,
  propertyUuid,
  propertyName,
  onChanged,
}: Props) {
  const list = useServerFn(listIntelligenceCandidates);
  const review = useServerFn(reviewIntelligenceCandidate);

  const [rows, setRows] = useState<CandidateExtractionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await list({ data: { propertyUuid } });
      setRows(res.rows);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load candidates",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setTouched(false);
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, propertyUuid]);

  // Notify the parent only on close so we don't refetch mid-review.
  useEffect(() => {
    if (!open && touched) onChanged?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const totalCandidates = useMemo(
    () => rows.reduce((acc, r) => acc + r.candidates.length, 0),
    [rows],
  );

  const cardId = (k: CardKey) =>
    `${k.extractionId}::${k.index}::${k.key}`;

  const handleAction = async (
    extraction: CandidateExtractionRow,
    candidate: CandidateField,
    index: number,
    action: "approve" | "discard",
  ) => {
    const id = cardId({
      extractionId: extraction.extractionId,
      index,
      key: candidate.key,
    });
    setPending(id);
    try {
      const editedRaw = editing[id];
      const value =
        action === "approve" && typeof editedRaw === "string"
          ? editedRaw
          : undefined;
      await review({
        data: {
          extractionId: extraction.extractionId,
          index,
          key: candidate.key,
          action,
          value,
        },
      });
      toast.success(
        action === "approve" ? "Promoted to fields" : "Candidate discarded",
      );
      setTouched(true);
      // Drop locally so the UI doesn't flicker between refetches.
      setRows((prev) =>
        prev
          .map((r) =>
            r.extractionId === extraction.extractionId
              ? {
                  ...r,
                  candidates: r.candidates.filter((c, i) =>
                    !(i === index && c.key === candidate.key),
                  ),
                }
              : r,
          )
          .filter((r) => r.candidates.length > 0),
      );
      setEditing((prev) => {
        const { [id]: _drop, ...rest } = prev;
        return rest;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            Intelligence Review — {propertyName}
          </DialogTitle>
          <DialogDescription>
            Low-confidence facts the AI extracted but didn't auto-promote.
            Approve to lock them into the property brain, edit before
            approving, or discard.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading candidates…
          </div>
        ) : totalCandidates === 0 ? (
          <p className="rounded-md border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-5 text-primary" />
            Nothing to review. All extracted facts are either confirmed or
            already in the property brain.
          </p>
        ) : (
          <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
            {rows.map((extraction) => (
              <section key={extraction.extractionId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {extraction.template_label}
                  </h4>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {extraction.candidates.length} pending
                  </Badge>
                </div>
                <ul className="space-y-2">
                  {extraction.candidates.map((c, idx) => {
                    const id = cardId({
                      extractionId: extraction.extractionId,
                      index: idx,
                      key: c.key,
                    });
                    const editVal =
                      typeof editing[id] === "string"
                        ? editing[id]
                        : formatValue(c.value);
                    const isPending = pending === id;
                    return (
                      <li
                        key={id}
                        className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-0.5">
                            <p className="truncate text-sm font-medium">
                              {c.key}
                            </p>
                            {c.evidence && (
                              <p className="line-clamp-2 text-[11px] italic text-muted-foreground">
                                "{c.evidence}"
                              </p>
                            )}
                          </div>
                          <Badge
                            variant="outline"
                            className="h-5 shrink-0 px-1.5 text-[10px]"
                            title="AI confidence (0–1)"
                          >
                            {(c.confidence ?? 0).toFixed(2)}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-2">
                          <Pencil className="size-3 shrink-0 text-muted-foreground" />
                          <Input
                            value={editVal}
                            onChange={(e) =>
                              setEditing((prev) => ({
                                ...prev,
                                [id]: e.target.value,
                              }))
                            }
                            className="h-7 text-xs"
                            disabled={isPending}
                          />
                        </div>

                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs"
                            onClick={() =>
                              handleAction(extraction, c, idx, "discard")
                            }
                            disabled={isPending}
                          >
                            <X className="size-3" />
                            Discard
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-xs"
                            onClick={() =>
                              handleAction(extraction, c, idx, "approve")
                            }
                            disabled={isPending}
                          >
                            {isPending ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Check className="size-3" />
                            )}
                            Approve
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
