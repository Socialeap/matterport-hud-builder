/**
 * Guided Refinement Template Architect
 *
 * Selection-based, two-turn workflow that replaces hand-editing JSON.
 * Lives inside the Vault Templates EditorDialog as a sibling of the
 * existing PDF auto-generation block. On finalize, populates the
 * editor's schema_text with a validated JSON Schema (with hidden
 * canonical keys silently merged on the server).
 */

import { useState } from "react";
import { Sparkles, Wand2, RotateCcw, Check, Pencil } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  architectDraft,
  architectRefine,
  type DraftItem,
} from "@/lib/extraction/induce";
import type { JsonSchema } from "@/lib/extraction/provider";

interface DraftRow extends DraftItem {
  selected: boolean;
  editing: boolean;
}

interface FinalizeResult {
  schema: JsonSchema;
  hiddenKeysAdded: string[];
  selectedCount: number;
}

interface Props {
  docKind: string;
  disabled?: boolean;
  onApply: (schemaJson: string, summary: FinalizeResult) => void;
}

type Phase = "describe" | "refine" | "finalized";

export function TemplateArchitect({ docKind, disabled, onApply }: Props) {
  const [phase, setPhase] = useState<Phase>("describe");
  const [propDescr, setPropDescr] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinalizeResult | null>(null);

  const selectedCount = rows.filter((r) => r.selected).length;

  const runDraft = async () => {
    if (busy) return;
    const trimmed = propDescr.trim();
    if (trimmed.length < 4) {
      toast.error("Describe the property in at least a few words.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await architectDraft(trimmed);
      setRows(
        out.draft.map((d) => ({ ...d, selected: true, editing: false })),
      );
      setPhase("refine");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Draft failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const runFinalize = async () => {
    if (busy) return;
    const kept = rows
      .filter((r) => r.selected)
      .map((r) => ({ key: r.key, title: r.title, desc: r.desc }));
    if (kept.length < 3) {
      toast.error("Keep at least 3 fields before finalizing.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await architectRefine({
        propDescr: propDescr.trim(),
        docKind: docKind.trim() || "hospitality",
        keptItems: kept,
      });
      const summary: FinalizeResult = {
        schema: out.schema,
        hiddenKeysAdded: out.hidden_keys_added,
        selectedCount: kept.length,
      };
      setResult(summary);
      setPhase("finalized");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(`Finalize failed: ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result) return;
    onApply(JSON.stringify(result.schema, null, 2), result);
    toast.success(
      `Schema applied — ${result.selectedCount} fields + ${result.hiddenKeysAdded.length} canonical key${result.hiddenKeysAdded.length === 1 ? "" : "s"}.`,
    );
  };

  const reset = () => {
    setPhase("describe");
    setRows([]);
    setResult(null);
    setError(null);
  };

  const updateRow = (id: number, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-3 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Wand2 className="size-3.5 text-primary" />
            <Label className="text-xs font-medium">
              Guided Refinement Template Architect
            </Label>
            <Badge variant="secondary" className="text-[10px]">
              Gemini 2.5 Flash-Lite
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Describe the property class → review candidate fields → finalize a
            validated schema. No JSON editing required.
          </p>
        </div>
        {phase !== "describe" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={reset}
            disabled={busy}
            className="h-7 shrink-0 text-[11px]"
          >
            <RotateCcw className="mr-1 size-3" /> Start over
          </Button>
        )}
      </div>

      {phase === "describe" && (
        <DescribePhase
          propDescr={propDescr}
          setPropDescr={setPropDescr}
          onDraft={runDraft}
          busy={busy}
          disabled={disabled}
        />
      )}

      {phase === "refine" && (
        <RefinePhase
          rows={rows}
          updateRow={updateRow}
          onRedraft={runDraft}
          onFinalize={runFinalize}
          busy={busy}
          disabled={disabled}
          selectedCount={selectedCount}
        />
      )}

      {phase === "finalized" && result && (
        <FinalizedPhase
          result={result}
          onApply={apply}
          onBack={() => setPhase("refine")}
          disabled={disabled}
        />
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ── Phase 1: Describe ────────────────────────────────────────────────
function DescribePhase({
  propDescr,
  setPropDescr,
  onDraft,
  busy,
  disabled,
}: {
  propDescr: string;
  setPropDescr: (v: string) => void;
  onDraft: () => void;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label
        htmlFor="architect-prop-descr"
        className="text-[11px] text-muted-foreground"
      >
        Property class / type / description
      </Label>
      <Textarea
        id="architect-prop-descr"
        value={propDescr}
        onChange={(e) => setPropDescr(e.target.value)}
        placeholder='e.g. "Lifestyle hotel with rooftop bar, 200 keys, 8,000 sqft of meeting space, signature Italian restaurant"'
        rows={3}
        className="text-xs"
        disabled={disabled || busy}
        maxLength={1000}
      />
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground">
          The richer your description, the better the candidate fields.
        </p>
        <Button
          size="sm"
          onClick={onDraft}
          disabled={disabled || busy || propDescr.trim().length < 4}
          className="h-7 text-xs"
        >
          <Sparkles className="mr-1 size-3" />
          {busy ? "Drafting…" : "Draft Candidates"}
        </Button>
      </div>
    </div>
  );
}

// ── Phase 2: Refine ──────────────────────────────────────────────────
function RefinePhase({
  rows,
  updateRow,
  onRedraft,
  onFinalize,
  busy,
  disabled,
  selectedCount,
}: {
  rows: DraftRow[];
  updateRow: (id: number, patch: Partial<DraftRow>) => void;
  onRedraft: () => void;
  onFinalize: () => void;
  busy: boolean;
  disabled?: boolean;
  selectedCount: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium">
          {selectedCount} of {rows.length} selected
        </span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onRedraft}
            disabled={disabled || busy}
            className="h-6 px-2 text-[10px]"
          >
            <RotateCcw className="mr-1 size-3" /> Re-draft
          </Button>
          <Button
            size="sm"
            onClick={onFinalize}
            disabled={disabled || busy || selectedCount < 3}
            className="h-6 px-2 text-[11px]"
          >
            <Check className="mr-1 size-3" />
            {busy ? "Finalizing…" : "Finalize Schema"}
          </Button>
        </div>
      </div>

      <ul className="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-1.5">
        {rows.map((r) => (
          <DraftRowItem key={r.id} row={r} onChange={(p) => updateRow(r.id, p)} />
        ))}
      </ul>
    </div>
  );
}

function DraftRowItem({
  row,
  onChange,
}: {
  row: DraftRow;
  onChange: (patch: Partial<DraftRow>) => void;
}) {
  const labelColor =
    row.label === "Foundational"
      ? "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";

  return (
    <li
      className={`flex items-start gap-2 rounded-sm px-1.5 py-1 text-[11px] ${row.selected ? "" : "opacity-50"}`}
    >
      <Checkbox
        checked={row.selected}
        onCheckedChange={(v) => onChange({ selected: !!v })}
        className="mt-0.5"
      />
      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
        {row.id}
      </span>
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${labelColor}`}
        title={row.label}
      >
        {row.label === "Foundational" ? "F" : "D"}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {row.editing ? (
          <>
            <Input
              value={row.title}
              onChange={(e) => onChange({ title: e.target.value })}
              className="h-6 text-[11px]"
              maxLength={80}
            />
            <Input
              value={row.desc}
              onChange={(e) => onChange({ desc: e.target.value })}
              className="h-6 text-[10px]"
              maxLength={200}
            />
          </>
        ) : (
          <>
            <div className="font-medium leading-tight">{row.title}</div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              {row.desc}
            </div>
          </>
        )}
        <div className="font-mono text-[9px] text-muted-foreground/70">
          {row.key}
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onChange({ editing: !row.editing })}
        className="h-6 w-6 shrink-0 p-0"
        title={row.editing ? "Done" : "Edit"}
      >
        {row.editing ? <Check className="size-3" /> : <Pencil className="size-3" />}
      </Button>
    </li>
  );
}

// ── Phase 3: Finalized ──────────────────────────────────────────────
function FinalizedPhase({
  result,
  onApply,
  onBack,
  disabled,
}: {
  result: FinalizeResult;
  onApply: () => void;
  onBack: () => void;
  disabled?: boolean;
}) {
  const propCount = Object.keys(result.schema.properties).length;
  return (
    <div className="space-y-2 rounded-md border border-border bg-background p-2 text-[11px]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">Schema ready</p>
          <p className="text-[10px] text-muted-foreground">
            {result.selectedCount} field{result.selectedCount === 1 ? "" : "s"} you kept
            {" + "}
            {result.hiddenKeysAdded.length} canonical key
            {result.hiddenKeysAdded.length === 1 ? "" : "s"} auto-added
            {" → "} {propCount} total properties.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            disabled={disabled}
            className="h-6 px-2 text-[10px]"
          >
            Back
          </Button>
          <Button
            size="sm"
            onClick={onApply}
            disabled={disabled}
            className="h-6 px-2 text-[11px]"
          >
            <Check className="mr-1 size-3" /> Apply to Editor
          </Button>
        </div>
      </div>
      {result.hiddenKeysAdded.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          <span className="font-medium">Canonical keys added:</span>{" "}
          <span className="font-mono">
            {result.hiddenKeysAdded.join(", ")}
          </span>
        </p>
      )}
      {result.schema.required && result.schema.required.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          <span className="font-medium">Required:</span>{" "}
          <span className="font-mono">{result.schema.required.join(", ")}</span>
        </p>
      )}
    </div>
  );
}
