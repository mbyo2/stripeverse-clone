import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Gavel, Loader2 } from "lucide-react";
import PageErrorState from "@/components/PageErrorState";
import P2pReceiptButton from "@/components/p2p/P2pReceiptButton";
import { useToast } from "@/hooks/use-toast";
import {
  fetchAllSanctions,
  fetchDisputeEvidence,
  fetchDisputesByOrderIds,
  fetchKycNames,
  fetchMySanctions,
  fetchOpenDisputes,
  fetchOrder,
  fetchOrderAuditLog,
  fetchOrderClaim,
  fetchOrderMessages,
  fetchOrdersByIds,
  fetchOrdersForUsers,
  fetchP2pEnabled,
  fetchRecentDisputes,
  fetchRiskEventsForUsers,
  fetchTraderPublicProfiles,
  newIdempotencyKey,
  p2pAction,
  P2pActionError,
  type P2pDispute,
  type P2pOrder,
} from "@/services/p2pService";
import {
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  formatBtcFromSats,
  formatZmw,
  paymentMethodTypeLabel,
  SANCTION_LEVEL_LABELS,
  sanctionDefaultDuration,
  slaInfo,
  traderDisplayName,
  type P2pReceiptData,
} from "@/utils/p2pUi";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

/**
 * /admin/p2p — the dispute console (§4.3). Everything an admin
 * needs to rule in one screen: the order, both parties with their
 * records, the unified timeline (audit log + system messages), the
 * full chat transcript (stored, masked record), the payment claim,
 * both parties' evidence, risk events and sanction history. The
 * ruling executes atomically through the resolve_dispute edge
 * action — escrow move, reputation and any sanction in one call.
 *
 * Ops note: platform_settings has no client write path (§4.3) and
 * the p2p edge function exposes no settings action, so the
 * p2p_enabled switch is displayed read-only here; flipping it is a
 * service-role operation (see the build report's gap list).
 */
