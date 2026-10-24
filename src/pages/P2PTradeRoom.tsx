import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ShieldAlert } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import OrderStatusStepper from "@/components/p2p/OrderStatusStepper";
import Countdown from "@/components/p2p/Countdown";
import TradeChat from "@/components/p2p/TradeChat";
import P2pReceiptButton from "@/components/p2p/P2pReceiptButton";
import PageErrorState from "@/components/PageErrorState";
import {
  CancelOrderButton,
  CounterpartyActions,
  MarkPaidForm,
  OpenDisputeDialog,
  ReleaseForm,
} from "@/components/p2p/TradeActions";
import { useAuth } from "@/contexts/AuthContext";
import {
  useP2pDisputeByOrder,
  useP2pOrder,
  useP2pOrderClaim,
  useTraderPublicProfiles,
} from "@/hooks/useP2p";
import {
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  formatBtcFromSats,
  formatZmw,
  isTerminalP2pOrderStatus,
  ORDER_STATUS_META,
  paymentMethodTypeLabel,
  traderDisplayName,
  type P2pOrderStatus,
} from "@/utils/p2pUi";
import type { P2pReceiptData } from "@/utils/p2pUi";
import { format } from "date-fns";

/**
 * /p2p/orders/:id — the trade room (§4.4). Escrow state machine
 * shown honestly; the seller's payment details exist on the order
 * row itself, which is only created AFTER the crypto locked — so
 * rendering them from the order is the mirror of the server rule
 * "no details before lock": a failed create returns no order and
 * this page never exists for it.
 */
