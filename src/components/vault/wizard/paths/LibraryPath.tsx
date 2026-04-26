/**
 * Use Proven Template path.
 *  Step 0 — pick a starting point (Industry Standards or My Templates).
 *  Step 1 — shared Name & Save review.
 */

import { useMemo } from "react";
import {
  Building,
  Building2,
  Hotel,
  Home,
  Users,
  Briefcase,
  FileText,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useVaultTemplates } from "@/hooks/useVaultTemplates";
import {
  STARTER_TEMPLATES,
  type StarterTemplate,
} from "@/lib/vault/starter-templates";
import type { VaultTemplate } from "@/lib/extraction/provider";
import type { WizardDraft } from "../types";
import { ReviewStep } from "../steps/ReviewStep";

const ICONS = { Building, Building2, Hotel, Home, Users, Briefcase };

interface Props {
  draft: WizardDraft;
  onChange: (patch: Partial<WizardDraft>) => void;
  onAdvance: () => void;
  disabled?: boolean;
}

export function LibraryPath({ draft, onChange, onAdvance, disabled }: Props) {
  const { templates: userTemplates, loading } = useVaultTemplates();

  const sortedUserTemplates = useMemo(
    () => [...userTemplates].sort((a, b) => a.label.localeCompare(b.label)),
    [userTemplates],
  );

  const pickStarter = (s: StarterTemplate) => {
    onChange({
      label: s.defaultLabel,
      doc_kind: s.doc_kind,
      extractor: s.extractor,
      schema_text: JSON.stringify(s.schema, null, 2),
      source: { kind: "starter", ref: s.id },
    });
    onAdvance();
  };

  const pickUserTemplate = (t: VaultTemplate) => {
    onChange({
      label: `${t.label} (Copy)`,
      doc_kind: t.doc_kind,
      extractor: t.extractor,
      schema_text: JSON.stringify(t.field_schema, null, 2),
      source: { kind: "cloned", ref: t.id },
    });
    onAdvance();
  };

  if (draft.step === 0) {
    return (
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground">
          Pick a pre-built template below — we'll auto-fill 30+ industry-grade
          fields so your map is ready to save in one click. Or copy one of
          your existing templates as a starting point.
        </p>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-primary" />
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Pre-Built Templates
            </h3>
            <Badge variant="secondary" className="text-[9px]">
              Recommended
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTER_TEMPLATES.map((s) => {
              const Icon = ICONS[s.icon] ?? FileText;
              const fieldCount = Object.keys(s.schema.properties).length;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickStarter(s)}
                  disabled={disabled}
                  className="group flex flex-col items-start gap-1.5 rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex w-full items-center justify-between">
                    <Icon className="size-4 text-primary" />
                    <Badge variant="secondary" className="text-[9px]">
                      {fieldCount} fields
                    </Badge>
                  </div>
                  <div className="text-sm font-medium leading-tight">
                    {s.name}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    {s.tagline}
                  </p>
                  <span className="mt-0.5 text-[9.5px] font-medium text-primary/80">
                    Auto-fills {fieldCount} fields →
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <FileText className="size-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide">
              Your Saved Templates
            </h3>
            <span className="text-[10px] text-muted-foreground">
              — copy and rename
            </span>
            {!loading && (
              <Badge variant="outline" className="text-[9px]">
                {sortedUserTemplates.length}
              </Badge>
            )}
          </div>

          {loading ? (
            <p className="rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
              Loading…
            </p>
          ) : sortedUserTemplates.length === 0 ? (
            <p className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-[11px] text-muted-foreground">
              You haven't saved any templates yet. Pick a pre-built one above
              — it's the fastest way to start.
            </p>
          ) : (
            <ul className="space-y-1">
              {sortedUserTemplates.map((t) => {
                const fieldCount = Object.keys(t.field_schema.properties ?? {})
                  .length;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => pickUserTemplate(t)}
                      disabled={disabled}
                      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition hover:border-primary/60 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{t.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {t.doc_kind}
                        </span>
                      </span>
                      <Badge variant="secondary" className="shrink-0 text-[9px]">
                        {fieldCount} fields
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return <ReviewStep draft={draft} onChange={onChange} disabled={disabled} />;
}
