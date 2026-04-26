/**
 * Final step shared by every wizard path: name the map and review the
 * detected fields before saving. Advanced settings are hidden behind a
 * disclosure so the default flow stays simple.
 */

import { useMemo, useState } from "react";
import { ChevronDown, ListChecks } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { JsonSchema } from "@/lib/extraction/provider";
import type { WizardDraft } from "../types";
import { AdvancedSettings } from "./AdvancedSettings";

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  disabled?: boolean;
}

interface ParsedSchema {
  ok: boolean;
  fieldCount: number;
  required: string[];
  fields: Array<{ key: string; type: string; description?: string }>;
  error?: string;
}

function parseSchema(text: string): ParsedSchema {
  try {
    const schema = JSON.parse(text) as JsonSchema;
    if (schema.type !== "object" || !schema.properties) {
      return {
        ok: false,
        fieldCount: 0,
        required: [],
        fields: [],
        error: "Schema must be { type: 'object', properties: {...} }",
      };
    }
    const fields = Object.entries(schema.properties).map(([key, val]) => ({
      key,
      type: val.type,
      description: val.description,
    }));
    return {
      ok: true,
      fieldCount: fields.length,
      required: schema.required ?? [],
      fields,
    };
  } catch (err) {
    return {
      ok: false,
      fieldCount: 0,
      required: [],
      fields: [],
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export function ReviewStep({ draft, onChange, disabled }: Props) {
  const parsed = useMemo(() => parseSchema(draft.schema_text), [draft.schema_text]);
  const [fieldsOpen, setFieldsOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="wizard-label" className="text-sm font-medium">
          Map name
        </Label>
        <Input
          id="wizard-label"
          value={draft.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="e.g. Boutique Hotel Map"
          disabled={disabled}
          autoFocus
        />
        <p className="text-[11px] text-muted-foreground">
          Your clients will see this name when they pick a map for their AI Chat.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            <span className="text-sm font-medium">
              Intelligence Structure
            </span>
            {parsed.ok ? (
              <Badge variant="secondary" className="text-[10px]">
                {parsed.fieldCount} field{parsed.fieldCount === 1 ? "" : "s"}
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-[10px]">
                Invalid
              </Badge>
            )}
          </div>
          {parsed.ok && parsed.fieldCount > 0 && (
            <Collapsible open={fieldsOpen} onOpenChange={setFieldsOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                {fieldsOpen ? "Hide fields" : "Show fields"}
                <ChevronDown
                  className={`size-3 transition ${fieldsOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
            </Collapsible>
          )}
        </div>

        {parsed.ok && (
          <Collapsible open={fieldsOpen} onOpenChange={setFieldsOpen}>
            <CollapsibleContent className="mt-3">
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-[11px]">
                {parsed.fields.map((f) => (
                  <li key={f.key} className="flex items-start gap-2">
                    <span className="font-mono text-muted-foreground">
                      {f.key}
                    </span>
                    <span className="text-muted-foreground/70">·</span>
                    <span className="text-muted-foreground">{f.type}</span>
                    {parsed.required.includes(f.key) && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        required
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        )}

        {!parsed.ok && parsed.error && (
          <p className="mt-2 text-[11px] text-destructive">{parsed.error}</p>
        )}
      </div>

      <AdvancedSettings
        draft={draft}
        onChange={onChange}
        defaultOpen={draft.path === "manual"}
        disabled={disabled}
      />
    </div>
  );
}
