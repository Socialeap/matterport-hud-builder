import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  FileJson,
  FileText,
  Lock,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";

import { useVaultTemplates } from "@/hooks/useVaultTemplates";
import { useLusLicense } from "@/hooks/useLusLicense";
import type {
  JsonSchema,
  VaultTemplate,
  ExtractorId,
} from "@/lib/extraction/provider";
import { dryRunTemplate, type DryRunSuccess } from "@/lib/extraction/dryrun";
import { induceSchema, type InduceSchemaResult } from "@/lib/extraction/induce";
import { TemplateArchitect } from "@/components/vault/TemplateArchitect";

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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  const { isActive: lusActive, loading: lusLoading } = useLusLicense();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [forceArchitect, setForceArchitect] = useState(false);

  const search = Route.useSearch();
  const navigate = useNavigate();

  const editingDisabled = !lusLoading && !lusActive;

  const openCreate = (opts?: { architect?: boolean }) => {
    if (editingDisabled) return;
    setForceArchitect(!!opts?.architect);
    setEditor({ ...EMPTY_EDITOR });
  };

  // Auto-open Architect flow when arriving via ?architect=1
  useEffect(() => {
    if (search.architect === 1 && !lusLoading && lusActive && !editor) {
      setForceArchitect(true);
      setEditor({ ...EMPTY_EDITOR });
      navigate({
        to: "/dashboard/vault/templates",
        search: {},
        replace: true,
      });
    }
  }, [search.architect, lusLoading, lusActive, editor, navigate]);

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
    if (editingDisabled) {
      toast.error("Studio license inactive — saving templates is paused.");
      return;
    }
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
            Define the field schema (price, address, beds, year built, etc.)
            the AI uses when extracting data from your clients' property doc
            uploads. Templates are schema-only — they aren't read at runtime
            by the Ask AI chat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => openCreate({ architect: true })}
            size="sm"
            disabled={editingDisabled}
            title={
              editingDisabled
                ? "Studio license inactive — paused"
                : "Build a template with the AI Architect"
            }
          >
            <Wand2 className="mr-1 size-4" /> New with AI Architect
          </Button>
          <Button
            onClick={() => openCreate()}
            size="sm"
            variant="outline"
            disabled={editingDisabled}
            title={
              editingDisabled
                ? "Studio license inactive — paused"
                : undefined
            }
          >
            <Plus className="mr-1 size-4" /> Blank Template
          </Button>
        </div>
      </div>

      {editingDisabled && (
        <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/30 p-3">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            <p className="font-medium text-foreground">
              Studio license inactive
            </p>
            <p className="mt-0.5">
              Existing templates still run in client tours, but creating or
              editing them is paused until your upkeep license is reactivated.
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
        <EmptyState onArchitect={() => openCreate({ architect: true })} onBlank={() => openCreate()} disabled={editingDisabled} />
      ) : (
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
      )}

      <EditorDialog
        state={editor}
        setState={setEditor}
        saving={saving}
        onSave={handleSave}
        forceArchitect={forceArchitect}
        onClosed={() => setForceArchitect(false)}
      />
    </div>
  );
}

