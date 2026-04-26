/**
 * Shared "Advanced Settings" disclosure for the final step of every wizard
 * path. Houses the technical fields (Document Type, Data Extractor, raw
 * Field Blueprint JSON) so the simple flow stays clean.
 */

import { useState } from "react";
import { ChevronDown, FileJson, Settings2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ExtractorId } from "@/lib/extraction/provider";
import type { WizardDraft } from "../types";

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  /** Pro path opens this by default — power users want it. */
  defaultOpen?: boolean;
  disabled?: boolean;
}

export function AdvancedSettings({
  draft,
  onChange,
  defaultOpen = false,
  disabled,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent">
        <span className="flex items-center gap-2">
          <Settings2 className="size-3.5 text-muted-foreground" />
          Advanced Settings
        </span>
        <ChevronDown
          className={`size-3.5 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 pt-3">
        <div className="space-y-1.5">
          <Label htmlFor="adv-doc-kind" className="text-xs">
            Document Type
          </Label>
          <Input
            id="adv-doc-kind"
            value={draft.doc_kind}
            onChange={(e) => onChange({ doc_kind: e.target.value })}
            placeholder="e.g. hud_statement, hospitality_factsheet"
            disabled={disabled}
            className="h-9 text-sm"
          />
          <p className="text-[11px] text-muted-foreground">
            A short identifier for the kind of document this map reads.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adv-extractor" className="text-xs">
            Data Extractor
          </Label>
          <select
            id="adv-extractor"
            value={draft.extractor}
            onChange={(e) =>
              onChange({ extractor: e.target.value as ExtractorId })
            }
            disabled={disabled}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="pdfjs_heuristic">
              Pattern Reader (text + regex) — recommended
            </option>
            <option value="donut" disabled>
              Vision Reader (Phase 2)
            </option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="adv-schema" className="flex items-center gap-1.5 text-xs">
            <FileJson className="size-3.5 text-muted-foreground" />
            Field Blueprint (raw JSON)
          </Label>
          <Textarea
            id="adv-schema"
            value={draft.schema_text}
            onChange={(e) => onChange({ schema_text: e.target.value })}
            rows={10}
            disabled={disabled}
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Last-resort hand edit. Shape:{" "}
            <code className="text-[10px]">
              {"{ type: 'object', properties: { ... } }"}
            </code>
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
