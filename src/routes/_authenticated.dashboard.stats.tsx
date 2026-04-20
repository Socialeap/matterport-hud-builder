import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { BarChart2, TrendingUp, Calendar, ExternalLink, Save } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export const Route = createFileRoute("/_authenticated/dashboard/stats")({
  component: StatsPage,
});

interface VisitBucket {
  label: string;
  count: number;
}

interface VisitStats {
  weekly: VisitBucket[];
  monthly: VisitBucket[];
  yearly: VisitBucket[];
  total: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd",
  "#818cf8", "#4f46e5", "#7c3aed", "#9333ea",
  "#d946ef", "#ec4899", "#f43f5e", "#fb7185",
];

function buildWeeklyBuckets(rows: { visited_at: string }[]): VisitBucket[] {
  const now = new Date();
  const buckets: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    buckets[d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })] = 0;
  }
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  for (const row of rows) {
    const d = new Date(row.visited_at);
    if (d >= cutoff) {
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      if (key in buckets) buckets[key]++;
    }
  }
  return Object.entries(buckets).map(([label, count]) => ({ label, count }));
}

function buildMonthlyBuckets(rows: { visited_at: string }[]): VisitBucket[] {
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

function buildYearlyBuckets(rows: { visited_at: string }[]): VisitBucket[] {
  const now = new Date();
  const buckets: Record<string, number> = {};
  for (let i = 2; i >= 0; i--) {
    buckets[String(now.getFullYear() - i)] = 0;
  }
  for (const row of rows) {
    const year = String(new Date(row.visited_at).getFullYear());
    if (year in buckets) buckets[year]++;
  }
  return Object.entries(buckets).map(([label, count]) => ({ label, count }));
}

function StatCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof BarChart2 }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="rounded-lg bg-primary/10 p-3">
          <Icon className="size-5 text-primary" />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

interface TrafficPieProps {
  title: string;
  description: string;
  data: VisitBucket[];
}

function TrafficPie({ title, description, data }: TrafficPieProps) {
  const nonZero = data.filter((d) => d.count > 0);
  const isEmpty = nonZero.length === 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No visits yet for this period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={nonZero}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={80}
                label={({ label, percent }) =>
                  `${label} (${(percent * 100).toFixed(0)}%)`
                }
                labelLine={false}
              >
                {nonZero.map((_, index) => (
                  <Cell key={index} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number, name: string) => [value, name]}
              />
              <Legend
                formatter={(value) => (
                  <span className="text-xs text-muted-foreground">{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function StatsPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<VisitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [gaId, setGaId] = useState("");
  const [savingGa, setSavingGa] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!user) return;

    const { data: branding } = await supabase
      .from("branding_settings")
      .select("slug, ga_tracking_id")
      .eq("provider_id", user.id)
      .maybeSingle();

    setSlug(branding?.slug ?? null);
    setGaId((branding as any)?.ga_tracking_id ?? "");

    const { data: visits } = await supabase
      .from("page_visits")
      .select("visited_at")
      .eq("provider_id", user.id)
      .order("visited_at", { ascending: false });

    const rows = visits ?? [];

    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const thisWeek = rows.filter((r) => new Date(r.visited_at) >= startOfWeek).length;
    const thisMonth = rows.filter((r) => new Date(r.visited_at) >= startOfMonth).length;
    const thisYear = rows.filter((r) => new Date(r.visited_at) >= startOfYear).length;

    setStats({
      weekly: buildWeeklyBuckets(rows),
      monthly: buildMonthlyBuckets(rows),
      yearly: buildYearlyBuckets(rows),
      total: rows.length,
      thisWeek,
      thisMonth,
      thisYear,
    });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSaveGaId = async () => {
    if (!user) return;
    setSavingGa(true);
    const { error } = await supabase
      .from("branding_settings")
      .update({ ga_tracking_id: gaId.trim() || null } as any)
      .eq("provider_id", user.id);
    setSavingGa(false);
    if (error) {
      toast.error("Failed to save Google Analytics ID");
    } else {
      toast.success("Google Analytics ID saved");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const studioUrl = slug ? `https://3dps.transcendencemedia.com/p/${slug}` : null;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Traffic Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Studio page visits for your branded presentation portal.
          </p>
        </div>
        {studioUrl && (
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <ExternalLink className="size-4" />
            {studioUrl}
          </a>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Total Visits" value={stats?.total ?? 0} icon={BarChart2} />
        <StatCard label="This Week" value={stats?.thisWeek ?? 0} icon={TrendingUp} />
        <StatCard label="This Month" value={stats?.thisMonth ?? 0} icon={Calendar} />
        <StatCard label="This Year" value={stats?.thisYear ?? 0} icon={TrendingUp} />
      </div>

      {/* Pie charts */}
      <div className="grid gap-6 md:grid-cols-3">
        <TrafficPie
          title="Last 7 Days"
          description="Daily breakdown of studio visits this week."
          data={stats?.weekly ?? []}
        />
        <TrafficPie
          title="Last 12 Months"
          description="Monthly visit distribution over the past year."
          data={stats?.monthly ?? []}
        />
        <TrafficPie
          title="By Year"
          description="Yearly visit totals across all time."
          data={stats?.yearly ?? []}
        />
      </div>

      {/* Google Analytics integration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Google Analytics Integration</CardTitle>
          <CardDescription>
            Connect your Google Analytics property to get richer audience insights,
            session durations, and conversion tracking directly in GA.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ga-id">Tracking ID</Label>
            <p className="text-xs text-muted-foreground">
              Enter your GA4 Measurement ID (e.g.{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">G-XXXXXXXXXX</code>
              ) or Universal Analytics property ID (e.g.{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">UA-XXXXXXXX-X</code>
              ).
            </p>
            <div className="flex gap-2">
              <Input
                id="ga-id"
                placeholder="G-XXXXXXXXXX"
                value={gaId}
                onChange={(e) => setGaId(e.target.value)}
                className="max-w-xs font-mono"
              />
              <Button onClick={handleSaveGaId} disabled={savingGa} size="sm">
                <Save className="mr-1.5 size-4" />
                {savingGa ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          {gaId && (
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">Active</Badge>
              <span className="font-mono text-xs text-muted-foreground">{gaId}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Once saved, the tracking snippet is automatically injected into your public Studio page
            (<code className="font-mono">/p/{slug ?? "your-slug"}</code>) so every visit is
            reported to your Google Analytics property.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
