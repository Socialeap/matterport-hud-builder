import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, TrendingUp, Download, DollarSign, Search } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: AdminIndex,
});

interface ProviderRow {
  provider_id: string;
  brand_name: string;
  slug: string;
  tier: "starter" | "pro";
  display_name: string | null;
  email: string;
  start_date: string;
  // aggregates
  visits: number;
  clients: number;
  downloads: number;
  revenue_cents: number;
}

const COLORS = [
  "#6366f1", "#8b5cf6", "#a78bfa", "#4f46e5", "#7c3aed",
  "#d946ef", "#ec4899", "#f43f5e", "#fb7185", "#c4b5fd",
];

function fmtUsd(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function AdminIndex() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    setLoading(true);
    const { data: providerData, error } = await supabase.rpc("get_providers_for_admin");
    if (error || !providerData) {
      setLoading(false);
      return;
    }

    const ids = providerData.map((p: any) => p.provider_id as string);

    const [visitsRes, clientsRes, modelsRes] = await Promise.all([
      supabase.from("page_visits").select("provider_id").in("provider_id", ids),
      supabase.from("client_providers").select("provider_id").in("provider_id", ids),
      supabase.from("saved_models").select("provider_id, amount_cents, status, is_released").in("provider_id", ids),
    ]);

    const visitMap: Record<string, number> = {};
    const clientMap: Record<string, Set<string>> = {};
    const downloadMap: Record<string, number> = {};
    const revenueMap: Record<string, number> = {};

    for (const v of visitsRes.data ?? []) {
      visitMap[v.provider_id] = (visitMap[v.provider_id] ?? 0) + 1;
    }
    for (const c of clientsRes.data ?? []) {
      if (!clientMap[c.provider_id]) clientMap[c.provider_id] = new Set();
      clientMap[c.provider_id].add(c.provider_id);
    }
    // Re-count clients properly (unique client_id per provider)
    const { data: clientsDetailed } = await supabase
      .from("client_providers")
      .select("provider_id, client_id")
      .in("provider_id", ids);
    for (const c of clientsDetailed ?? []) {
      if (!clientMap[c.provider_id]) clientMap[c.provider_id] = new Set();
      clientMap[c.provider_id].add(c.client_id);
    }
    for (const m of modelsRes.data ?? []) {
      if (m.is_released) downloadMap[m.provider_id] = (downloadMap[m.provider_id] ?? 0) + 1;
      if (m.status === "paid" && m.amount_cents)
        revenueMap[m.provider_id] = (revenueMap[m.provider_id] ?? 0) + m.amount_cents;
    }

    const enriched: ProviderRow[] = providerData.map((p: any) => ({
      ...p,
      visits: visitMap[p.provider_id] ?? 0,
      clients: clientMap[p.provider_id]?.size ?? 0,
      downloads: downloadMap[p.provider_id] ?? 0,
      revenue_cents: revenueMap[p.provider_id] ?? 0,
    }));

    setProviders(enriched);
    setLoading(false);
  }

  const filtered = providers.filter((p) => {
    const q = search.toLowerCase();
    return (
      !q ||
      p.brand_name?.toLowerCase().includes(q) ||
      p.email?.toLowerCase().includes(q) ||
      p.slug?.toLowerCase().includes(q)
    );
  });

  const topByVisits = [...providers]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);

  const totalVisits = providers.reduce((s, p) => s + p.visits, 0);
  const totalClients = providers.reduce((s, p) => s + p.clients, 0);
  const totalDownloads = providers.reduce((s, p) => s + p.downloads, 0);
  const totalRevenue = providers.reduce((s, p) => s + p.revenue_cents, 0);

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">MSP Overview</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard icon={<Users className="size-4" />} label="Total MSPs" value={providers.length} />
        <StatCard icon={<TrendingUp className="size-4" />} label="Total Visits" value={totalVisits} />
        <StatCard icon={<Users className="size-4" />} label="Total Clients" value={totalClients} />
        <StatCard icon={<DollarSign className="size-4" />} label="Total Revenue" value={fmtUsd(totalRevenue)} />
      </div>

      {/* Traffic bar chart */}
      {topByVisits.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top MSPs by Visits (last all-time)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topByVisits} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <XAxis
                  dataKey="brand_name"
                  tick={{ fontSize: 11 }}
                  interval={0}
                  angle={-30}
                  textAnchor="end"
                  height={50}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [v, "Visits"]} />
                <Bar dataKey="visits" radius={[4, 4, 0, 0]}>
                  {topByVisits.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Search + table */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by brand, email, or slug…"
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              {["Brand", "Email", "Slug", "Joined", "Tier", "Clients", "Downloads", "Revenue", ""].map(
                (h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.provider_id} className="border-t border-border hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{p.brand_name}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.email}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.slug}</td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {new Date(p.start_date).toLocaleDateString()}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={p.tier === "pro" ? "default" : "secondary"} className="capitalize">
                    {p.tier}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right">{p.clients}</td>
                <td className="px-3 py-2 text-right">{p.downloads}</td>
                <td className="px-3 py-2 text-right">{fmtUsd(p.revenue_cents)}</td>
                <td className="px-3 py-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to="/admin/$providerId" params={{ providerId: p.provider_id }}>
                      View
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  No MSPs found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