export default function AdminP2P() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openQuery = useQuery({
    queryKey: ["admin-p2p", "open-disputes"],
    queryFn: fetchOpenDisputes,
    staleTime: 0,
    refetchInterval: 30_000,
  });
  const recentQuery = useQuery({
    queryKey: ["admin-p2p", "recent-disputes"],
    queryFn: fetchRecentDisputes,
    staleTime: 30_000,
  });
  const enabledQuery = useQuery({
    queryKey: ["admin-p2p", "enabled"],
    queryFn: fetchP2pEnabled,
  });
  const openDisputes = useMemo(() => openQuery.data ?? [], [openQuery.data]);
  const orderIds = useMemo(() => openDisputes.map((d) => d.order_id), [openDisputes]);
  const ordersQuery = useQuery({
    queryKey: ["admin-p2p", "queue-orders", orderIds.join(",")],
    queryFn: () => fetchOrdersByIds(orderIds),
    enabled: orderIds.length > 0,
  });
  const orderById = useMemo(() => {
    const map: Record<string, P2pOrder> = {};
    for (const o of ordersQuery.data ?? []) map[o.id] = o;
    return map;
  }, [ordersQuery.data]);

  const selected = openDisputes.find((d) => d.id === selectedId) ??
    (recentQuery.data ?? []).find((d) => d.id === selectedId) ??
    null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-[1280px] mx-auto w-full">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">
              P2P Dispute Console
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Rule disputes on the full record: order, chat, claim, evidence,
              risk and history — in one screen.
            </p>
          </div>
          {enabledQuery.data !== undefined && (
            <Badge variant={enabledQuery.data ? "default" : "destructive"}>
              Marketplace {enabledQuery.data ? "ENABLED" : "PAUSED"}
            </Badge>
          )}
        </div>

        <Tabs defaultValue="queue" className="space-y-6">
          <TabsList>
            <TabsTrigger value="queue">
              Dispute queue ({openDisputes.length} open)
            </TabsTrigger>
            <TabsTrigger value="sanctions">Sanctions</TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-6">
            {openQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : openQuery.isError ? (
              <PageErrorState
                message="We couldn't load the dispute queue. Please try again."
                onRetry={() => void openQuery.refetch()}
              />
            ) : openDisputes.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">
                  No open disputes. The escrow ledger thanks you.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {openDisputes.map((d) => {
                  const order = orderById[d.order_id];
                  const sla = slaInfo(d.sla_due_at, Date.now());
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className={cn(
                        "w-full text-left border rounded-lg p-4 transition-colors",
                        selectedId === d.id
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="destructive">Open</Badge>
                          <span className="font-medium">
                            {DISPUTE_REASON_LABELS[d.reason] ?? d.reason}
                          </span>
                          {order && (
                            <span className="text-sm text-muted-foreground">
                              {formatBtcFromSats(order.crypto_amount_minor)} BTC ·{" "}
                              {formatZmw(Number(order.fiat_amount_zmw))}
                            </span>
                          )}
                        </div>
                        {sla && (
                          <span
                            className={cn(
                              "text-xs font-medium",
                              sla.breached ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {sla.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Opened {format(new Date(d.created_at), "d MMM yyyy, HH:mm")} ·
                        Order {d.order_id.slice(0, 8)}… ·{" "}
                        {d.affects_escrow ? "Escrow frozen" : "Post-completion case"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {selected && (
              <DisputeWorkspace
                key={selected.id}
                dispute={selected}
                onRuled={() => {
                  setSelectedId(null);
                  void openQuery.refetch();
                  void recentQuery.refetch();
                }}
              />
            )}

            {(recentQuery.data ?? []).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Recently closed</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(recentQuery.data ?? []).map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className="w-full text-left text-sm border border-border rounded-md p-3 hover:border-primary/40"
                    >
                      <span className="font-medium">
                        {DISPUTE_STATUS_LABELS[d.status] ?? d.status}
                      </span>{" "}
                      · {DISPUTE_REASON_LABELS[d.reason] ?? d.reason} · Order{" "}
                      {d.order_id.slice(0, 8)}… ·{" "}
                      {format(new Date(d.updated_at), "d MMM, HH:mm")}
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sanctions">
            <SanctionsPanel />
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------
// Dispute workspace
// ---------------------------------------------------------------------

function DisputeWorkspace({
  dispute,
  onRuled,
}: {
  dispute: P2pDispute;
  onRuled: () => void;
}) {
  const { toast } = useToast();
  const [outcome, setOutcome] = useState<"release_to_buyer" | "refund_to_seller">(
    "refund_to_seller",
  );
  const [notes, setNotes] = useState("");
  const [withSanction, setWithSanction] = useState(false);
  const [sanctionLevel, setSanctionLevel] = useState("1");
  const [sanctionReason, setSanctionReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  const orderQuery = useQuery({
    queryKey: ["admin-p2p", "order", dispute.order_id],
    queryFn: () => fetchOrder(dispute.order_id),
    staleTime: 0,
  });
  const order = orderQuery.data;
  const claimQuery = useQuery({
    queryKey: ["admin-p2p", "claim", dispute.order_id],
    queryFn: () => fetchOrderClaim(dispute.order_id),
    staleTime: 0,
  });
  const messagesQuery = useQuery({
    queryKey: ["admin-p2p", "messages", dispute.order_id],
    queryFn: () => fetchOrderMessages(dispute.order_id),
    staleTime: 0,
  });
  const auditQuery = useQuery({
    queryKey: ["admin-p2p", "audit", dispute.order_id],
    queryFn: () => fetchOrderAuditLog(dispute.order_id),
  });
  const evidenceQuery = useQuery({
    queryKey: ["admin-p2p", "evidence", dispute.id],
    queryFn: () => fetchDisputeEvidence(dispute.id),
    staleTime: 0,
  });

  const partyIds = useMemo(
    () => (order ? [order.fiat_buyer_id, order.crypto_seller_id] : []),
    [order],
  );
  const profilesQuery = useQuery({
    queryKey: ["admin-p2p", "profiles", partyIds.join(",")],
    queryFn: () => fetchTraderPublicProfiles(partyIds),
    enabled: partyIds.length > 0,
  });
  const kycQuery = useQuery({
    queryKey: ["admin-p2p", "kyc", partyIds.join(",")],
    queryFn: () => fetchKycNames(partyIds),
    enabled: partyIds.length > 0,
  });
  const riskQuery = useQuery({
    queryKey: ["admin-p2p", "risk", partyIds.join(",")],
    queryFn: () => fetchRiskEventsForUsers(partyIds),
    enabled: partyIds.length > 0,
  });
  const buyerSanctionsQuery = useQuery({
    queryKey: ["admin-p2p", "sanctions", partyIds[0]],
    queryFn: () => fetchMySanctions(partyIds[0]),
    enabled: partyIds.length > 0,
  });
  const sellerSanctionsQuery = useQuery({
    queryKey: ["admin-p2p", "sanctions", partyIds[1]],
    queryFn: () => fetchMySanctions(partyIds[1]),
    enabled: partyIds.length > 1,
  });
  const historyQuery = useQuery({
    queryKey: ["admin-p2p", "history", partyIds.join(",")],
    queryFn: () => fetchOrdersForUsers(partyIds),
    enabled: partyIds.length > 0,
  });
  const partyDisputesQuery = useQuery({
    queryKey: ["admin-p2p", "history-disputes", (historyQuery.data ?? []).map((o) => o.id).join(",")],
    queryFn: () => fetchDisputesByOrderIds((historyQuery.data ?? []).map((o) => o.id)),
    enabled: !!historyQuery.data,
  });

  const resolve = useMutation({
    mutationFn: () =>
      p2pAction(
        "resolve_dispute",
        {
          dispute_id: dispute.id,
          outcome,
          notes: notes.trim(),
          sanction_level: withSanction ? Number(sanctionLevel) : undefined,
          sanction_reason_code:
            withSanction && sanctionReason.trim() ? sanctionReason.trim() : undefined,
          idempotency_key: idemKey,
        },
        "We couldn't record this ruling. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Ruling recorded", description: "The escrow has moved and both parties have been notified." });
      onRuled();
    },
    onError: (e: unknown) => {
      setIdemKey(newIdempotencyKey());
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't record this ruling. Please try again.",
      );
    },
  });

  if (orderQuery.isLoading || !order) {
    return <Skeleton className="h-96 w-full" />;
  }

  const buyer = {
    id: order.fiat_buyer_id,
    name: kycQuery.data?.[order.fiat_buyer_id] ?? traderDisplayName(profilesQuery.data?.[order.fiat_buyer_id]?.nickname, order.fiat_buyer_id),
    profile: profilesQuery.data?.[order.fiat_buyer_id],
    sanctions: buyerSanctionsQuery.data ?? [],
  };
  const seller = {
    id: order.crypto_seller_id,
    name: kycQuery.data?.[order.crypto_seller_id] ?? traderDisplayName(profilesQuery.data?.[order.crypto_seller_id]?.nickname, order.crypto_seller_id),
    profile: profilesQuery.data?.[order.crypto_seller_id],
    sanctions: sellerSanctionsQuery.data ?? [],
  };
  const loser = outcome === "release_to_buyer" ? seller : buyer;
  const claim = claimQuery.data;
  const snapshot = order.payment_method_snapshot;
  const sla = slaInfo(dispute.sla_due_at, Date.now());
  const isOpen = dispute.status === "open";

  const timeline = [
    ...(auditQuery.data ?? []).map((a) => ({
      id: `a-${a.id}`,
      at: a.created_at,
      kind: "audit" as const,
      text: `${a.event.replace(/_/g, " ")} — ${a.actor_type}${a.actor_id ? ` ${a.actor_id.slice(0, 8)}…` : ""}`,
    })),
    ...(messagesQuery.data ?? [])
      .filter((m) => m.sender_type === "system")
      .map((m) => ({
        id: `m-${m.id}`,
        at: m.created_at,
        kind: "system" as const,
        text: m.body,
      })),
  ].sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

  const receiptData: P2pReceiptData = {
    orderId: order.id,
    statusLabel: dispute ? `${DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}` : order.status,
    asset: order.asset,
    cryptoAmountBtc: formatBtcFromSats(order.crypto_amount_minor),
    fiatAmountZmw: Number(order.fiat_amount_zmw),
    priceZmw: Number(order.price_zmw),
    feeSats: order.fee_minor,
    buyerName: buyer.name,
    sellerName: seller.name,
    paymentMethodLine: snapshot
      ? `${paymentMethodTypeLabel(snapshot.type ?? "")} · ${snapshot.account_number ?? ""}${snapshot.bank_name ? ` · ${snapshot.bank_name}` : ""} · ${snapshot.account_name ?? ""}`
      : null,
    railReference: claim?.rail_reference ?? order.rail_reference,
    createdAt: order.created_at,
    paidMarkedAt: order.paid_marked_at,
    completedAt: order.completed_at,
    dispute: {
      reasonLabel: DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason,
      statusLabel: DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status,
      rulingNotes: dispute.ruling_notes,
      ruledAt: dispute.ruled_at,
    },
    generatedAt: new Date().toISOString(),
  };

  const partyDisputeCount = (partyId: string) =>
    (partyDisputesQuery.data ?? []).filter((d) => {
      const o = (historyQuery.data ?? []).find((x) => x.id === d.order_id);
      return o && (o.advertiser_id === partyId || o.taker_id === partyId);
    }).length;

  const partyCard = (party: typeof buyer, roleLabel: string) => (
    <div className="border border-border rounded-md p-3 space-y-1 text-sm">
      <p className="font-medium">
        {roleLabel}: {party.name}
      </p>
      <p className="text-xs text-muted-foreground font-mono">{party.id}</p>
      {party.profile ? (
        <p className="text-xs text-muted-foreground">
          {party.profile.trades_completed} trades · {party.profile.disputes_won} disputes
          won / {party.profile.disputes_lost} lost · Volume{" "}
          {formatZmw(Number(party.profile.volume_zmw_completed))} ·{" "}
          {partyDisputeCount(party.id)} disputes all-time
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">No trader record yet.</p>
      )}
      {party.sanctions.length > 0 && (
        <div className="pt-1 space-y-1">
          {party.sanctions.slice(0, 3).map((s) => (
            <p key={s.id} className="text-xs">
              <Badge variant={s.status === "active" ? "destructive" : "secondary"} className="mr-1">
                L{s.level} {s.status}
              </Badge>
              {s.reason_code}
              {s.detail ? ` — ${s.detail}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Gavel className="h-5 w-5" />
          Dispute workspace — {DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason}
          {sla && isOpen && (
            <span className={cn("text-xs font-medium", sla.breached ? "text-destructive" : "text-muted-foreground")}>
              {sla.label}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Order + parties */}
        <div className="grid md:grid-cols-3 gap-3">
          <div className="border border-border rounded-md p-3 text-sm space-y-1">
            <p className="font-medium">Order {order.id.slice(0, 8)}…</p>
            <p>
              {formatBtcFromSats(order.crypto_amount_minor)} BTC ·{" "}
              {formatZmw(Number(order.fiat_amount_zmw))} at {formatZmw(Number(order.price_zmw))}/BTC
            </p>
            <p className="text-xs text-muted-foreground">
              Index at order time:{" "}
              {order.index_snapshot?.index_zmw
                ? formatZmw(Number(order.index_snapshot.index_zmw))
                : "—"}{" "}
              · Status {order.status.replace(/_/g, " ")} · Opened by{" "}
              {dispute.opened_by === buyer.id ? "the buyer" : "the seller"}
            </p>
            {snapshot && (
              <p className="text-xs text-muted-foreground">
                Seller's registered receiving account:{" "}
                {paymentMethodTypeLabel(snapshot.type ?? "")} · {snapshot.account_number} ·{" "}
                {snapshot.account_name}
                {snapshot.bank_name ? ` · ${snapshot.bank_name}` : ""}
              </p>
            )}
            {claim && (
              <p className="text-xs text-muted-foreground">
                Buyer's claim: {formatZmw(Number(claim.amount_sent_zmw))} · Ref{" "}
                <span className="font-mono">{claim.rail_reference}</span>
                {claim.payer_name_attested ? ` · Paid as "${claim.payer_name_attested}"` : ""}
                {claim.proof_file_hash ? ` · Proof hash ${claim.proof_file_hash.slice(0, 12)}…` : ""}
              </p>
            )}
            <div className="pt-2">
              <P2pReceiptButton data={receiptData} label="Trade receipt (PDF)" variant="ghost" />
            </div>
          </div>
          {partyCard(buyer, "Buyer")}
          {partyCard(seller, "Seller")}
        </div>

        {/* Evidence standard reminder */}
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <AlertTitle className="text-sm">Evidence standard</AlertTitle>
          <AlertDescription className="text-xs leading-relaxed">
            A chat screenshot is not proof of payment — for either side. Rule on
            the payment record: the provider receipt/statement showing amount,
            reference and parties, matched against the claim above. If the
            payment came from a third-party account, rule refund — and any fiat
            refund must go back to the exact account the payment came from,
            never to a different account named in chat. State in your notes
            which record the ruling rests on.
          </AlertDescription>
        </Alert>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Timeline */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Unified timeline (audit + system)</h3>
            <div className="border border-border rounded-md p-3 h-72 overflow-y-auto space-y-2">
              {timeline.length === 0 ? (
                <p className="text-xs text-muted-foreground">No timeline entries.</p>
              ) : (
                timeline.map((t) => (
                  <div key={t.id} className="text-xs">
                    <span className="text-muted-foreground font-mono">
                      {format(new Date(t.at), "d MMM HH:mm:ss")}
                    </span>{" "}
                    <Badge variant={t.kind === "audit" ? "outline" : "secondary"} className="mr-1">
                      {t.kind}
                    </Badge>
                    <span className="whitespace-pre-wrap">{t.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Chat transcript */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Chat transcript (stored record)</h3>
            <div className="border border-border rounded-md p-3 h-72 overflow-y-auto space-y-2">
              {(messagesQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No messages.</p>
              ) : (
                (messagesQuery.data ?? []).map((m) => (
                  <div key={m.id} className="text-xs">
                    <span className="text-muted-foreground font-mono">
                      {format(new Date(m.created_at), "d MMM HH:mm")}
                    </span>{" "}
                    <Badge
                      variant={m.sender_type === "user" ? "outline" : "secondary"}
                      className="mr-1"
                    >
                      {m.sender_type === "system"
                        ? "system"
                        : m.sender_type === "support"
                          ? "support"
                          : m.sender_id === buyer.id
                            ? "buyer"
                            : "seller"}
                    </Badge>
                    <span className="whitespace-pre-wrap">{m.body}</span>
                    {Array.isArray(m.scan_flags) && m.scan_flags.length > 0 && (
                      <span className="block text-amber-600 dark:text-amber-400 pl-2">
                        Flags: {JSON.stringify(m.scan_flags)}
                      </span>
                    )}
                    {m.attachment_path && (
                      <span className="block text-muted-foreground pl-2">
                        Attachment: {m.attachment_path}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Evidence + risk */}
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Evidence submitted</h3>
            {(evidenceQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">None yet.</p>
            ) : (
              (evidenceQuery.data ?? []).map((ev) => (
                <div key={ev.id} className="border border-border rounded-md p-3 text-xs space-y-1">
                  <p className="text-muted-foreground">
                    {ev.submitter_id === buyer.id ? "Buyer" : "Seller"} · {ev.kind} ·{" "}
                    {format(new Date(ev.created_at), "d MMM HH:mm")}
                    {ev.file_hash ? ` · SHA-256 ${ev.file_hash.slice(0, 16)}…` : ""}
                    {ev.storage_path ? ` · ${ev.storage_path}` : ""}
                  </p>
                  {ev.body && <p className="whitespace-pre-wrap text-sm">{ev.body}</p>}
                </div>
              ))
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Risk events (both parties)</h3>
            {(riskQuery.data ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No risk events recorded.</p>
            ) : (
              (riskQuery.data ?? []).slice(0, 15).map((r) => (
                <p key={r.id} className="text-xs border border-border rounded-md p-2">
                  <Badge variant="outline" className="mr-1">
                    {r.signal} · w{r.weight}
                  </Badge>
                  {r.user_id === buyer.id ? "buyer" : "seller"} ·{" "}
                  {format(new Date(r.created_at), "d MMM HH:mm")}
                  {Object.keys(r.detail ?? {}).length > 0 && (
                    <span className="block text-muted-foreground font-mono mt-1">
                      {JSON.stringify(r.detail)}
                    </span>
                  )}
                </p>
              ))
            )}
          </div>
        </div>

        {/* Ruling */}
        {isOpen ? (
          <div className="border-t border-border pt-4 space-y-4">
            <h3 className="text-sm font-semibold">Rule on this dispute</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Outcome</Label>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as typeof outcome)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="release_to_buyer">Release escrow to the buyer</SelectItem>
                    <SelectItem value="refund_to_seller">Refund escrow to the seller</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Split outcomes do not exist — rule on the whole trade.
                </p>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Checkbox checked={withSanction} onCheckedChange={(v) => setWithSanction(v === true)} />
                  Also sanction the {outcome === "release_to_buyer" ? "seller" : "buyer"}
                </Label>
                {withSanction && (
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={sanctionLevel} onValueChange={setSanctionLevel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[0, 1, 2, 3, 4].map((lvl) => (
                          <SelectItem key={lvl} value={String(lvl)}>
                            L{lvl} — {SANCTION_LEVEL_LABELS[lvl]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={sanctionReason}
                      onChange={(e) => setSanctionReason(e.target.value)}
                      placeholder="reason_code (e.g. fake_proof)"
                      maxLength={60}
                    />
                    <p className="text-[11px] text-muted-foreground col-span-2">
                      Target: {loser.name}. Default duration for the level
                      applies ({sanctionDefaultDuration(Number(sanctionLevel)) ?? "no automatic expiry"}).
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ruling-notes">Ruling notes (required)</Label>
              <Textarea
                id="ruling-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={4000}
                rows={4}
                placeholder="State the outcome, the documentary record it rests on, and — for a refund after a third-party payment — that the fiat refund goes to the originating account."
              />
            </div>
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}
            <Button
              onClick={() => {
                if (!notes.trim()) {
                  setFormError("Ruling notes are required — the parties and any appeal read them.");
                  return;
                }
                setFormError(null);
                resolve.mutate();
              }}
              disabled={resolve.isPending}
              className="gap-2"
            >
              {resolve.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Gavel className="h-4 w-4" />
              )}
              Record ruling & move the escrow
            </Button>
          </div>
        ) : (
          <Alert>
            <AlertTitle className="text-sm">
              Closed — {DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}
            </AlertTitle>
            <AlertDescription className="whitespace-pre-wrap">
              {dispute.ruling_notes ?? "Settled by negotiation between the parties."}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Sanctions panel
// ---------------------------------------------------------------------

function SanctionsPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const sanctionsQuery = useQuery({
    queryKey: ["admin-p2p", "all-sanctions"],
    queryFn: fetchAllSanctions,
    staleTime: 0,
  });
  const [userId, setUserId] = useState("");
  const [scope, setScope] = useState("p2p");
  const [level, setLevel] = useState("1");
  const [reasonCode, setReasonCode] = useState("");
  const [detail, setDetail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const apply = useMutation({
    mutationFn: () =>
      p2pAction<{ sanction_id?: string }>(
        "apply_sanction",
        {
          user_id: userId.trim(),
          scope,
          level: Number(level),
          reason_code: reasonCode.trim(),
          detail: detail.trim(),
          duration: sanctionDefaultDuration(Number(level)) ?? undefined,
        },
        "We couldn't apply this sanction. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Sanction applied" });
      setFormError(null);
      void qc.invalidateQueries({ queryKey: ["admin-p2p", "all-sanctions"] });
    },
    onError: (e: unknown) =>
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't apply this sanction. Please try again.",
      ),
  });

  const revoke = useMutation({
    mutationFn: (sanctionId: string) =>
      p2pAction("revoke_sanction", { sanction_id: sanctionId }, "We couldn't revoke this sanction."),
    onSuccess: () => {
      toast({ title: "Sanction revoked" });
      void qc.invalidateQueries({ queryKey: ["admin-p2p", "all-sanctions"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Revoke failed",
        description: e instanceof Error ? e.message : "We couldn't revoke this sanction.",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Apply a sanction</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="san-user">User ID</Label>
              <Input
                id="san-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="uuid of the trader"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="p2p">P2P only</SelectItem>
                  <SelectItem value="platform">Whole platform</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Level</Label>
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4].map((lvl) => (
                    <SelectItem key={lvl} value={String(lvl)}>
                      L{lvl} — {SANCTION_LEVEL_LABELS[lvl]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="san-reason">Reason code</Label>
              <Input
                id="san-reason"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="e.g. fake_proof"
                maxLength={60}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="san-detail">Detail (shown to the user)</Label>
            <Textarea
              id="san-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={2000}
              rows={2}
              placeholder="What happened, and what the user can do (appeal route, evidence)."
            />
          </div>
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
          <Button
            disabled={apply.isPending || !userId.trim() || !reasonCode.trim() || !detail.trim()}
            onClick={() => apply.mutate()}
          >
            {apply.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply sanction
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Levels 2+ are human decisions by design. Every application and
            revocation is written to the audit record.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All sanctions</CardTitle>
        </CardHeader>
        <CardContent>
          {sanctionsQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : sanctionsQuery.isError ? (
            <PageErrorState
              message="We couldn't load sanctions. Please try again."
              onRetry={() => void sanctionsQuery.refetch()}
            />
          ) : (sanctionsQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No sanctions recorded.</p>
          ) : (
            <div className="space-y-2">
              {(sanctionsQuery.data ?? []).map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-border rounded-md p-3 text-sm"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={s.status === "active" ? "destructive" : "secondary"}>
                        {s.status}
                      </Badge>
                      <span className="font-medium">
                        L{s.level} — {SANCTION_LEVEL_LABELS[s.level] ?? "Sanction"}
                      </span>
                      <span className="text-muted-foreground">{s.reason_code}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.scope === "p2p" ? "P2P" : "Platform"} · by {s.applied_by} ·{" "}
                        {format(new Date(s.created_at), "d MMM yyyy")}
                        {s.expires_at ? ` · ends ${format(new Date(s.expires_at), "d MMM yyyy")}` : ""}
                      </span>
                    </div>
                    <p className="text-xs font-mono text-muted-foreground">{s.user_id}</p>
                    {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                  </div>
                  {s.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
