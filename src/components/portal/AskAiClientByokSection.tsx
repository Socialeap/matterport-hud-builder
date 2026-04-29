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
import { supabase } from "@/integrations/supabase/client";
import { GEMINI_PRICING_COPY, SYNTHESIS_MODEL_LABEL } from "@/lib/pricing-copy";

interface ByokStatus {
  has_key: boolean;
  vendor: string;
  fingerprint: string | null;
  active: boolean;
  validated_at: string | null;
  validation_error: string | null;
  created_at: string | null;
}

const INITIAL: ByokStatus = {
  has_key: false,
  vendor: "gemini",
  fingerprint: null,
  active: false,
  validated_at: null,
  validation_error: null,
  created_at: null,
};

/**
 * Client-facing BYOK panel — mounted inside the Builder's Property Intelligence
 * section. The first 20 visitor questions per property are funded by
 * Transcendence Media; this panel lets the property owner add their own
 * Gemini API key to keep Ask AI running past that subsidy.
 *
 * Server-side this writes to `client_byok_keys` keyed on auth.uid() (the
 * builder owner). MSPs/admins are filtered out at the parent level.
 */
export function AskAiClientByokSection() {
  const [status, setStatus] = useState<ByokStatus>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [reveal, setReveal] = useState(false);

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
      setStatus({
        has_key: !!row.has_key,
        vendor: row.vendor ?? "gemini",
        fingerprint: row.fingerprint ?? null,
        active: !!row.active,
        validated_at: row.validated_at ?? null,
        validation_error: row.validation_error ?? null,
        created_at: row.created_at ?? null,
      });
    } else {
      setStatus(INITIAL);
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
        body: { api_key: apiKey, vendor: "gemini" },
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
                Active · {SYNTHESIS_MODEL_LABEL}
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
