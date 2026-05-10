import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { GEMINI_PRICING_COPY } from "@/lib/pricing-copy";

type PreferredModel =
  | "gemini-2.5-flash-lite"
  | "gemini-2.5-flash"
  | "gemini-2.5-pro";

const DEFAULT_MODEL: PreferredModel = "gemini-2.5-flash-lite";

const MODEL_OPTIONS: Array<{
  value: PreferredModel;
  label: string;
  blurb: string;
  price: string;
}> = [
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite — Recommended",
    blurb: "Best value. Ideal for high-volume RAG Q&A.",
    price: "$0.10 in / $0.40 out per 1M tokens",
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash — Balanced",
    blurb: "Stronger reasoning for nuanced visitor questions.",
    price: "$0.30 in / $2.50 out per 1M tokens",
  },
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro — Premium",
    blurb: "Top-tier quality for complex, multi-step queries.",
    price: "$1.25 in / $10.00 out per 1M tokens",
  },
];

interface ByokStatus {
  has_key: boolean;
  vendor: string;
  fingerprint: string | null;
  active: boolean;
  validated_at: string | null;
  validation_error: string | null;
  created_at: string | null;
  preferred_model: PreferredModel | null;
}

const INITIAL: ByokStatus = {
  has_key: false,
  vendor: "gemini",
  fingerprint: null,
  active: false,
  validated_at: null,
  validation_error: null,
  created_at: null,
  preferred_model: null,
};

