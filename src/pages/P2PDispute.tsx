import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Loader2, Paperclip } from "lucide-react";
import P2pShell from "@/components/p2p/P2pShell";
import Countdown from "@/components/p2p/Countdown";
import P2pReceiptButton from "@/components/p2p/P2pReceiptButton";
import PageErrorState from "@/components/PageErrorState";
import { useRecoveringRetry } from "@/hooks/useRecoveringRetry";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  p2pAction,
  P2pActionError,
  p2pEvidenceSignedUrl,
  uploadP2pEvidenceFile,
  type P2pEvidence,
} from "@/services/p2pService";
import {
  useInvalidateP2p,
  useP2pDispute,
  useP2pEvidence,
  useP2pOrder,
  useP2pOrderClaim,
  useTraderPublicProfiles,
} from "@/hooks/useP2p";
import {
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  formatBtcFromSats,
  formatZmw,
  isTerminalP2pDisputeStatus,
  ORDER_STATUS_META,
  paymentMethodTypeLabel,
  traderDisplayName,
  type P2pOrderStatus,
  type P2pReceiptData,
} from "@/utils/p2pUi";
import { format } from "date-fns";

/**
 * /p2p/disputes/:id — the party view of a dispute (§4.4): the
 * frozen state, the 10-minute negotiation window with its
 * propose/confirm discipline (only the opener proposes; only the
 * OTHER party can confirm — a filer can never talk their way out of
 * a freeze unilaterally, §3.6), evidence submission (add-only,
 * hash-pinned), and the ruling once it lands.
 */
