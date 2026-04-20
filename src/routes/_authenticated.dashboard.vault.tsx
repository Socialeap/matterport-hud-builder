import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Lock } from "lucide-react";
import {
  Volume2,
  Wand2,
  Boxes,
  MapPin,
  FileText,
  Link as LinkIcon,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  FileJson,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  uploadVaultAsset,
  deleteVaultAssetFile,
} from "@/lib/storage";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export const Route = createFileRoute("/_authenticated/dashboard/vault")({
  component: VaultPage,
});

type VaultCategory =
  | "spatial_audio"
  | "visual_hud_filter"
  | "interactive_widget"
  | "custom_iconography"
  | "property_doc"
  | "external_link";

type VaultAsset = Tables<"vault_assets">;

type InputMode = "upload" | "url";

interface CategoryMeta {
  value: VaultCategory;
  label: string;
  utility: string;
  purpose: string;
  format: string;
  accept: string;
  icon: LucideIcon;
  urlOnly?: boolean;
  textarea?: boolean;
}

const CATEGORIES: CategoryMeta[] = [
  {
    value: "spatial_audio",
    label: "Sound Library",
    utility: "Background Ambience",
    purpose: "Emotional mood setting",
    format: ".mp3 or Audio URL",
    accept: ".mp3,audio/mpeg",
    icon: Volume2,
  },
  {
    value: "visual_hud_filter",
    label: "Visual Portal Filters",
    utility: "Overlay Layering",
    purpose: "Cinematic \"film\" look",
    format: ".png (transparent) or .css snippet",
    accept: ".png,.webp,image/png,image/webp",
    icon: Wand2,
    textarea: true,
  },
  {
    value: "interactive_widget",
    label: "Interactive Widgets",
    utility: "Engagement Tools",
    purpose: "Functional logic (tickers / calcs)",
    format: ".js script or Embed Code",
    accept: ".js,.mjs,text/javascript",
    icon: Boxes,
    textarea: true,
  },
  {
    value: "custom_iconography",
    label: "Custom Iconography",
    utility: "Spatial Markers",
    purpose: "High-end technical highlights",
    format: ".svg or .png",
    accept: ".svg,.png,image/svg+xml,image/png",
    icon: MapPin,
  },
  {
    value: "property_doc",
    label: "Property Docs",
    utility: "Info Delivery",
    purpose: "Downloadable data (Floorplans)",
    format: ".pdf or .jpg",
    accept: ".pdf,.jpg,.jpeg,application/pdf,image/jpeg",
    icon: FileText,
  },
  {
    value: "external_link",
    label: "External Links",
    utility: "Connectivity",
    purpose: "3rd party tool integration",
    format: "Direct URL",
    accept: "",
    icon: LinkIcon,
    urlOnly: true,
  },
];

const CATEGORY_BY_VALUE: Record<VaultCategory, CategoryMeta> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.value] = c;
    return acc;
  },
  {} as Record<VaultCategory, CategoryMeta>
);

interface AssetFormState {
  label: string;
  description: string;
  asset_url: string;
  is_active: boolean;
  mode: InputMode;
  file: File | null;
}

const emptyForm: AssetFormState = {
  label: "",
  description: "",
  asset_url: "",
  is_active: true,
  mode: "upload",
  file: null,
};

