import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { CheckCircle, Download, Clock, Eye } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/orders")({
  component: OrdersPage,
});

interface OrderRow {
  id: string;
  model_id: string;
  client_id: string;
  provider_id: string;
  status: string;
  created_at: string;
  model_name: string;
  model_status: string;
  is_released: boolean;
  amount_cents: number | null;
  model_count: number | null;
}

function OrdersPage() {
  const { user, roles } = useAuth();
  const isClient = roles.includes("client") && !roles.includes("provider") && !roles.includes("admin");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  // For providers: client display names. For clients: provider brand names.
  const [counterpartyNames, setCounterpartyNames] = useState<Map<string, string>>(new Map());

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    const query = supabase
      .from("order_notifications")
      .select("*")
      .order("created_at", { ascending: false });
    const { data: notifications } = isClient
      ? await query.eq("client_id", user.id)
      : await query.eq("provider_id", user.id);

    if (!notifications || notifications.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }

    const modelIds = notifications.map((n) => n.model_id);
    const { data: models } = await supabase
      .from("saved_models")
      .select("id, name, status, is_released, amount_cents, model_count")
      .in("id", modelIds);

    const modelMap = new Map(models?.map((m) => [m.id, m]) || []);

    const nameMap = new Map<string, string>();
    if (isClient) {
      // Resolve provider brand names
      const providerIds = [...new Set(notifications.map((n) => n.provider_id))];
      const { data: brands } = await supabase
        .from("branding_settings")
        .select("provider_id, brand_name")
        .in("provider_id", providerIds);
      brands?.forEach((b) => {
        if (b.brand_name) nameMap.set(b.provider_id, b.brand_name);
      });
    } else {
      const clientIds = [...new Set(notifications.map((n) => n.client_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", clientIds);
      profiles?.forEach((p) => {
        if (p.display_name) nameMap.set(p.user_id, p.display_name);
      });
    }
    setCounterpartyNames(nameMap);

    const rows: OrderRow[] = notifications.map((n) => {
      const model = modelMap.get(n.model_id);
      return {
        id: n.id,
        model_id: n.model_id,
        client_id: n.client_id,
        provider_id: n.provider_id,
        status: n.status,
        created_at: n.created_at,
        model_name: model?.name || "Unknown",
        model_status: model?.status || "preview",
        is_released: model?.is_released || false,
        amount_cents: model?.amount_cents ?? null,
        model_count: model?.model_count ?? null,
      };
    });

    setOrders(rows);
    setLoading(false);
  }, [user, isClient]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleMarkPaid = async (modelId: string) => {
    const { error } = await supabase
      .from("saved_models")
      .update({ status: "paid" as const })
      .eq("id", modelId);
    if (error) {
      toast.error("Failed to update status");
    } else {
      toast.success("Marked as paid");
      fetchOrders();
    }
  };

  const handleRelease = async (modelId: string) => {
    const { error } = await supabase
      .from("saved_models")
      .update({ is_released: true })
      .eq("id", modelId);
    if (error) {
      toast.error("Failed to release file");
    } else {
      toast.success("File released to client");
      fetchOrders();
    }
  };

  const handleMarkRead = async (notificationId: string) => {
    await supabase
      .from("order_notifications")
      .update({ status: "read" })
      .eq("id", notificationId);
    fetchOrders();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {isClient ? "My Orders" : "Orders"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isClient
            ? "Your purchased presentations and their delivery status."
            : "Manage client presentation requests and fulfillment."}
        </p>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h3 className="mt-4 text-lg font-semibold text-foreground">No orders yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isClient
                ? "When you purchase a presentation, it will appear here."
                : "When clients request presentations through your Studio, they'll appear here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isClient ? "Your purchases" : "Pending & Completed Orders"}
            </CardTitle>
            <CardDescription>
              {isClient
                ? "Track payment status and download released presentations."
                : "Review requests, mark payments, and release files to clients."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Presentation</TableHead>
                  <TableHead>Date</TableHead>
                   <TableHead>Models</TableHead>
                   <TableHead>Amount</TableHead>
                   <TableHead>Payment</TableHead>
                   <TableHead>Released</TableHead>
                   {!isClient && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => (
                  <TableRow key={order.id} className={order.status === "unread" && !isClient ? "bg-primary/5" : ""}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{order.model_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {isClient
                            ? `From: ${counterpartyNames.get(order.provider_id) || "Provider"}`
                            : `Client: ${counterpartyNames.get(order.client_id) || order.client_id.slice(0, 8) + "…"}`}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(order.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                       {order.model_count ?? "—"}
                     </TableCell>
                     <TableCell className="text-sm text-muted-foreground">
                       {order.amount_cents != null ? `$${(order.amount_cents / 100).toFixed(2)}` : "—"}
                     </TableCell>
                     <TableCell>
                       {order.model_status === "paid" ? (
                         <Badge variant="default">{isClient ? "Paid" : "Auto-paid"}</Badge>
                       ) : (
                         <Badge variant="secondary">Pending</Badge>
                       )}
                     </TableCell>
                    <TableCell>
                      {order.is_released ? (
                        <CheckCircle className="size-4 text-green-500" />
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    {!isClient && (
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {order.status === "unread" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMarkRead(order.id)}
                            >
                              <Eye className="size-3" />
                            </Button>
                          )}
                          {order.model_status !== "paid" && order.amount_cents == null && (
                             <Button
                               size="sm"
                               variant="outline"
                               onClick={() => handleMarkPaid(order.model_id)}
                             >
                               Mark Paid
                             </Button>
                           )}
                           {order.model_status === "paid" && !order.is_released && order.amount_cents == null && (
                             <Button
                               size="sm"
                               onClick={() => handleRelease(order.model_id)}
                             >
                               <Download className="mr-1 size-3" />
                               Release
                             </Button>
                           )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