export default function P2PDispute() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const disputeQuery = useP2pDispute(id);
  const retryWithRecovery = useRecoveringRetry();
  const dispute = disputeQuery.data;
  const orderQuery = useP2pOrder(dispute?.order_id);
  const order = orderQuery.data;
  const evidenceQuery = useP2pEvidence(dispute?.id);
  // The claim is frozen history once the dispute is ruled/settled —
  // poll it only while the dispute is open (scalability fix #5).
  const claimQuery = useP2pOrderClaim(
    order?.id,
    !isTerminalP2pDisputeStatus(dispute?.status),
  );

  const [statement, setStatement] = useState("");
  const [proposedOutcome, setProposedOutcome] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const counterpartyId =
    order && user
      ? order.advertiser_id === user.id
        ? order.taker_id
        : order.advertiser_id
      : null;
  const profilesQuery = useTraderPublicProfiles(counterpartyId ? [counterpartyId] : []);
  const counterpartyName = traderDisplayName(
    counterpartyId ? profilesQuery.data?.[counterpartyId]?.nickname : null,
    counterpartyId ?? "",
  );

  const addEvidence = useMutation({
    mutationFn: (input: { kind: "statement" | "file"; body?: string; storage_path?: string; file_hash?: string }) =>
      p2pAction(
        "add_dispute_evidence",
        { dispute_id: dispute!.id, ...input },
        "We couldn't add that evidence. Please try again.",
      ),
    onSuccess: () => {
      setStatement("");
      toast({ title: "Evidence added", description: "It is now part of the permanent case record." });
      invalidate();
    },
    onError: (e: unknown) =>
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't add that evidence. Please try again.",
      ),
  });

  const propose = useMutation({
    mutationFn: () =>
      p2pAction(
        "propose_dispute_closure",
        { dispute_id: dispute!.id, outcome: proposedOutcome },
        "We couldn't send that proposal. Please try again.",
      ),
    onSuccess: () => {
      toast({
        title: "Settlement proposed",
        description: "The other party must confirm it before anything moves.",
      });
      invalidate();
    },
    onError: (e: unknown) =>
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't send that proposal. Please try again.",
      ),
  });

  const confirm = useMutation({
    mutationFn: () =>
      p2pAction(
        "confirm_dispute_closure",
        { dispute_id: dispute!.id },
        "We couldn't confirm that settlement. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Settlement confirmed", description: "The escrow has moved as agreed." });
      invalidate();
    },
    onError: (e: unknown) =>
      setFormError(
        e instanceof P2pActionError || e instanceof Error
          ? e.message
          : "We couldn't confirm that settlement. Please try again.",
      ),
  });

  const attachFile = async (file: File) => {
    if (!dispute) return;
    setUploading(true);
    try {
      const { path, hash } = await uploadP2pEvidenceFile(file, `disputes/${dispute.id}`);
      addEvidence.mutate({ kind: "file", storage_path: path, file_hash: hash });
    } catch (e) {
      setFormError(
        e instanceof Error ? e.message : "The file could not be uploaded.",
      );
    } finally {
      setUploading(false);
    }
  };

  if (disputeQuery.isLoading) {
    return (
      <P2pShell title="Dispute">
        <Skeleton className="h-64 w-full" />
      </P2pShell>
    );
  }
  if (disputeQuery.isError || !dispute) {
    return (
      <P2pShell title="Dispute">
        <PageErrorState
          title="Dispute not found"
          message="This dispute doesn't exist, or you are not part of its trade."
          onRetry={() => void retryWithRecovery(() => disputeQuery.refetch())}
        />
      </P2pShell>
    );
  }

  const isOpener = dispute.opened_by === user?.id;
  const isOpen = dispute.status === "open";
  const snapshot = order?.payment_method_snapshot;
  const claim = claimQuery.data ?? null;

  const receiptData: P2pReceiptData | null = order
    ? {
        orderId: order.id,
        statusLabel: ORDER_STATUS_META[order.status as P2pOrderStatus].headline,
        asset: order.asset,
        cryptoAmountBtc: formatBtcFromSats(order.crypto_amount_minor),
        fiatAmountZmw: Number(order.fiat_amount_zmw),
        priceZmw: Number(order.price_zmw),
        feeSats: order.fee_minor,
        buyerName: claim?.payer_name_attested ?? (order.fiat_buyer_id === user?.id ? "You" : counterpartyName),
        sellerName: snapshot?.account_name ?? (order.crypto_seller_id === user?.id ? "You" : counterpartyName),
        paymentMethodLine: snapshot
          ? `${paymentMethodTypeLabel(snapshot.type ?? "")} · ${snapshot.account_number ?? ""} · ${snapshot.account_name ?? ""}`
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
      }
    : null;

  return (
    <P2pShell title="Dispute" subtitle="The escrow stays frozen until this is settled between you or ruled on by the support team.">
      <div className="space-y-6">
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isOpen ? "destructive" : "secondary"}>
                {DISPUTE_STATUS_LABELS[dispute.status] ?? dispute.status}
              </Badge>
              <span className="font-medium">
                {DISPUTE_REASON_LABELS[dispute.reason] ?? dispute.reason}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Opened by {isOpener ? "you" : counterpartyName} on{" "}
              {format(new Date(dispute.created_at), "d MMM yyyy, HH:mm")} ·{" "}
              {dispute.affects_escrow
                ? "The escrowed Bitcoin is frozen by this dispute."
                : "This trade was already complete; this case is about the payment record and sanctions, and cannot move the Bitcoin."}
            </p>
            {dispute.detail && (
              <p className="text-sm border border-border rounded-md p-3">{dispute.detail}</p>
            )}
            {order && (
              <p className="text-sm">
                Trade: <span className="font-mono">{formatBtcFromSats(order.crypto_amount_minor)} BTC</span>{" "}
                for {formatZmw(Number(order.fiat_amount_zmw))} ·{" "}
                <Link to={`/p2p/orders/${order.id}`} className="underline font-medium">
                  Open the trade room
                </Link>
              </p>
            )}
            {isOpen && dispute.sla_due_at && (
              <p className="text-xs text-muted-foreground">
                Support targets: first response within 24 hours, resolution
                within 72 hours (by {format(new Date(dispute.sla_due_at), "d MMM, HH:mm")}).
                If nobody rules, the escrow stays frozen — it never releases by
                default.
              </p>
            )}
            {!isOpen && dispute.ruling_notes && (
              <Alert>
                <AlertTitle className="text-sm">Ruling</AlertTitle>
                <AlertDescription className="whitespace-pre-wrap">
                  {dispute.ruling_notes}
                </AlertDescription>
              </Alert>
            )}
            {receiptData && !isOpen && <P2pReceiptButton data={receiptData} />}
          </CardContent>
        </Card>

        {formError && (
          <Alert variant="destructive">
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        {/* Negotiation window */}
        {isOpen && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settle it between you</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dispute.negotiation_ends_at && (
                <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                  Negotiation window: <Countdown to={dispute.negotiation_ends_at} />
                  <span>
                    — after it closes, the case goes to the support team with
                    the SLA clock running. The escrow stays frozen either way.
                  </span>
                </p>
              )}
              {!dispute.proposed_outcome ? (
                isOpener ? (
                  <div className="space-y-3">
                    <p className="text-sm">
                      You opened this dispute, so you can propose a settlement.
                      Nothing moves unless the other party confirms it — a
                      proposal can never be forced through.
                    </p>
                    <div className="flex flex-wrap gap-2 items-end">
                      <div className="space-y-2">
                        <Label>Proposed outcome</Label>
                        <Select value={proposedOutcome} onValueChange={setProposedOutcome}>
                          <SelectTrigger className="w-64">
                            <SelectValue placeholder="Choose an outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="release_to_buyer">Release the Bitcoin to the buyer</SelectItem>
                            <SelectItem value="refund_to_seller">Refund the Bitcoin to the seller</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        disabled={!proposedOutcome || propose.isPending}
                        onClick={() => propose.mutate()}
                      >
                        {propose.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                        Propose settlement
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Waiting for the person who opened the dispute to propose a
                    settlement. You can add evidence below in the meantime —
                    cases are ruled on the evidence.
                  </p>
                )
              ) : dispute.proposed_by === user?.id ? (
                <p className="text-sm text-muted-foreground">
                  You proposed{" "}
                  <strong className="text-foreground">
                    {dispute.proposed_outcome === "release_to_buyer"
                      ? "releasing the Bitcoin to the buyer"
                      : "refunding the Bitcoin to the seller"}
                  </strong>
                  . Waiting for the other party to confirm — you cannot confirm
                  your own proposal.
                </p>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm">
                    {counterpartyName} proposes{" "}
                    <strong>
                      {dispute.proposed_outcome === "release_to_buyer"
                        ? "releasing the Bitcoin to the buyer"
                        : "refunding the Bitcoin to the seller"}
                    </strong>
                    . Confirm only if you genuinely agree — confirming moves
                    the escrow immediately and closes the dispute.
                  </p>
                  <Button disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                    {confirm.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Confirm settlement
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Evidence */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertDescription className="text-xs leading-relaxed">
                A chat screenshot is not proof of payment — for either side.
                What decides a case is the payment record itself: the
                provider receipt or statement entry showing the amount, the
                reference and the parties. Attach that. Evidence is permanent:
                you can add to it, never edit or remove it.
              </AlertDescription>
            </Alert>

            {evidenceQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (evidenceQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidence submitted yet.</p>
            ) : (
              <div className="space-y-2">
                {(evidenceQuery.data ?? []).map((ev: P2pEvidence) => (
                  <div key={ev.id} className="border border-border rounded-md p-3 text-sm space-y-1">
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                      <Badge variant="outline">{ev.kind === "file" ? "File" : "Statement"}</Badge>
                      <span>
                        {ev.submitter_id === user?.id ? "You" : counterpartyName} ·{" "}
                        {format(new Date(ev.created_at), "d MMM yyyy, HH:mm")}
                      </span>
                      {ev.file_hash && (
                        <span className="font-mono">SHA-256 {ev.file_hash.slice(0, 12)}…</span>
                      )}
                    </div>
                    {ev.body && <p className="whitespace-pre-wrap">{ev.body}</p>}
                    {ev.storage_path && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 h-7 text-xs"
                        onClick={async () => {
                          const url = await p2pEvidenceSignedUrl(ev.storage_path!);
                          if (url) window.open(url, "_blank", "noopener");
                          else toast({ title: "File unavailable", description: "That file can't be opened right now, but it is recorded on this dispute.", variant: "destructive" });
                        }}
                      >
                        <FileText className="h-3 w-3" /> View file
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isOpen && (
              <div className="space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label htmlFor="evidence-statement">Add a statement</Label>
                  <Textarea
                    id="evidence-statement"
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="State the facts: what you paid or received, when, from which account, with which reference."
                  />
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    onClick={() => statement.trim() && addEvidence.mutate({ kind: "statement", body: statement.trim() })}
                    disabled={!statement.trim() || addEvidence.isPending}
                  >
                    {addEvidence.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Add statement
                  </Button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void attachFile(f);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    variant="outline"
                    className="gap-2"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                    Attach the provider receipt
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </P2pShell>
  );
}
