import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ExternalLink, ArrowLeft, AlertTriangle } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { buildStudioUrl } from "@/lib/public-url";

export const Route = createFileRoute("/_authenticated/admin/$providerId")({
  component: AdminProviderDetail,
});

interface ProviderDetail {
  provider_id: string;
  brand_name: string;
  slug: string | null;
  tier: "starter" | "pro";
  email: string;
  start_date: string;
  base_price_cents: number | null;
  model_threshold: number | null;
  additional_model_fee_cents: number | null;
  flat_price_per_model_cents: number | null;
  use_flat_pricing: boolean | null;
  stripe_onboarding_complete: boolean | null;
}

interface Grant {
  id: string;
  tier: "starter" | "pro";
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

interface MonthBucket {
  label: string;
  count: number;
}

const DURATIONS: { label: string; months: number | null }[] = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
  { label: "Lifetime", months: null },
];

function buildMonthlyBuckets(rows: { visited_at: string }[]): MonthBucket[] {
  const now = new Date();
  const buckets: Record<string, number> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets[d.toLocaleDateString("en-US", { month: "short", year: "numeric" })] = 0;
  }
  for (const row of rows) {
    const d = new Date(row.visited_at);
    const key = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    if (key in buckets) buckets[key]++;
  }
  return Object.entries(buckets).map(([label, count]) => ({ label, count }));
}

