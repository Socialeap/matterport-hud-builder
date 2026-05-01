import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getProviderOrders,
  grantFreePresentationDownload,
  type ProviderOrderRow,
} from "@/lib/portal.functions";
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
import { CheckCircle, Download, Clock, Eye, Gift } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard/orders")({
  component: OrdersPage,
});

type ModelStatus = ProviderOrderRow["modelStatus"];

interface OrderRow {
  id: string;
  modelId: string;
  clientId: string;
  providerId: string;
  notificationStatus: string;
  createdAt: string;
  modelName: string;
  modelStatus: ModelStatus;
  isReleased: boolean;
  amountCents: number | null;
  modelCount: number | null;
  clientEmail: string | null;
  clientName: string | null;
  counterpartyName: string | null;
}

function OrdersPage() {
  const { user, roles } = useAuth();
  const isClient = roles.includes("client") && !roles.includes("provider") && !roles.includes("admin");
  const fetchProviderOrders = useServerFn(getProviderOrders);
  const grantFreeDownload = useServerFn(grantFreePresentationDownload);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingModelId, setUpdatingModelId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!user) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      if (!isClient) {
        const result = await fetchProviderOrders();
        if (result.error) {
          toast.error(result.error);
        }
        setOrders(
          result.orders.map((order) => ({
            id: order.id,
            modelId: order.modelId,
            clientId: order.clientId,
            providerId: user.id,
            notificationStatus: order.notificationStatus,
            createdAt: order.createdAt,
            modelName: order.modelName,
            modelStatus: order.modelStatus,
            isReleased: order.isReleased,
            amountCents: order.amountCents,
            modelCount: order.modelCount,
            clientEmail: order.clientEmail,
            clientName: order.clientName,
            counterpartyName: order.clientName,
          })),
        );
        return;
      }

      const { data: notifications } = await supabase
        .from("order_notifications")
        .select("*")
        .eq("client_id", user.id)
        .order("created_at", { ascending: false });

      if (!notifications || notifications.length === 0) {
        setOrders([]);
        return;
      }

      const modelIds = notifications.map((notification) => notification.model_id);
      const providerIds = [...new Set(notifications.map((notification) => notification.provider_id))];

      const [{ data: models }, { data: brands }] = await Promise.all([
        supabase
          .from("saved_models")
          .select("id, name, status, is_released, amount_cents, model_count")
          .in("id", modelIds),
        supabase
          .from("branding_settings")
          .select("provider_id, brand_name")
          .in("provider_id", providerIds),
      ]);

      const modelMap = new Map((models ?? []).map((model) => [model.id, model]));
      const brandMap = new Map((brands ?? []).map((brand) => [brand.provider_id, brand.brand_name]));

      setOrders(
        notifications.map((notification) => {
          const model = modelMap.get(notification.model_id);
          return {
            id: notification.id,
            modelId: notification.model_id,
            clientId: notification.client_id,
            providerId: notification.provider_id,
            notificationStatus: notification.status,
            createdAt: notification.created_at,
            modelName: model?.name || "Unknown",
            modelStatus: (model?.status || "preview") as ModelStatus,
            isReleased: model?.is_released || false,
            amountCents: model?.amount_cents ?? null,
            modelCount: model?.model_count ?? null,
            clientEmail: null,
            clientName: null,
            counterpartyName: brandMap.get(notification.provider_id) || "Provider",
          };
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load orders");
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [fetchProviderOrders, isClient, user]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleMarkPaid = async (modelId: string) => {
    setUpdatingModelId(modelId);
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
    setUpdatingModelId(null);
  };

  const handleRelease = async (modelId: string) => {
    setUpdatingModelId(modelId);
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
    setUpdatingModelId(null);
  };

  const handleGrantFreeDownload = async (modelId: string) => {
    setUpdatingModelId(modelId);
    try {
      const result = await grantFreeDownload({ data: { modelId } });
      toast.success(
        result.alreadyPaid
          ? "Presentation is already paid"
          : "Free download approved for this presentation",
      );
      fetchOrders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve free download");
    } finally {
      setUpdatingModelId(null);
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
    <div className="mx-auto max-w-6xl space-y-6">
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
                : "Review requests, approve one-time free downloads, mark payments, and release files."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table className="min-w-[980px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Presentation</TableHead>
                  {!isClient && <TableHead>Client</TableHead>}
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
                  <TableRow
                    key={order.id}
                    className={order.notificationStatus === "unread" && !isClient ? "bg-primary/5" : ""}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{order.modelName}</p>
                        <p className="text-xs text-muted-foreground">
                          {isClient
                            ? `From: ${order.counterpartyName || "Provider"}`
                            : `ID: ${order.clientId.slice(0, 8)}...`}
                        </p>
                      </div>
                    </TableCell>
                    {!isClient && (
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">
                            {order.clientEmail ?? "Email unavailable"}
                          </p>
                          {order.clientName && order.clientName !== order.clientEmail && (
                            <p className="text-xs text-muted-foreground">{order.clientName}</p>
                          )}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(order.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.modelCount ?? "-"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {order.amountCents === 0
                        ? "Free"
                        : order.amountCents != null
                          ? `$${(order.amountCents / 100).toFixed(2)}`
                          : "-"}
                    </TableCell>
                    <TableCell>
                      {order.modelStatus === "paid" ? (
                        <Badge variant={order.amountCents === 0 ? "default" : "outline"}>
                          {order.amountCents === 0 ? "Free" : "Paid"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {order.isReleased ? (
                        <CheckCircle className="size-4 text-green-500" />
                      ) : (
                        <span className="text-xs text-muted-foreground">No</span>
                      )}
                    </TableCell>
                    {!isClient && (
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {order.notificationStatus === "unread" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMarkRead(order.id)}
                              aria-label="Mark order as read"
                            >
                              <Eye className="size-3" />
                            </Button>
                          )}
                          {order.modelStatus !== "paid" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatingModelId === order.modelId}
                              onClick={() => handleGrantFreeDownload(order.modelId)}
                            >
                              <Gift className="mr-1 size-3" />
                              Make Free
                            </Button>
                          )}
                          {order.modelStatus !== "paid" && order.amountCents == null && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatingModelId === order.modelId}
                              onClick={() => handleMarkPaid(order.modelId)}
                            >
                              Mark Paid
                            </Button>
                          )}
                          {order.modelStatus === "paid" && !order.isReleased && order.amountCents == null && (
                            <Button
                              size="sm"
                              disabled={updatingModelId === order.modelId}
                              onClick={() => handleRelease(order.modelId)}
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