function VaultPage() {
  const { user } = useAuth();
  
  const [assets, setAssets] = useState<VaultAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<VaultCategory>("spatial_audio");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AssetFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [tier, setTier] = useState<"starter" | "pro" | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("branding_settings")
      .select("tier")
      .eq("provider_id", user.id)
      .maybeSingle()
      .then(({ data }) => setTier((data?.tier as "starter" | "pro") ?? "starter"));
  }, [user]);

  const fetchAssets = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("vault_assets")
      .select("*")
      .eq("provider_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Failed to load vault assets");
    } else {
      setAssets(data ?? []);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const activeCategory = CATEGORY_BY_VALUE[activeTab];

  const assetsByCategory = useMemo(() => {
    const map: Record<VaultCategory, VaultAsset[]> = {
      spatial_audio: [],
      visual_hud_filter: [],
      interactive_widget: [],
      custom_iconography: [],
      property_doc: [],
      external_link: [],
    };
    for (const a of assets) map[a.category_type].push(a);
    return map;
  }, [assets]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      mode: activeCategory.urlOnly ? "url" : "upload",
    });
    setEditorOpen(true);
  };

  const openEdit = (asset: VaultAsset) => {
    setEditingId(asset.id);
    setForm({
      label: asset.label,
      description: asset.description ?? "",
      asset_url: asset.asset_url,
      is_active: asset.is_active,
      mode: asset.storage_path ? "upload" : "url",
      file: null,
    });
    setActiveTab(asset.category_type);
    setEditorOpen(true);
  };

  const handleToggleActive = async (asset: VaultAsset, next: boolean) => {
    const { error } = await supabase
      .from("vault_assets")
      .update({ is_active: next })
      .eq("id", asset.id);

    if (error) {
      toast.error("Failed to update toggle");
      return;
    }
    setAssets((prev) =>
      prev.map((a) => (a.id === asset.id ? { ...a, is_active: next } : a))
    );
    toast.success(next ? "Asset available to clients" : "Asset hidden from clients");
  };

  const handleDelete = async (asset: VaultAsset) => {
    if (!confirm(`Delete "${asset.label}"? This cannot be undone.`)) return;

    if (asset.storage_path) {
      await deleteVaultAssetFile(asset.storage_path);
    }

    const { error } = await supabase
      .from("vault_assets")
      .delete()
      .eq("id", asset.id);

    if (error) {
      toast.error("Failed to delete asset");
      return;
    }
    setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    toast.success("Asset removed from vault");
  };

  const handleSave = async () => {
    if (!user) return;

    if (!form.label.trim()) {
      toast.error("Label is required");
      return;
    }

    const category = activeCategory.value;
    const isUrlMode = activeCategory.urlOnly || form.mode === "url";

    if (isUrlMode && !form.asset_url.trim()) {
      toast.error("URL or embed code is required");
      return;
    }
    if (!isUrlMode && !form.file && !editingId) {
      toast.error("Please select a file to upload");
      return;
    }

    setSaving(true);

    let asset_url = form.asset_url.trim();
    let storage_path: string | null = null;
    let mime_type: string | null = null;
    let file_size_bytes: number | null = null;

    if (!isUrlMode && form.file) {
      const uploaded = await uploadVaultAsset(user.id, category, form.file);
      if (!uploaded) {
        toast.error("Upload failed");
        setSaving(false);
        return;
      }
      asset_url = uploaded.url;
      storage_path = uploaded.path;
      mime_type = form.file.type || null;
      file_size_bytes = form.file.size;
    }

    if (editingId) {
      const updatePayload: TablesUpdate<"vault_assets"> = {
        label: form.label.trim(),
        description: form.description.trim() || null,
        is_active: form.is_active,
      };
      if (!isUrlMode && form.file) {
        updatePayload.asset_url = asset_url;
        updatePayload.storage_path = storage_path;
        updatePayload.mime_type = mime_type;
        updatePayload.file_size_bytes = file_size_bytes;
      } else if (isUrlMode) {
        updatePayload.asset_url = asset_url;
        updatePayload.storage_path = null;
        updatePayload.mime_type = null;
        updatePayload.file_size_bytes = null;
      }

      const { error } = await supabase
        .from("vault_assets")
        .update(updatePayload)
        .eq("id", editingId);

      if (error) {
        toast.error("Failed to save changes");
        setSaving(false);
        return;
      }
      toast.success("Asset updated");
    } else {
      const { error } = await supabase.from("vault_assets").insert({
        provider_id: user.id,
        category_type: category,
        label: form.label.trim(),
        description: form.description.trim() || null,
        asset_url,
        storage_path,
        mime_type,
        file_size_bytes,
        is_active: form.is_active,
      });

      if (error) {
        toast.error("Failed to add asset");
        setSaving(false);
        return;
      }
      toast.success("Asset added to vault");
    }

    setSaving(false);
    setEditorOpen(false);
    setForm(emptyForm);
    setEditingId(null);
    fetchAssets();
  };

  const isStarter = tier === "starter";
  const goToPricing = () => {
    window.location.href = "/#pricing";
  };


  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Production Vault
        </h1>
        <p className="text-sm text-muted-foreground">
          Curate a proprietary suite of digital enhancements. Assets toggled on
          become plug-and-play options for your clients inside the Presentation
          Builder.
        </p>
      </div>

      {isStarter && (
        <Card className="border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-primary/10">
          <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15">
                <Lock className="size-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Production Vault is a Pro feature
                </p>
                <p className="text-xs text-muted-foreground">
                  Browse the categories below to see what you can curate — sound
                  libraries, Portal filters, interactive widgets, custom icons,
                  property docs, and external links. Upgrade to Pro to start
                  adding assets.
                </p>
              </div>
            </div>
            <Button onClick={goToPricing} className="shrink-0 gap-2">
              <Lock className="size-4" /> Unlock with Pro
            </Button>
          </CardContent>
        </Card>
      )}

      <div
        className={isStarter ? "pointer-events-none select-none opacity-70" : ""}
        aria-disabled={isStarter}
      >
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as VaultCategory)}
      >
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 h-auto">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const count = assetsByCategory[c.value].length;
            return (
              <TabsTrigger
                key={c.value}
                value={c.value}
                className="flex items-center gap-2"
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{c.label}</span>
                {count > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {count}
                  </Badge>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {CATEGORIES.map((c) => (
          <TabsContent key={c.value} value={c.value} className="space-y-4">
            <CategoryGuide category={c} />

            {c.value === "property_doc" && (
              <div className="flex items-center justify-between rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Define what gets extracted from each uploaded doc.
                </span>
                <Link
                  to="/dashboard/vault/templates"
                  className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                >
                  <FileJson className="size-3.5" /> Manage Templates
                </Link>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">{c.label}</h2>
                <p className="text-xs text-muted-foreground">
                  {assetsByCategory[c.value].length} asset
                  {assetsByCategory[c.value].length === 1 ? "" : "s"} in vault
                </p>
              </div>
              <Button onClick={openCreate} size="sm" disabled={isStarter}>
                {isStarter ? <Lock className="mr-1 size-4" /> : <Plus className="mr-1 size-4" />}
                Add Asset
              </Button>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : assetsByCategory[c.value].length === 0 ? (
              <EmptyState category={c} onAdd={openCreate} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {assetsByCategory[c.value].map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onEdit={() => openEdit(asset)}
                    onDelete={() => handleDelete(asset)}
                    onToggle={(next) => handleToggleActive(asset, next)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      </div>

      {isStarter && (
        <div className="flex justify-center pt-2">
          <Button onClick={goToPricing} size="lg" className="gap-2">
            <Lock className="size-4" /> Unlock the Vault — View Pricing
          </Button>
        </div>
      )}

      <AssetEditorDialog
        open={editorOpen && !isStarter}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setForm(emptyForm);
            setEditingId(null);
          }
        }}
        category={activeCategory}
        form={form}
        setForm={setForm}
        editing={!!editingId}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}

function CategoryGuide({ category }: { category: CategoryMeta }) {
  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">
          Category Guide — {category.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Utility
          </p>
          <p>{category.utility}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Purpose
          </p>
          <p>{category.purpose}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">
            Format
          </p>
          <p>{category.format}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  category,
  onAdd,
}: {
  category: CategoryMeta;
  onAdd: () => void;
}) {
  const Icon = category.icon;
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 text-center">
      <Icon className="mx-auto size-10 text-muted-foreground/60" />
      <p className="mt-3 text-sm font-medium">No {category.label.toLowerCase()} yet</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Start stocking your vault — your clients will see these as selectable
        options.
      </p>
      <Button size="sm" variant="outline" className="mt-4" onClick={onAdd}>
        <Plus className="mr-1 size-4" /> Add your first asset
      </Button>
    </div>
  );
}

function AssetCard({
  asset,
  onEdit,
  onDelete,
  onToggle,
}: {
  asset: VaultAsset;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (next: boolean) => void;
}) {
  const cat = CATEGORY_BY_VALUE[asset.category_type];
  const Icon = cat.icon;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <CardTitle className="truncate text-base">{asset.label}</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor={`switch-${asset.id}`}
              className="text-xs text-muted-foreground whitespace-nowrap"
            >
              Available
            </Label>
            <Switch
              id={`switch-${asset.id}`}
              checked={asset.is_active}
              onCheckedChange={onToggle}
            />
          </div>
        </div>
        {asset.description && (
          <CardDescription className="line-clamp-2">
            {asset.description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2 pt-0">
        <a
          href={asset.asset_url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground truncate"
        >
          <ExternalLink className="size-3 shrink-0" />
          <span className="truncate">
            {asset.storage_path ? "Uploaded file" : asset.asset_url}
          </span>
        </a>
        <div className="flex shrink-0 gap-1">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AssetEditorDialog({
  open,
  onOpenChange,
  category,
  form,
  setForm,
  editing,
  saving,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: CategoryMeta;
  form: AssetFormState;
  setForm: (next: AssetFormState) => void;
  editing: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const urlOnly = !!category.urlOnly;
  const mode = urlOnly ? "url" : form.mode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit" : "Add"} {category.label}
          </DialogTitle>
          <DialogDescription>
            {category.utility} — {category.purpose}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vault-label">Label</Label>
            <Input
              id="vault-label"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Sunset Ambience"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="vault-description">Description (optional)</Label>
            <Textarea
              id="vault-description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Short note shown to clients when picking this asset"
              rows={2}
            />
          </div>

          {!urlOnly && (
            <div className="flex items-center gap-2 rounded-md bg-muted p-1">
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: "upload" })}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === "upload"
                    ? "bg-background shadow"
                    : "text-muted-foreground"
                }`}
              >
                <Upload className="mr-1 inline size-3.5" />
                Upload File
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, mode: "url" })}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === "url"
                    ? "bg-background shadow"
                    : "text-muted-foreground"
                }`}
              >
                <LinkIcon className="mr-1 inline size-3.5" />
                Use URL
              </button>
            </div>
          )}

          {mode === "upload" ? (
            <div className="space-y-2">
              <Label htmlFor="vault-file">
                File <span className="text-muted-foreground">({category.format})</span>
              </Label>
              <Input
                id="vault-file"
                type="file"
                accept={category.accept}
                onChange={(e) =>
                  setForm({ ...form, file: e.target.files?.[0] ?? null })
                }
              />
              {editing && !form.file && (
                <p className="text-xs text-muted-foreground">
                  Leave empty to keep the existing file.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="vault-url">
                {category.textarea ? "URL or embed code" : "URL"}
              </Label>
              {category.textarea ? (
                <Textarea
                  id="vault-url"
                  value={form.asset_url}
                  onChange={(e) =>
                    setForm({ ...form, asset_url: e.target.value })
                  }
                  placeholder={
                    category.value === "visual_hud_filter"
                      ? ".hud { filter: grayscale(1); }"
                      : "<script src=\"https://...\"></script>"
                  }
                  rows={4}
                />
              ) : (
                <Input
                  id="vault-url"
                  value={form.asset_url}
                  onChange={(e) =>
                    setForm({ ...form, asset_url: e.target.value })
                  }
                  placeholder="https://..."
                />
              )}
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
            <div>
              <Label htmlFor="vault-active" className="text-sm font-medium">
                Available to Clients
              </Label>
              <p className="text-xs text-muted-foreground">
                When off, the asset stays in your vault but is hidden from the
                Presentation Builder.
              </p>
            </div>
            <Switch
              id="vault-active"
              checked={form.is_active}
              onCheckedChange={(next) => setForm({ ...form, is_active: next })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : editing ? "Save Changes" : "Add to Vault"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
