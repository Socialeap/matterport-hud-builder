import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  deleteCustomQA,
  listCustomQAs,
  upsertCustomQA,
  type CustomQARow,
} from "@/lib/portal/custom-qas.functions";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  savedModelId: string | null;
  propertyUuid: string;
  propertyName: string;
}

/**
 * Per-property manager for human-authored Q&A pairs that always win
 * over Gemini synthesis at runtime. See custom-qas.functions.ts.
 */
export function CustomQAManager({
  open,
  onOpenChange,
  savedModelId,
  propertyUuid,
  propertyName,
}: Props) {
  const list = useServerFn(listCustomQAs);
  const upsert = useServerFn(upsertCustomQA);
  const remove = useServerFn(deleteCustomQA);

  const [rows, setRows] = useState<CustomQARow[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    if (!savedModelId) return;
    setLoading(true);
    try {
      const res = await list({
        data: { savedModelId, propertyUuid },
      });
      setRows(res.rows);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to load custom Q&As",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      void refresh();
      resetForm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, savedModelId, propertyUuid]);

  const resetForm = () => {
    setEditingId(null);
    setQuestion("");
    setAnswer("");
  };

  const handleSave = async () => {
    if (!savedModelId) return;
    const q = question.trim();
    const a = answer.trim();
    if (q.length < 2 || a.length < 2) {
      toast.error("Question and answer are required.");
      return;
    }
    setSaving(true);
    try {
      await upsert({
        data: {
          id: editingId ?? undefined,
          savedModelId,
          propertyUuid,
          question: q,
          answer: a,
        },
      });
      toast.success(editingId ? "Q&A updated" : "Q&A added");
      resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (row: CustomQARow) => {
    setEditingId(row.id);
    setQuestion(row.question);
    setAnswer(row.answer);
  };

  const handleDelete = async (row: CustomQARow) => {
    if (!confirm("Delete this Q&A? This cannot be undone.")) return;
    try {
      await remove({ data: { id: row.id } });
      toast.success("Q&A deleted");
      if (editingId === row.id) resetForm();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Custom Q&A — {propertyName}</DialogTitle>
          <DialogDescription>
            Hand-authored answers always win over the AI's synthesized
            response. Use this for facts you want phrased exactly your way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Question
            </label>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Are pets allowed?"
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Answer
            </label>
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Yes — well-behaved dogs under 40 lbs are welcome with a $250 deposit."
              rows={4}
              maxLength={2000}
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            {editingId && (
              <Button
                size="sm"
                variant="ghost"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !savedModelId}
              className="gap-1"
            >
              {saving ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <MessageSquarePlus className="size-3" />
              )}
              {editingId ? "Update Q&A" : "Add Q&A"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Saved Q&As ({rows.length})
            </h4>
            {loading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
          </div>
          {!savedModelId ? (
            <p className="rounded-md border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
              Save the presentation first to attach custom Q&As.
            </p>
          ) : rows.length === 0 && !loading ? (
            <p className="rounded-md border border-dashed border-border/60 p-3 text-center text-xs text-muted-foreground">
              No custom Q&As yet.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-md border border-border/60 bg-background/60 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <p className="truncate text-xs font-medium">
                        {row.question}
                      </p>
                      <p className="line-clamp-2 text-[11px] text-muted-foreground">
                        {row.answer}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleEdit(row)}
                        title="Edit"
                      >
                        <Pencil className="size-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleDelete(row)}
                        title="Delete"
                      >
                        <Trash2 className="size-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
