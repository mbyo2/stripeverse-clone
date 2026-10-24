import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/ui/empty-state";
import { ArrowLeftRight } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import PageErrorState from "@/components/PageErrorState";
import Countdown from "@/components/p2p/Countdown";
import { P2pAccountCard } from "@/components/p2p/P2pAccountCard";
import { useAuth } from "@/contexts/AuthContext";
import { useP2pMyOrders, useTraderPublicProfiles } from "@/hooks/useP2p";
import {
  formatBtcFromSats,
  formatZmw,
  ORDER_STATUS_META,
  traderDisplayName,
  type P2pOrderStatus,
} from "@/utils/p2pUi";
import { format } from "date-fns";

/** /p2p/orders — every trade I'm part of, newest first. */
export default function P2POrders() {
  const { user } = useAuth();
  const ordersQuery = useP2pMyOrders();
  const orders = useMemo(() => ordersQuery.data ?? [], [ordersQuery.data]);
  const counterpartyIds = useMemo(
    () =>
      orders.map((o) =>
        o.advertiser_id === user?.id ? o.taker_id : o.advertiser_id,
      ),
    [orders, user?.id],
  );
  const profilesQuery = useTraderPublicProfiles(counterpartyIds);

  return (
    <P2pShell title="My Orders" subtitle="Every P2P trade you are part of. Open a trade to pay, confirm, chat or dispute.">
      <P2pAccountCard />
      {ordersQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : ordersQuery.isError ? (
        <PageErrorState
          message={
            ordersQuery.error instanceof Error
              ? ordersQuery.error.message
              : "We couldn't load your orders. Please try again."
          }
          onRetry={() => void ordersQuery.refetch()}
        />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ArrowLeftRight className="h-8 w-8" />}
          title="No trades yet"
          description="When you open an order from the marketplace — or someone opens one on your ad — it will appear here."
          action={{ label: "Browse the marketplace", onClick: () => { window.location.href = "/p2p"; } }}
        />
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const meta = ORDER_STATUS_META[order.status as P2pOrderStatus];
            const buying = order.fiat_buyer_id === user?.id;
            const cpId =
              order.advertiser_id === user?.id ? order.taker_id : order.advertiser_id;
            const cp = profilesQuery.data?.[cpId];
            return (
              <Link key={order.id} to={`/p2p/orders/${order.id}`} className="block">
                <Card className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">
                          {buying ? "Buying from" : "Selling to"}{" "}
                          {traderDisplayName(cp?.nickname, cpId)}
                        </span>
                        <Badge
                          variant={
                            meta.tone === "danger"
                              ? "destructive"
                              : meta.tone === "success"
                                ? "default"
                                : "secondary"
                          }
                        >
                          {meta.headline}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(order.created_at), "d MMM yyyy, HH:mm")} ·
                        Order {order.id.slice(0, 8)}…
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="font-mono font-medium">
                        {formatBtcFromSats(order.crypto_amount_minor)} BTC
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatZmw(Number(order.fiat_amount_zmw))}
                      </div>
                      {order.status === "escrow_locked" && (
                        <Countdown to={order.expires_at} className="text-xs" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </P2pShell>
  );
}
