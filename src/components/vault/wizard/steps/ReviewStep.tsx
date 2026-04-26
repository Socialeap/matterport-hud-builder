/**
 * Final step shared by every wizard path: name the map and review the
 * detected fields before saving. Advanced settings are hidden behind a
 * disclosure so the default flow stays simple.
 *
 * For the Library and PDF paths the schema is already pre-populated, so we:
 *   1. Show a clear "Ready to save" callout above the name input.
 *   2. Auto-expand the field preview so the user sees exactly what they're
 *      getting (no more "is anything happening?" feeling).
 */

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ListChecks } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { JsonSchema } from "@/lib/extraction/provider";
import { STARTER_TEMPLATES } from "@/lib/vault/starter-templates";
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

  // For library/pdf paths the schema is pre-loaded — open the field list by
  // default so the user sees the value without having to click anything.
  const isPrePopulated = draft.path === "library" || draft.path === "pdf";
  const [fieldsOpen, setFieldsOpen] = useState(isPrePopulated);

  // If this draft was cloned from a Pre-Built starter, surface its name +
  // promised field count so the MSP user can confirm at a glance that the
  // full template made it through.
  const starter =
    draft.source && draft.source.kind === "starter"
      ? STARTER_TEMPLATES.find((s) => s.id === draft.source!.ref) ?? null
      : null;
  const promisedCount = starter
    ? Object.keys(starter.schema.properties).length
    : null;
  const fieldsMatchPromise =
    promisedCount === null || parsed.fieldCount >= promisedCount;

  return (
    <div className="space-y-4">
      {/* "Ready to save" callout — only when schema is valid AND pre-populated */}
      {isPrePopulated && parsed.ok && parsed.fieldCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-foreground">
              {starter
                ? `${starter.name} loaded — all ${parsed.fieldCount} fields ready`
                : `Ready to save — ${parsed.fieldCount} field${parsed.fieldCount === 1 ? "" : "s"} loaded`}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {starter
                ? `Your AI Chat will pull these ${parsed.fieldCount} facts from any document a client uploads. Just name your map and click Save ${parsed.fieldCount}-Field Template.`
                : `Your AI Chat will pull these facts from any document a client uploads. Just give your map a name and click ${draft.id ? "Save Changes" : "Create Map"}.`}
            </p>
            {starter && !fieldsMatchPromise && (
              <p className="text-[11px] font-medium text-destructive">
                Heads up: only {parsed.fieldCount} of {promisedCount} fields
                detected. We'll restore the full {promisedCount}-field
                template on save.
              </p>
            )}
          </div>
        </div>
      )}

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
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border bg-background p-2 text-[11px]">
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