export default function P2PTradeRoom() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const orderQuery = useP2pOrder(id, true);
  const order = orderQuery.data;
  // The claim can only appear/change while the trade is live — stop
  // polling it once the order settles (scalability fix #5).
  const claimQuery = useP2pOrderClaim(
    order?.id,
    !isTerminalP2pOrderStatus(order?.status),
  );
  const disputeQuery = useP2pDisputeByOrder(order?.id);

  const counterpartyId = useMemo(() => {
    if (!order || !user) return null;
    return order.advertiser_id === user.id ? order.taker_id : order.advertiser_id;
  }, [order, user]);
  const profilesQuery = useTraderPublicProfiles(counterpartyId ? [counterpartyId] : []);
  const counterparty = counterpartyId ? profilesQuery.data?.[counterpartyId] : undefined;

  if (orderQuery.isLoading) {
    return (
      <P2pShell title="Trade">
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </P2pShell>
    );
  }
  if (orderQuery.isError || !order) {
    return (
      <P2pShell title="Trade">
        <PageErrorState
          title="Trade not found"
          message="This trade doesn't exist, or you are not part of it."
          onRetry={() => void orderQuery.refetch()}
        />
      </P2pShell>
    );
  }

  const status = order.status as P2pOrderStatus;
  const meta = ORDER_STATUS_META[status];
  const isBuyer = user?.id === order.fiat_buyer_id;
  const isSeller = user?.id === order.crypto_seller_id;
  const role = isBuyer ? "buyer" : "seller";
  const snapshot = order.payment_method_snapshot;
  const claim = claimQuery.data ?? null;
  const dispute = disputeQuery.data ?? null;
  const counterpartyName = traderDisplayName(counterparty?.nickname, counterpartyId ?? "");

  const showPaymentCard =
    isBuyer && ["escrow_locked", "paid_marked", "disputed"].includes(status) && snapshot;
  const receiptData: P2pReceiptData | null =
    status === "completed" || status === "refunded" || dispute
      ? {
          orderId: order.id,
          statusLabel: meta.headline,
          asset: order.asset,
          cryptoAmountBtc: formatBtcFromSats(order.crypto_amount_minor),
          fiatAmountZmw: Number(order.fiat_amount_zmw),
          priceZmw: Number(order.price_zmw),
          feeSats: order.fee_minor,
          buyerName:
            claim?.payer_name_attested ??
            (isBuyer ? "You" : counterpartyName),
          sellerName: snapshot?.account_name ?? (isSeller ? "You" : counterpartyName),
          paymentMethodLine: snapshot
            ? `${paymentMethodTypeLabel(snapshot.type ?? "")} · ${snapshot.account_number ?? ""}${snapshot.bank_name ? ` · ${snapshot.bank_name}` : ""} · ${snapshot.account_name ?? ""}`
            : null,
          railReference: claim?.rail_reference ?? order.rail_reference,
          createdAt: order.created_at,
          paidMarkedAt: order.paid_marked_at,
          completedAt: order.completed_at,
          dispute: dispute
            ? {
                reasonLabel: DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason,
                statusLabel: DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status,
                rulingNotes: dispute.ruling_notes,
                ruledAt: dispute.ruled_at,
              }
            : null,
          generatedAt: new Date().toISOString(),
        }
      : null;

  return (
    <P2pShell title={`Trade — ${isBuyer ? "Buying" : "Selling"} BTC`} subtitle={meta.description}>
      <div className="space-y-6">
        {/* Status + amounts */}
        <Card>
          <CardContent className="p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold">{meta.headline}</h2>
                  <Badge
                    variant={
                      meta.tone === "danger"
                        ? "destructive"
                        : meta.tone === "success"
                          ? "default"
                          : "secondary"
                    }
                  >
                    {status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  With {counterpartyName}
                  {counterparty && ` · ${counterparty.trades_completed} completed trades`}
                  {" · "}Order {order.id.slice(0, 8)}… ·{" "}
                  {format(new Date(order.created_at), "d MMM yyyy, HH:mm")}
                </p>
              </div>
              <div className="text-right">
                <div className="text-xl font-semibold font-mono">
                  {formatBtcFromSats(order.crypto_amount_minor)} BTC
                </div>
                <div className="text-sm text-muted-foreground">
                  {formatZmw(Number(order.fiat_amount_zmw))} at {formatZmw(Number(order.price_zmw))}/BTC
                </div>
                {status === "escrow_locked" && (
                  <Countdown to={order.expires_at} label="Pay within" className="mt-1" />
                )}
                {status === "paid_marked" && order.seller_deadline_at && (
                  <Countdown to={order.seller_deadline_at} label="Seller to confirm by" className="mt-1" />
                )}
              </div>
            </div>
            <OrderStatusStepper status={status} paidMarkedAt={order.paid_marked_at} />
            <div className="flex flex-wrap gap-2 pt-1">
              <CounterpartyActions
                order={order}
                counterpartyId={counterpartyId ?? ""}
                counterpartyName={counterpartyName}
              />
              {receiptData && <P2pReceiptButton data={receiptData} />}
            </div>
          </CardContent>
        </Card>

        {/* Standing warnings (§3.5 UX copy as a security control) */}
        {!meta.terminal && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Trade safely</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">
              Only pay the account shown here. Never trust a screenshot — check
              your own account. If anyone asks you to cancel, release early, or
              move to WhatsApp, stop and report — it is a scam.
            </AlertDescription>
          </Alert>
        )}

        {/* Dispute banner */}
        {status === "disputed" && dispute && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>This trade is in dispute</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                The escrow is frozen while the dispute is resolved. Add your
                evidence — first response target is within 24 hours.
              </span>
              <Button asChild size="sm" variant="outline">
                <Link to={`/p2p/disputes/${dispute.id}`}>Go to the dispute</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Payment details (buyer, post-lock only — see header note) */}
        {showPaymentCard && (
          <Card className="border-primary/40">
            <CardHeader>
              <CardTitle className="text-base">Pay this account — exactly</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground text-xs">Method</p>
                  <p className="font-medium">{paymentMethodTypeLabel(snapshot.type ?? "")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Account number</p>
                  <p className="font-mono font-medium">{snapshot.account_number}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Account name</p>
                  <p className="font-medium">{snapshot.account_name}</p>
                </div>
                {snapshot.bank_name && (
                  <div>
                    <p className="text-muted-foreground text-xs">Bank / provider</p>
                    <p className="font-medium">{snapshot.bank_name}</p>
                  </div>
                )}
                <div>
                  <p className="text-muted-foreground text-xs">Amount</p>
                  <p className="font-semibold">{formatZmw(Number(order.fiat_amount_zmw))}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2">
                Pay exactly this amount, from your own registered account, then
                mark the order as paid with the transaction reference.
              </p>
            </CardContent>
          </Card>
        )}
        {isSeller && ["escrow_locked", "paid_marked"].includes(status) && snapshot && (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              The buyer pays your registered account:{" "}
              <span className="text-foreground font-medium">
                {paymentMethodTypeLabel(snapshot.type ?? "")} · {snapshot.account_number} ·{" "}
                {snapshot.account_name}
              </span>
              . Check inside that account before releasing — never release from
              a screenshot, an SMS, or the chat.
            </CardContent>
          </Card>
        )}

        {/* Actions by state */}
        {status === "escrow_locked" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {isBuyer ? "Pay the seller" : "Waiting for the buyer's payment"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isBuyer ? (
                <MarkPaidForm order={order} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The buyer has until the timer runs out to pay and mark the
                  order as paid. If the window expires unpaid, the escrowed
                  Bitcoin returns to you automatically.
                </p>
              )}
              <div className="flex gap-2 flex-wrap border-t border-border pt-4">
                <CancelOrderButton order={order} role={role} />
                <OpenDisputeDialog order={order} role={role} />
              </div>
            </CardContent>
          </Card>
        )}

        {status === "paid_marked" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {isSeller ? "Confirm the payment and release" : "Waiting for the seller to confirm"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isSeller ? (
                <ReleaseForm order={order} claim={claim} />
              ) : (
                <div className="text-sm text-muted-foreground space-y-2">
                  <p>
                    You marked {formatZmw(Number(order.fiat_amount_zmw))} as
                    paid with reference{" "}
                    <span className="font-mono text-foreground">
                      {claim?.rail_reference ?? order.rail_reference ?? "—"}
                    </span>
                    . The seller is checking inside their own account. The
                    Bitcoin releases when they confirm the amount and reference
                    match.
                  </p>
                  <p>
                    A payment can be reversed by the provider after it arrives,
                    so give the seller a few minutes — pressure to release
                    quickly is a scam pattern, on both sides.
                  </p>
                </div>
              )}
              <div className="border-t border-border pt-4">
                <OpenDisputeDialog order={order} role={role} />
              </div>
            </CardContent>
          </Card>
        )}

        {status === "completed" && isSeller && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm">
                If the buyer's payment is later <strong>reversed</strong> by the
                mobile-money provider, report it here. The trade itself is
                complete — but the report starts the investigation and
                sanctions process, and your trade receipt above is the
                document your bank or the police will ask for.
              </p>
              <OpenDisputeDialog
                order={order}
                role={role}
                trigger={
                  <Button variant="outline" className="gap-2">
                    <ShieldAlert className="h-4 w-4" /> Report a reversed payment
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}

        <TradeChat order={order} />
      </div>
    </P2pShell>
  );
}
