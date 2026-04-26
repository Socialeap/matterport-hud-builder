/**
 * Auto-Extract from PDF path.
 *  Step 0 — upload sample PDF.
 *  Step 1 — call induceSchema; show detected fields; "Use these fields" advances.
 *  Step 2 — shared Name & Save review.
 */

import { useState } from "react";
import { Sparkles, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { induceSchema, type InduceSchemaResult } from "@/lib/extraction/induce";
import type { WizardDraft } from "../types";
import { ReviewStep } from "../steps/ReviewStep";

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  onAdvance: () => void;
  disabled?: boolean;
}

export function PdfPath({ draft, onChange, onAdvance, disabled }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InduceSchemaResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDetection = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await induceSchema(file);
      setResult(res);
      onChange({
        schema_text: JSON.stringify(res.schema, null, 2),
        source: { kind: "pdf" },
      });
      onAdvance(); // step 0 → 1
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (draft.step === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Drop a sample document. We'll detect every field worth pulling and
          draft the map for you. You'll review the detected fields next.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="pdf-file" className="text-sm font-medium">
            Sample document
          </Label>
          <label
            htmlFor="pdf-file"
            className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input bg-background px-3 py-4 text-sm hover:bg-accent"
          >
            <Upload className="size-4 text-muted-foreground" />
            <span className="truncate">
              {file ? file.name : "Choose a PDF…"}
            </span>
            <input
              id="pdf-file"
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </p>
        )}

        <Button
          onClick={runDetection}
          disabled={!file || busy || disabled}
          className="w-full"
        >
          <Sparkles className="mr-1.5 size-4" />
          {busy ? "Teaching AI…" : "Detect fields"}
        </Button>
      </div>
    );
  }

  if (draft.step === 1) {
    let fieldCount = 0;
    let fields: Array<{ key: string; type: string; description?: string }> = [];
    try {
      const parsed = JSON.parse(draft.schema_text);
      if (parsed.properties) {
        fields = Object.entries(parsed.properties).map(([k, v]) => ({
          key: k,
          type: (v as { type: string }).type,
          description: (v as { description?: string }).description,
        }));
        fieldCount = fields.length;
      }
    } catch {
      /* ignore */
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm">
            <span className="font-medium">Detected fields</span>{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">
              {fieldCount}
            </Badge>
          </p>
          {result && (
            <span className="text-[11px] text-muted-foreground">
              from {file?.name}
            </span>
          )}
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-[11px]">
          {fields.map((f) => (
            <li key={f.key} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-foreground">{f.key}</span>
                <span className="text-muted-foreground/70">·</span>
                <span className="text-muted-foreground">{f.type}</span>
              </div>
              {f.description && (
                <div className="pl-4 text-[10px] text-muted-foreground/80">
                  {f.description}
                </div>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground">
          Continue to name and save your map. You can fine-tune the field
          blueprint later in Advanced Settings.
        </p>
      </div>
    );
  }

  return <ReviewStep draft={draft} onChange={onChange} disabled={disabled} />;
}