export function AskAiClientByokSection() {
  const [status, setStatus] = useState<ByokStatus>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [draftModel, setDraftModel] = useState<PreferredModel>(DEFAULT_MODEL);
  const [savingModel, setSavingModel] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const { data, error } = await (
      supabase.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: unknown }>
    )("read_byok_status", { p_vendor: "gemini" });
    setLoading(false);
    if (error) {
      console.warn("[byok] read_byok_status failed:", error);
      return;
    }
    if (Array.isArray(data) && data.length > 0) {
      const row = data[0] as Partial<ByokStatus>;
      const next: ByokStatus = {
        has_key: !!row.has_key,
        vendor: row.vendor ?? "gemini",
        fingerprint: row.fingerprint ?? null,
        active: !!row.active,
        validated_at: row.validated_at ?? null,
        validation_error: row.validation_error ?? null,
        created_at: row.created_at ?? null,
        preferred_model: (row.preferred_model as PreferredModel | null) ?? null,
      };
      setStatus(next);
      setDraftModel((next.preferred_model as PreferredModel) ?? DEFAULT_MODEL);
    } else {
      setStatus(INITIAL);
      setDraftModel(DEFAULT_MODEL);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSave = async () => {
    const apiKey = draftKey.trim();
    if (apiKey.length < 20) {
      toast.error("That doesn't look like a Gemini API key.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        valid: boolean;
        reason?: string;
        fingerprint?: string;
      }>("validate-byok", {
        body: {
          api_key: apiKey,
          vendor: "gemini",
          preferred_model: draftModel,
        },
      });
      if (error) {
        toast.error(`Validation failed: ${error.message}`);
        return;
      }
      if (!data?.ok || !data.valid) {
        const reason = data?.reason ?? "unknown";
        toast.error(`Gemini rejected the key (${reason}).`);
        await refresh();
        return;
      }
      toast.success("Gemini API key validated. Ask AI now uses your key.");
      setDraftKey("");
      setShowInput(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!status.has_key) return;
    if (
      !confirm(
        "Remove your Gemini API key? Visitor questions will fall back to the 20 free Transcendence-Media-funded answers per property until that subsidy is exhausted, then visitors will see the Get-In-Touch form.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.functions.invoke("validate-byok", {
        method: "DELETE",
      });
      if (error) {
        toast.error(`Removal failed: ${error.message}`);
        return;
      }
      toast.success("Gemini API key removed.");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleModelChange = async (next: PreferredModel) => {
    setDraftModel(next);
    if (!status.has_key) return; // only persist when there's a key to attach it to
    setSavingModel(true);
    try {
      const { error } = await supabase.functions.invoke("validate-byok", {
        body: {
          vendor: "gemini",
          update_model_only: true,
          preferred_model: next,
        },
      });
      if (error) {
        toast.error(`Couldn't update model: ${error.message}`);
        return;
      }
      toast.success(
        `Ask AI now uses ${MODEL_OPTIONS.find((m) => m.value === next)?.label}.`,
      );
      await refresh();
    } finally {
      setSavingModel(false);
    }
  };

  const activeModel: PreferredModel =
    (status.preferred_model as PreferredModel) ?? DEFAULT_MODEL;
  const activeModelLabel =
    MODEL_OPTIONS.find((m) => m.value === activeModel)?.label ?? activeModel;

  return (
    <Card id="ask-ai-byok" className="border-primary/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="size-4 text-primary" />
          <CardTitle className="text-base">
            Ask AI · Your Gemini API key (optional)
          </CardTitle>
        </div>
        <CardDescription>
          Each published property includes <strong>20 free visitor answers</strong>{" "}
          funded by Transcendence Media. Add your own Gemini API key here to
          keep Ask AI running for visitors after that subsidy. Your key stays
          encrypted and is only used to answer questions about your properties.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Checking key status…
          </div>
        ) : status.active && status.has_key ? (
          <div className="flex items-start gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium text-foreground">
                Active · {activeModelLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                Key {status.fingerprint ?? "••••••••"} ·{" "}
                {status.validated_at
                  ? `validated ${new Date(status.validated_at).toLocaleString()}`
                  : "validated"}
              </p>
            </div>
            <Badge variant="outline" className="text-emerald-700">
              <CheckCircle2 className="mr-1 size-3" />
              In use
            </Badge>
          </div>
        ) : status.has_key && status.validation_error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              Your last key didn't validate
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reason: {status.validation_error}. Ask AI is using the
              Transcendence-Media-funded subsidy until you replace it.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium text-foreground">
              Using the free Transcendence-Media subsidy
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Each property gets 20 free Ask AI answers. After that, visitors
              see the Get-In-Touch form until you add your own Gemini key.
            </p>
          </div>
        )}

        {/* Model selector — controls primary model for visitor Q&A. */}
        <div className="space-y-2 rounded-md border border-border/60 bg-muted/10 p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="byok-model" className="text-xs font-medium">
              Synthesis model
            </Label>
            {savingModel && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>
          <Select
            value={draftModel}
            onValueChange={(v) => handleModelChange(v as PreferredModel)}
            disabled={busy || savingModel}
          >
            <SelectTrigger id="byok-model" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  <div className="flex flex-col">
                    <span className="text-sm">{opt.label}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {opt.blurb} · {opt.price}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            Flash-Lite is the most cost-efficient choice and is the
            recommended default for grounded RAG answers. Pick a stronger
            model only if your visitors ask complex, multi-step questions.
            {!status.has_key && " Saved when you add your key."}
          </p>
        </div>

        <div className="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
          <p className="leading-relaxed">{GEMINI_PRICING_COPY.short}</p>
          <a
            href={GEMINI_PRICING_COPY.reference}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block underline hover:text-foreground"
          >
            ai.google.dev/gemini-api/docs/pricing
          </a>
        </div>

        {!showInput ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setShowInput(true)}
              disabled={busy}
            >
              {status.has_key ? "Replace key" : "Add my Gemini key"}
            </Button>
            {status.has_key && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemove}
                disabled={busy}
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="mr-1 size-3.5" />
                Remove key
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-byok-input" className="text-xs">
                Gemini API key
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="client-byok-input"
                  type={reveal ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="AIzaSy..."
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  disabled={busy}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setReveal((v) => !v)}
                  aria-label={reveal ? "Hide key" : "Reveal key"}
                >
                  {reveal ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                We probe your key against Google before saving. The plaintext
                value is encrypted at rest and never returned to the browser.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                disabled={busy || draftKey.trim().length < 20}
              >
                {busy ? (
                  <Loader2 className="mr-1 size-3.5 animate-spin" />
                ) : null}
                Validate &amp; save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowInput(false);
                  setDraftKey("");
                  setReveal(false);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
