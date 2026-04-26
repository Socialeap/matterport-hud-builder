import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileJson, FileText, Lock, Pencil, Trash2 } from "lucide-react";

import { useVaultTemplates } from "@/hooks/useVaultTemplates";
import { useLusLicense } from "@/hooks/useLusLicense";
import type { VaultTemplate } from "@/lib/extraction/provider";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { WizardHub } from "@/components/vault/wizard/WizardHub";
import {
  WizardModal,
  type SavePayload,
} from "@/components/vault/wizard/WizardModal";
import {
  PATH_STEP_COUNT,
  makeEmptyDraft,
  type WizardDraft,
  type WizardPath,
} from "@/components/vault/wizard/types";

interface TemplatesSearch {
  architect?: number;
}

export const Route = createFileRoute(
  "/_authenticated/dashboard/vault/templates",
)({
  validateSearch: (raw: Record<string, unknown>): TemplatesSearch => {
    const v = raw.architect;
    return {
      architect: v === 1 || v === "1" || v === true ? 1 : undefined,
    };
  },
  component: VaultTemplatesPage,
});

function VaultTemplatesPage() {
  const { templates, loading, create, update, remove } = useVaultTemplates();
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const search = Route.useSearch();
  const navigate = useNavigate();

  const editingDisabled = !lusLoading && !lusActive;

  const startNew = (path: WizardPath) => {
    if (editingDisabled) return;
    setDraft(makeEmptyDraft(path));
  };

  // ?architect=1 deep link → opens Smart-AI path directly.
  useEffect(() => {
    if (search.architect !== 1) return;
    if (lusLoading) return;
    if (!lusActive) {
      navigate({ to: "/dashboard/vault/templates", search: {}, replace: true });
      return;
    }
    setDraft(makeEmptyDraft("ai"));
    navigate({
      to: "/dashboard/vault/templates",
      search: {},
      replace: true,
    });
  }, [search.architect, lusLoading, lusActive, navigate]);

  const openEdit = (t: VaultTemplate) => {
    // Edits jump straight to the manual path's final step (Name & Save) where
    // the Advanced Settings panel exposes Doc Kind, Extractor, and raw JSON.
    setDraft({
      id: t.id,
      path: "manual",
      step: PATH_STEP_COUNT.manual - 1,
      label: t.label,
      doc_kind: t.doc_kind,
      extractor: t.extractor,
      schema_text: JSON.stringify(t.field_schema, null, 2),
      source: null,
    });
  };

  const handleSave = async (payload: SavePayload): Promise<boolean> => {
    if (editingDisabled) return false;
    setSaving(true);
    const ok = payload.id
      ? await update(payload.id, {
          label: payload.label,
          doc_kind: payload.doc_kind,
          extractor: payload.extractor,
          field_schema: payload.field_schema,
        })
      : !!(await create({
          label: payload.label,
          doc_kind: payload.doc_kind,
          extractor: payload.extractor,
          field_schema: payload.field_schema,
        }));
    setSaving(false);
    return ok;
  };

  const handleDelete = async (t: VaultTemplate) => {
    if (!confirm(`Delete template "${t.label}"?`)) return;
    await remove(t.id);
  };

  const sorted = useMemo(
    () => [...templates].sort((a, b) => a.label.localeCompare(b.label)),
    [templates],
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          to="/dashboard/vault"
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Back to Vault
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Property Maps for AI Chat
        </h1>
        <p className="text-sm text-muted-foreground">
          Each map is a reusable blueprint for a type or category of property.
          Your clients pick the right map, and the AI uses it to pull verified
          facts from their uploaded property documents to answer visitor
          questions in the "Ask AI" chat.
        </p>
      </div>

      {editingDisabled && (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Studio license inactive
            </p>
            <p className="mt-0.5">
              Existing maps still run in client tours, but creating or editing
              them is paused until your upkeep license is reactivated.
              Deletion is still available.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState onPick={startNew} disabled={editingDisabled} />
      ) : (
        <>
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Create a new map
              </h2>
            </div>
            <WizardHub
              onPick={startNew}
              disabled={editingDisabled}
              compact
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Your maps
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {sorted.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={() => openEdit(t)}
                  onDelete={() => handleDelete(t)}
                  editDisabled={editingDisabled}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <WizardModal
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}

function EmptyState({
  onPick,
  disabled,
}: {
  onPick: (path: WizardPath) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5 rounded-lg border border-dashed border-border bg-muted/20 p-8">
      <div className="text-center">
        <FileJson className="mx-auto size-10 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">No property maps yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick the path that fits how you'd like to start. You can always
          fine-tune the result before saving.
        </p>
      </div>
      <div className="mx-auto max-w-3xl">
        <WizardHub onPick={onPick} disabled={disabled} />
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  editDisabled,
}: {
  template: VaultTemplate;
  onEdit: () => void;
  onDelete: () => void;
  editDisabled?: boolean;
}) {
  const fieldCount = Object.keys(template.field_schema.properties ?? {}).length;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="truncate text-base">{template.label}</CardTitle>
          </div>
          <Badge variant="secondary" className="text-xs">
            v{template.version}
          </Badge>
        </div>
        <CardDescription>
          {template.doc_kind} • {fieldCount} field{fieldCount === 1 ? "" : "s"} •{" "}
          {template.extractor}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-end gap-1 pt-0">
        <Button
          size="sm"
          variant="ghost"
          onClick={onEdit}
          disabled={editDisabled}
          title={editDisabled ? "Studio license inactive — paused" : "Edit"}
        >
          {editDisabled ? (
            <Lock className="size-3.5 text-muted-foreground" />
          ) : (
            <Pencil className="size-3.5" />
          )}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </CardContent>
    </Card>
  );
}
