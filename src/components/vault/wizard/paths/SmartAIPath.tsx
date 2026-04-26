/**
 * Smart AI Blueprint path. Wraps the existing TemplateArchitect component
 * unchanged — just routes its 3 internal phases to wizard step 0/1/2 and
 * applies the produced schema to the draft.
 *
 * IMPORTANT: TemplateArchitect manages its own internal phase state (Describe
 * → Refine → Finalized). We render it on step 0 and 1, and the user clicks
 * "Apply to Editor" inside it which triggers our `onApply` → we set the
 * schema on the draft and the parent wizard advances to step 2 (Name & Save).
 */

import { TemplateArchitect } from "@/components/vault/TemplateArchitect";
import type { WizardDraft } from "../types";
import { ReviewStep } from "../steps/ReviewStep";

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  onSchemaApplied: () => void;
  disabled?: boolean;
}

export function SmartAIPath({
  draft,
  onChange,
  onSchemaApplied,
  disabled,
}: Props) {
  // Steps 0 + 1 both live inside TemplateArchitect (it has its own progress).
  // Step 2 is the shared Name & Save review.
  if (draft.step < 2) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Describe a class or category of property. We'll suggest the facts
          worth pulling — you tick what matters, and we build the reusable map
          your clients' AI Chat will use on their uploaded property docs.
        </p>
        <TemplateArchitect
          docKind={draft.doc_kind || "hospitality"}
          disabled={disabled}
          onApply={(json) => {
            onChange({ schema_text: json, source: { kind: "ai" } });
            onSchemaApplied();
          }}
        />
      </div>
    );
  }

  return <ReviewStep draft={draft} onChange={onChange} disabled={disabled} />;
}