function fmtUsd(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function AdminProviderDetail() {
  const { providerId } = Route.useParams();
  const { user } = useAuth();

  const [detail, setDetail] = useState<ProviderDetail | null>(null);
  const [grant, setGrant] = useState<Grant | null>(null);
  const [visits, setVisits] = useState<{ visited_at: string }[]>([]);
  const [clientCount, setClientCount] = useState(0);
  const [downloadCount, setDownloadCount] = useState(0);
  const [revenueCents, setRevenueCents] = useState(0);

  const [grantTier, setGrantTier] = useState<"starter" | "pro">("pro");
  const [grantDuration, setGrantDuration] = useState<number | null>(3);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    loadData();
  }, [providerId]);

  async function loadData() {
    const [bsRes, profilesRes, grantRes] = await Promise.all([
      supabase
        .from("branding_settings")
        .select("provider_id, brand_name, slug, tier, base_price_cents, model_threshold, additional_model_fee_cents, flat_price_per_model_cents, use_flat_pricing, stripe_onboarding_complete")
        .eq("provider_id", providerId)
        .maybeSingle(),
      supabase.rpc("get_providers_for_admin"),
      supabase
        .from("admin_grants")
        .select("id, tier, expires_at, revoked_at, created_at")
        .eq("provider_id", providerId)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (bsRes.data) {
      const providerRow = (profilesRes.data ?? []).find(
        (p: any) => p.provider_id === providerId
      );
      setDetail({
        ...bsRes.data,
        email: providerRow?.email ?? "",
        start_date: providerRow?.start_date ?? "",
      });
    }

    if (grantRes.data) setGrant(grantRes.data as Grant);

    const [visitsRes, clientsRes, modelsRes] = await Promise.all([
      supabase.from("page_visits").select("visited_at").eq("provider_id", providerId),
      supabase.from("client_providers").select("client_id").eq("provider_id", providerId),
      supabase
        .from("saved_models")
        .select("is_released, amount_cents, status")
        .eq("provider_id", providerId),
    ]);

    setVisits(visitsRes.data ?? []);
    setClientCount((clientsRes.data ?? []).length);
    const models = modelsRes.data ?? [];
    setDownloadCount(models.filter((m) => m.is_released).length);
    setRevenueCents(
      models
        .filter((m) => m.status === "paid" && m.amount_cents)
        .reduce((s, m) => s + (m.amount_cents ?? 0), 0)
    );
  }

  async function handleGrant() {
    if (!user || !detail) return;
    setGranting(true);

    const expiresAt =
      grantDuration !== null
        ? new Date(Date.now() + grantDuration * 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;

    const { data: newGrant, error: grantErr } = await supabase
      .from("admin_grants")
      .insert({
        provider_id: providerId,
        granted_by: user.id,
        tier: grantTier,
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (grantErr) {
      toast.error("Failed to create grant: " + grantErr.message);
      setGranting(false);
      return;
    }

    const { error: bsErr } = await supabase
      .from("branding_settings")
      .update({ tier: grantTier })
      .eq("provider_id", providerId);

    if (bsErr) {
      toast.error("Grant created but tier update failed: " + bsErr.message);
      setGranting(false);
      return;
    }

    const { error: licErr } = await supabase
      .from("licenses")
      .upsert(
        {
          user_id: providerId,
          tier: grantTier,
          license_status: "active",
          license_expiry: expiresAt,
        },
        { onConflict: "user_id" }
      );

    if (licErr) {
      toast.error("Grant created but license upsert failed: " + licErr.message);
    } else {
      toast.success("Access granted successfully.");
    }

    setGrant(newGrant as Grant);
    if (detail) setDetail({ ...detail, tier: grantTier });
    setGranting(false);
  }

  async function handleRevoke() {
    if (!grant) return;
    setRevoking(true);

    const { error: revokeErr } = await supabase
      .from("admin_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", grant.id);

    if (revokeErr) {
      toast.error("Revocation failed: " + revokeErr.message);
      setRevoking(false);
      return;
    }

    await supabase
      .from("branding_settings")
      .update({ tier: "starter" })
      .eq("provider_id", providerId);

    await supabase
      .from("licenses")
      .update({ tier: "starter", license_status: "active", license_expiry: null })
      .eq("user_id", providerId);

    toast.success("Grant revoked. Tier reverted to Starter.");
    setGrant(null);
    if (detail) setDetail({ ...detail, tier: "starter" });
    setRevoking(false);
  }

  const monthlyData = buildMonthlyBuckets(visits);

  if (!detail) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const studioUrl = buildStudioUrl(detail.slug, { tier: detail.tier });
  const activeGrant = grant && !grant.revoked_at ? grant : null;
  const isExpired = activeGrant?.expires_at
    ? new Date(activeGrant.expires_at) < new Date()
    : false;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin">
            <ArrowLeft className="size-4 mr-1" /> All MSPs
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{detail.brand_name}</h1>
          <Badge variant={detail.tier === "pro" ? "default" : "secondary"} className="capitalize">
            {detail.tier}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{detail.email}</span>
          <span>Joined {detail.start_date ? new Date(detail.start_date).toLocaleDateString() : "—"}</span>
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-primary hover:underline"
          >
            {studioUrl.replace("https://", "")}
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MiniStat label="Visits (all-time)" value={visits.length} />
        <MiniStat label="Clients" value={clientCount} />
        <MiniStat label="Downloads" value={downloadCount} />
        <MiniStat label="Revenue" value={fmtUsd(revenueCents)} />
      </div>

      {/* Traffic chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly Visits (last 12 months)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={2} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip formatter={(v: number) => [v, "Visits"]} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Pricing structure */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pricing Structure</CardTitle>
          <CardDescription>Read-only — MSP-configured in their dashboard</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <PricingField label="Base price" value={fmtUsd(detail.base_price_cents)} />
          <PricingField label="Model threshold" value={detail.model_threshold ?? "—"} />
          <PricingField label="Additional model fee" value={fmtUsd(detail.additional_model_fee_cents)} />
          <PricingField label="Flat price/model" value={fmtUsd(detail.flat_price_per_model_cents)} />
          <PricingField label="Flat pricing" value={detail.use_flat_pricing ? "Yes" : "No"} />
          <PricingField label="Stripe connected" value={detail.stripe_onboarding_complete ? "Yes" : "No"} />
        </CardContent>
      </Card>

      {/* Active grant */}
      {activeGrant && !isExpired && (
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-600" />
              Active Grant
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="text-sm space-y-0.5">
              <p>
                Tier: <strong className="capitalize">{activeGrant.tier}</strong>
              </p>
              <p>
                Expires:{" "}
                <strong>
                  {activeGrant.expires_at
                    ? new Date(activeGrant.expires_at).toLocaleDateString()
                    : "Lifetime"}
                </strong>
              </p>
              <p className="text-muted-foreground text-xs">
                Granted {new Date(activeGrant.created_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRevoke}
              disabled={revoking}
            >
              {revoking ? "Revoking…" : "Revoke"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Grant form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Grant Cost-Free Access</CardTitle>
          <CardDescription>
            Overrides the MSP's current tier for the selected period.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">Tier</p>
            <div className="flex gap-3">
              {(["starter", "pro"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="grantTier"
                    value={t}
                    checked={grantTier === t}
                    onChange={() => setGrantTier(t)}
                    className="accent-primary"
                  />
                  <span className="capitalize">{t}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-sm font-medium">Duration</p>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setGrantDuration(d.months)}
                  className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    grantDuration === d.months
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background hover:bg-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <Button onClick={handleGrant} disabled={granting}>
            {granting ? "Granting…" : "Grant Access"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
        <p className="text-xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}

function PricingField({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}
