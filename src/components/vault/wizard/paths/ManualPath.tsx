/**
 * Pro Developer Setup path.
 *  Step 0 — author the raw JSON Field Blueprint directly.
 *  Step 1 — shared Name & Save review (Advanced opens by default for this path).
 */

import { Code2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WizardDraft } from "../types";
import { ReviewStep } from "../steps/ReviewStep";

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  disabled?: boolean;
}

export function ManualPath({ draft, onChange, disabled }: Props) {
  if (draft.step === 0) {
    let valid = true;
    let parseError: string | null = null;
    try {
      const parsed = JSON.parse(draft.schema_text);
      if (parsed.type !== "object" || !parsed.properties) {
        valid = false;
        parseError = "Schema must be { type: 'object', properties: {...} }";
      }
    } catch (err) {
      valid = false;
      parseError = err instanceof Error ? err.message : "Invalid JSON";
    }

    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Hand-author the Field Blueprint as JSON Schema. For power users only —
          your clients' AI Chat will use this exact structure to pull facts.
        </p>

        <div className="space-y-1.5">
          <Label
            htmlFor="manual-schema"
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            <Code2 className="size-4 text-muted-foreground" />
            Field Blueprint
          </Label>
          <Textarea
            id="manual-schema"
            value={draft.schema_text}
            onChange={(e) =>
              onChange({
                schema_text: e.target.value,
                source: { kind: "manual" },
              })
            }
            rows={16}
            disabled={disabled}
            className="font-mono text-xs"
          />
          {!valid && parseError && (
            <p className="text-[11px] text-destructive">{parseError}</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            Shape:{" "}
            <code className="text-[10px]">
              {"{ type: 'object', properties: { name: { type, description? } }, required?: [...] }"}
            </code>
          </p>
        </div>
      </div>
    );
  }

  return <ReviewStep draft={draft} onChange={onChange} disabled={disabled} />;
}