function EmptyState({
  onArchitect,
  onBlank,
  disabled,
}: {
  onArchitect: () => void;
  onBlank: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8">
      <div className="text-center">
        <FileJson className="mx-auto size-10 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">No templates yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A Template defines what data the AI extracts from your clients'
          uploaded Property Docs (price, address, amenities, etc.).
        </p>
      </div>
      <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onArchitect}
          disabled={disabled}
          className="group relative flex flex-col items-start gap-2 rounded-lg border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10 p-4 text-left transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="flex w-full items-center justify-between">
            <Wand2 className="size-5 text-primary" />
            <Badge variant="secondary" className="text-[10px]">
              Recommended
            </Badge>
          </div>
          <div className="font-semibold">Build with AI Architect</div>
          <p className="text-xs text-muted-foreground">
            Describe your property class. The AI suggests fields, you refine,
            and a validated schema is built for you.
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            <Sparkles className="size-3" /> Start guided flow →
          </span>
        </button>

        <button
          type="button"
          onClick={onBlank}
          disabled={disabled}
          className="group flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-4 text-left transition hover:border-foreground/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileJson className="size-5 text-muted-foreground" />
          <div className="font-semibold">Start from blank JSON</div>
          <p className="text-xs text-muted-foreground">
            For power users — author the JSON Schema directly, or paste a sample
            PDF and auto-induce a draft.
          </p>
          <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
            <Plus className="size-3" /> Open blank editor →
          </span>
        </button>
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

function EditorDialog({
  state,
  setState,
  saving,
  onSave,
  forceArchitect,
  onClosed,
}: {
  state: EditorState | null;
  setState: (next: EditorState | null) => void;
  saving: boolean;
  onSave: () => void;
  forceArchitect?: boolean;
  onClosed?: () => void;
}) {
  const open = state !== null;
  const [dryRunFile, setDryRunFile] = useState<File | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunSuccess | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  const [induceFile, setInduceFile] = useState<File | null>(null);
  const [induceBusy, setInduceBusy] = useState(false);
  const [induceResult, setInduceResult] = useState<InduceSchemaResult | null>(null);
  const [induceError, setInduceError] = useState<string | null>(null);

  const [jsonOpen, setJsonOpen] = useState(false);
  const [induceOpen, setInduceOpen] = useState(false);
  const [dryRunOpen, setDryRunOpen] = useState(false);

  // When forceArchitect (came in via "Launch Architect"), keep advanced
  // sections collapsed. When editing an existing template, default-open the
  // JSON section so users can see what's there.
  useEffect(() => {
    if (state?.id && !forceArchitect) {
      setJsonOpen(true);
    }
  }, [state?.id, forceArchitect]);

  const resetDryRun = () => {
    setDryRunFile(null);
    setDryRunResult(null);
    setDryRunError(null);
    setDryRunBusy(false);
  };

  const resetInduction = () => {
    setInduceFile(null);
    setInduceResult(null);
    setInduceError(null);
    setInduceBusy(false);
  };

  const closeDialog = () => {
    setState(null);
    resetDryRun();
    resetInduction();
    setJsonOpen(false);
    setInduceOpen(false);
    setDryRunOpen(false);
    onClosed?.();
  };

  if (!state) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent />
      </Dialog>
    );
  }

  const handleInduce = async () => {
    if (!induceFile || induceBusy) return;
    setInduceBusy(true);
    setInduceResult(null);
    setInduceError(null);
    try {
      const res = await induceSchema(induceFile);
      setInduceResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInduceError(msg);
    } finally {
      setInduceBusy(false);
    }
  };

  const handleApplyInducedSchema = () => {
    if (!induceResult || !state) return;
    setState({
      ...state,
      schema_text: JSON.stringify(induceResult.schema, null, 2),
    });
    toast.success("Schema applied to editor — review and save when ready.");
  };

  const runDryRun = async () => {
    if (!state || !dryRunFile) return;
    let schema: JsonSchema;
    try {
      schema = JSON.parse(state.schema_text);
      if (schema.type !== "object" || !schema.properties) {
        throw new Error("schema must be { type: 'object', properties: {...} }");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "parse error";
      toast.error(`Invalid field schema: ${msg}`);
      return;
    }
    setDryRunBusy(true);
    setDryRunResult(null);
    setDryRunError(null);
    try {
      const res = await dryRunTemplate({
        template: {
          label: state.label,
          doc_kind: state.doc_kind,
          extractor: state.extractor,
          field_schema: schema,
        },
        pdfFile: dryRunFile,
      });
      setDryRunResult(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setDryRunError(msg);
    } finally {
      setDryRunBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) closeDialog(); }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {state.id ? "Edit Template" : "New Template"}
          </DialogTitle>
          <DialogDescription>
            Use the AI Template Architect below to describe your property and
            let Gemini draft a validated schema, or expand the advanced
            sections to edit JSON, auto-induce from a PDF, or dry-run.
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

          {/* PRIMARY ACTION: AI Architect */}
          <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-[11px]">
            <span className="font-medium text-foreground">Start here →</span>{" "}
            <span className="text-muted-foreground">
              Describe your property and let the AI build the schema. You can
              still hand-edit JSON or use a sample PDF below.
            </span>
          </div>
          <TemplateArchitect
            docKind={state.doc_kind}
            disabled={saving}
            onApply={(json) => {
              setState({ ...state, schema_text: json });
              setJsonOpen(true);
            }}
          />

          <div className="flex items-center gap-2 pt-1 text-[11px] uppercase tracking-wide text-muted-foreground/70">
            <div className="h-px flex-1 bg-border" />
            <span>Or use a different starting point</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* COLLAPSIBLE: JSON Schema editor */}
          <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent">
              <span className="flex items-center gap-2">
                <FileJson className="size-3.5 text-muted-foreground" />
                Edit JSON Schema directly
              </span>
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition ${jsonOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-schema" className="sr-only">
                  Field Schema (JSON)
                </Label>
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
                  Shape:{" "}
                  <code>
                    {"{ type: 'object', properties: { name: { type, pattern? } } }"}
                  </code>
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* COLLAPSIBLE: Auto-Generate from PDF */}
          <Collapsible open={induceOpen} onOpenChange={setInduceOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent">
              <span className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-muted-foreground" />
                Auto-Generate from PDF
              </span>
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition ${induceOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <SchemaInductionSection
                file={induceFile}
                setFile={setInduceFile}
                busy={induceBusy}
                result={induceResult}
                error={induceError}
                onInduce={handleInduce}
                onApply={() => {
                  handleApplyInducedSchema();
                  setJsonOpen(true);
                }}
                disabled={saving}
              />
            </CollapsibleContent>
          </Collapsible>

          {/* COLLAPSIBLE: Dry Run */}
          <Collapsible open={dryRunOpen} onOpenChange={setDryRunOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-accent">
              <span className="flex items-center gap-2">
                <Play className="size-3.5 text-muted-foreground" />
                Dry Run against sample PDF
              </span>
              <ChevronDown
                className={`size-3.5 text-muted-foreground transition ${dryRunOpen ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <DryRunSection
                file={dryRunFile}
                setFile={setDryRunFile}
                busy={dryRunBusy}
                result={dryRunResult}
                error={dryRunError}
                onRun={runDryRun}
                disabled={saving}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={closeDialog}
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

function SchemaInductionSection({
  file,
  setFile,
  busy,
  result,
  error,
  onInduce,
  onApply,
  disabled,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  busy: boolean;
  result: InduceSchemaResult | null;
  error: string | null;
  onInduce: () => void;
  onApply: () => void;
  disabled: boolean;
}) {
  const canInduce = !!file && !busy && !disabled;
  const fieldEntries = result ? Object.entries(result.schema.properties) : [];

  return (
    <div className="space-y-2 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-primary" />
            <Label className="text-xs font-medium">Auto-Generate from Document</Label>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Upload an example PDF and AI will detect its fields and draft a schema for you.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onInduce}
          disabled={!canInduce}
          className="h-7 shrink-0 text-xs"
        >
          <Sparkles className="mr-1 size-3" />
          {busy ? "Generating…" : "Generate"}
        </Button>
      </div>

      <label
        htmlFor="induce-file"
        className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent"
      >
        <Upload className="size-3.5 text-muted-foreground" />
        <span className="truncate">
          {file ? file.name : "Choose an example PDF…"}
        </span>
        <input
          id="induce-file"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
          }}
        />
      </label>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-md border border-border bg-background p-2 text-xs">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{fieldEntries.length} field{fieldEntries.length === 1 ? "" : "s"} detected</span>
            <Button
              size="sm"
              variant="default"
              className="h-6 px-2 text-[11px]"
              onClick={onApply}
            >
              Apply to Editor
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            {fieldEntries.map(([key, field]) => (
              <InducedFieldRow key={key} name={key} fieldType={field.type} description={field.description} />
            ))}
          </dl>
          {result.schema.required && result.schema.required.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Required: {result.schema.required.join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function InducedFieldRow({
  name,
  fieldType,
  description,
}: {
  name: string;
  fieldType: string;
  description?: string;
}) {
  return (
    <>
      <dt className="font-mono text-[11px] text-muted-foreground" title={description}>
        {name}
      </dt>
      <dd className="text-[11px] text-muted-foreground">{fieldType}</dd>
    </>
  );
}

function DryRunSection({
  file,
  setFile,
  busy,
  result,
  error,
  onRun,
  disabled,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  busy: boolean;
  result: DryRunSuccess | null;
  error: string | null;
  onRun: () => void;
  disabled: boolean;
}) {
  const canRun = !!file && !busy && !disabled;

  return (
    <div className="space-y-2 rounded-md border border-dashed border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-xs font-medium">Dry Run</Label>
          <p className="text-[11px] text-muted-foreground">
            Test the draft against a sample PDF without saving anything.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onRun}
          disabled={!canRun}
          className="h-7 text-xs"
        >
          <Play className="mr-1 size-3" />
          {busy ? "Running…" : "Run"}
        </Button>
      </div>

      <label
        htmlFor="dryrun-file"
        className="flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs hover:bg-accent"
      >
        <Upload className="size-3.5 text-muted-foreground" />
        <span className="truncate">
          {file ? file.name : "Choose a sample PDF…"}
        </span>
        <input
          id="dryrun-file"
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-md border border-border bg-background p-2 text-xs">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {Object.keys(result.fields).length} fields •{" "}
              {result.chunks.length} chunks •{" "}
              {(result.pdf_bytes / 1024).toFixed(1)} KB
            </span>
            <span>
              {result.extractor}@{result.extractor_version}
            </span>
          </div>
          {Object.keys(result.fields).length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No fields matched. Adjust patterns or extractor and try again.
            </p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
              {Object.entries(result.fields).map(([k, v]) => {
                const display =
                  v === null || v === undefined
                    ? "—"
                    : typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v);
                return (
                  <DryRunFieldRow key={k} name={k} display={display} />
                );
              })}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function DryRunFieldRow({
  name,
  display,
}: {
  name: string;
  display: string;
}) {
  return (
    <>
      <dt className="font-mono text-[11px] text-muted-foreground">{name}</dt>
      <dd className="truncate" title={display}>
        {display}
      </dd>
    </>
  );
}
