import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  FileJson,
  FileText,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { useVaultTemplates } from "@/hooks/useVaultTemplates";
import type {
  JsonSchema,
  VaultTemplate,
  ExtractorId,
} from "@/lib/extraction/provider";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute(
  "/_authenticated/dashboard/vault/templates",
)({
  component: VaultTemplatesPage,
});

interface EditorState {
  id: string | null;
  label: string;
  doc_kind: string;
  extractor: ExtractorId;
  schema_text: string;
}

const EMPTY_EDITOR: EditorState = {
  id: null,
  label: "",
  doc_kind: "hud_statement",
  extractor: "pdfjs_heuristic",
  schema_text: JSON.stringify(
    {
      type: "object",
      properties: {
        property_address: { type: "string" },
        purchase_price: { type: "number" },
      },
    } satisfies JsonSchema,
    null,
    2,
  ),
};

function VaultTemplatesPage() {
  const { templates, loading, create, update, remove } = useVaultTemplates();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const openCreate = () => setEditor({ ...EMPTY_EDITOR });
  const openEdit = (t: VaultTemplate) =>
    setEditor({
      id: t.id,
      label: t.label,
      doc_kind: t.doc_kind,
      extractor: t.extractor,
      schema_text: JSON.stringify(t.field_schema, null, 2),
    });

  const handleSave = async () => {
    if (!editor) return;
    if (!editor.label.trim()) {
      toast.error("Label required");
      return;
    }
    let schema: JsonSchema;
    try {
      schema = JSON.parse(editor.schema_text);
      if (schema.type !== "object" || !schema.properties) {
        throw new Error("schema must be { type: 'object', properties: {...} }");
      }
    } catch (err) {
      toast.error(
        `Invalid field schema: ${err instanceof Error ? err.message : "parse error"}`,
      );
      return;
    }

    setSaving(true);
    const ok = editor.id
      ? await update(editor.id, {
          label: editor.label.trim(),
          doc_kind: editor.doc_kind.trim(),
          extractor: editor.extractor,
          field_schema: schema,
        })
      : !!(await create({
          label: editor.label.trim(),
          doc_kind: editor.doc_kind.trim(),
          extractor: editor.extractor,
          field_schema: schema,
        }));
    setSaving(false);
    if (ok) setEditor(null);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            to="/dashboard/vault"
            className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3" /> Back to Vault
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Property Doc Templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Define what gets extracted from each property doc kind. Clients'
            HUDs consume these fields automatically.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="mr-1 size-4" /> New Template
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState onAdd={openCreate} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sorted.map((t) => (
            <TemplateCard
              key={t.id}
              template={t}
              onEdit={() => openEdit(t)}
              onDelete={() => handleDelete(t)}
            />
          ))}
        </div>
      )}

      <EditorDialog
        state={editor}
        setState={setEditor}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 text-center">
      <FileJson className="mx-auto size-10 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-medium">No templates yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Create your first template to start turning uploaded PDFs into structured HUD data.
      </p>
      <Button size="sm" variant="outline" className="mt-4" onClick={onAdd}>
        <Plus className="mr-1 size-4" /> New Template
      </Button>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: VaultTemplate;
  onEdit: () => void;
  onDelete: () => void;
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
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="size-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </CardContent>
    </Card>
  );
}

function EditorDialog({
  state,
  setState,
  saving,
  onSave,
}: {
  state: EditorState | null;
  setState: (next: EditorState | null) => void;
  saving: boolean;
  onSave: () => void;
}) {
  const open = state !== null;
  if (!state) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && setState(null)}>
        <DialogContent />
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && setState(null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {state.id ? "Edit Template" : "New Template"}
          </DialogTitle>
          <DialogDescription>
            Fields declared here are extracted from every matching upload and
            surfaced to the client HUD.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-label">Label</Label>
              <Input
                id="tpl-label"
                value={state.label}
                onChange={(e) => setState({ ...state, label: e.target.value })}
                placeholder="e.g. HUD-1 Statement"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-kind">Doc Kind</Label>
              <Input
                id="tpl-kind"
                value={state.doc_kind}
                onChange={(e) =>
                  setState({ ...state, doc_kind: e.target.value })
                }
                placeholder="hud_statement"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-extractor">Extractor</Label>
            <select
              id="tpl-extractor"
              value={state.extractor}
              onChange={(e) =>
                setState({
                  ...state,
                  extractor: e.target.value as ExtractorId,
                })
              }
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="pdfjs_heuristic">
                pdfjs_heuristic (text + regex)
              </option>
              <option value="donut" disabled>
                donut (vision — Phase 2)
              </option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-schema">Field Schema (JSON)</Label>
            <Textarea
              id="tpl-schema"
              value={state.schema_text}
              onChange={(e) =>
                setState({ ...state, schema_text: e.target.value })
              }
              rows={12}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Shape: <code>{"{ type: 'object', properties: { name: { type, pattern? } } }"}</code>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setState(null)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : state.id ? "Save Changes" : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
