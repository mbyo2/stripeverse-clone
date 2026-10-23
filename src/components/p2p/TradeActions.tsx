import { ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Paperclip, ShieldAlert } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  newIdempotencyKey,
  p2pAction,
  P2pActionError,
  uploadP2pEvidenceFile,
  type P2pOrder,
  type P2pPaymentClaim,
} from "@/services/p2pService";
import {
  useInvalidateP2p,
  useP2pKycState,
  useP2pPaymentMethods,
} from "@/hooks/useP2p";
import Countdown from "@/components/p2p/Countdown";
import {
  DISPUTE_REASON_LABELS,
  disputeReasonsFor,
  formatZmw,
  paymentMethodTypeLabel,
  REPORT_CATEGORY_LABELS,
  validateMarkPaidForm,
  validateReleaseForm,
  type DisputeRole,
} from "@/utils/p2pUi";

function errorText(e: unknown, fallback: string): string {
  return e instanceof P2pActionError || e instanceof Error ? e.message : fallback;
}

// ---------------------------------------------------------------------
// Mark paid (§3.5 buyer side)
// ---------------------------------------------------------------------

export function MarkPaidForm({ order }: { order: P2pOrder }) {
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const methodsQuery = useP2pPaymentMethods();
  const kycQuery = useP2pKycState();
  const [methodId, setMethodId] = useState("");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(order.fiat_amount_zmw));
  const [proof, setProof] = useState<{ path: string; hash: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [idemKey] = useState(() => newIdempotencyKey());
  const fileRef = useRef<HTMLInputElement>(null);

  const myMethods = (methodsQuery.data ?? []).filter((m) => m.status === "active");
  const kycName = kycQuery.data?.fullName;

  const markPaid = useMutation({
    mutationFn: () =>
      p2pAction(
        "mark_paid",
        {
          order_id: order.id,
          payment_method_id: methodId,
          rail_reference: reference.trim(),
          amount_sent_zmw: Number(amount),
          payer_name_attested: kycName ?? undefined,
          proof_file_hash: proof?.hash,
          proof_storage_path: proof?.path,
          idempotency_key: idemKey,
        },
        "We couldn't mark this order as paid. Please try again.",
      ),
    onSuccess: () => {
      toast({
        title: "Payment marked",
        description: "The seller has been asked to confirm. Keep your payment receipt — you may need it.",
      });
      invalidate();
    },
    onError: (e: unknown) =>
      setFormError(errorText(e, "We couldn't mark this order as paid. Please try again.")),
  });

  const attachProof = async (file: File) => {
    setUploading(true);
    try {
      setProof(await uploadP2pEvidenceFile(file, `proof/${order.id}`));
    } catch (e) {
      toast({
        title: "Proof not attached",
        description: errorText(e, "The file could not be uploaded. You can still mark paid without it."),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const err = validateMarkPaidForm(
      { paymentMethodId: methodId, railReference: reference, amountSentZmw: amount },
      Number(order.fiat_amount_zmw),
    );
    setFormError(err);
    if (!err) markPaid.mutate();
  };

  return (
    <div className="space-y-4">
      <Alert className="border-amber-500/40 bg-amber-500/5">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle>Pay only the account on this order</AlertTitle>
        <AlertDescription className="text-xs leading-relaxed">
          Pay from your own registered account, in your own name. Paying from
          someone else's account freezes this trade. Never trust a payment
          destination sent in chat — only the one shown here.
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label>I paid from</Label>
        {methodsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading your payment methods…</p>
        ) : myMethods.length === 0 ? (
          <Alert>
            <AlertDescription>
              You have no registered payment method.{" "}
              <a href="/p2p/profile" className="underline font-medium">
                Add one on your P2P profile
              </a>{" "}
              before paying — payments from unregistered accounts are refused.
            </AlertDescription>
          </Alert>
        ) : (
          <Select value={methodId} onValueChange={setMethodId}>
            <SelectTrigger>
              <SelectValue placeholder="Choose the account you paid from" />
            </SelectTrigger>
            <SelectContent>
              {myMethods.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {paymentMethodTypeLabel(m.type)} · {m.account_number} · {m.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="mp-amount">Amount sent (ZMW)</Label>
          <Input
            id="mp-amount"
            type="number"
            step="0.01"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Must equal the order amount exactly: {formatZmw(Number(order.fiat_amount_zmw))}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="mp-ref">Payment reference / transaction ID</Label>
          <Input
            id="mp-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. MP260923.1234.A1B2C3"
            maxLength={120}
          />
          <p className="text-[11px] text-muted-foreground">
            From your mobile-money or bank transaction. Each reference can only
            be used once, ever.
          </p>
        </div>
      </div>

      {kycName && (
        <p className="text-xs text-muted-foreground border border-border rounded-md p-3">
          You confirm you paid from your own account in the name{" "}
          <strong className="text-foreground">{kycName}</strong>. Paying from
          someone else's account will freeze this trade.
        </p>
      )}

      <div className="space-y-2">
        <Label>Proof of payment (optional)</Label>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void attachProof(f);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="gap-2"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
            {proof ? "Proof attached" : "Attach the provider receipt"}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Helps in a dispute — but a screenshot alone never releases a trade.
          </span>
        </div>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Button onClick={submit} disabled={markPaid.isPending} className="w-full sm:w-auto">
        {markPaid.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        I have paid — mark as paid
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Confirm release (§3.5 seller side — the checklist IS the control)
// ---------------------------------------------------------------------

export function ReleaseForm({
  order,
  claim,
}: {
  order: P2pOrder;
  claim: P2pPaymentClaim | null;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedReference, setReceivedReference] = useState("");
  const [checkedOwn, setCheckedOwn] = useState(false);
  const [checkedFull, setCheckedFull] = useState(false);
  const [checkedName, setCheckedName] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [idemKey, setIdemKey] = useState(() => newIdempotencyKey());

  const releaseAt =
    order.settle_delay_minutes > 0 && order.paid_marked_at
      ? new Date(
          new Date(order.paid_marked_at).getTime() +
            order.settle_delay_minutes * 60_000,
        ).toISOString()
      : null;
  const delayActive = releaseAt !== null && new Date(releaseAt).getTime() > Date.now();

  const release = useMutation({
    mutationFn: () =>
      p2pAction(
        "confirm_release",
        {
          order_id: order.id,
          received_amount_zmw: Number(receivedAmount),
          received_reference: receivedReference.trim(),
          checked_own_account: checkedOwn,
          checked_full_amount: checkedFull,
          checked_sender_name: checkedName,
          idempotency_key: idemKey,
        },
        "We couldn't release this trade. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Bitcoin released", description: "This trade is complete. Thank you for trading safely." });
      invalidate();
    },
    onError: (e: unknown) => {
      setIdemKey(newIdempotencyKey());
      setFormError(errorText(e, "We couldn't release this trade. Please try again."));
    },
  });

  const submit = () => {
    const err = validateReleaseForm(
      {
        receivedAmountZmw: receivedAmount,
        receivedReference,
        checkedOwnAccount: checkedOwn,
        checkedFullAmount: checkedFull,
        checkedSenderName: checkedName,
      },
      Number(order.fiat_amount_zmw),
    );
    setFormError(err);
    if (!err) release.mutate();
  };

  return (
    <div className="space-y-4">
      {claim ? (
        <div className="border border-border rounded-md p-3 text-sm space-y-1">
          <p className="font-medium">The buyer says they paid:</p>
          <p>
            Amount claimed: <strong>{formatZmw(Number(claim.amount_sent_zmw))}</strong>
          </p>
          <p>
            Reference claimed: <span className="font-mono">{claim.rail_reference}</span>
          </p>
          {claim.payer_name_attested && (
            <p>
              Paid in the name: <strong>{claim.payer_name_attested}</strong>
            </p>
          )}
          <p className="text-xs text-amber-600 dark:text-amber-400 pt-1">
            This is the buyer's claim — not proof. Only release after you see
            this exact amount and reference inside your own account.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No payment claim is recorded for this order yet.
        </p>
      )}

      {delayActive && releaseAt && (
        <Alert className="border-amber-500/40 bg-amber-500/5">
          <AlertTitle>Settle delay is running</AlertTitle>
          <AlertDescription>
            This ad has a settle delay against reversed payments. Release
            opens <Countdown to={releaseAt} /> from now. Waiting protects you —
            a payment can be reversed by the provider after it arrives.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={checkedOwn} onCheckedChange={(v) => setCheckedOwn(v === true)} className="mt-0.5" />
          <span>
            I checked <strong>inside my own mobile-money/bank account</strong> —
            not a screenshot, not an SMS, not the chat.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={checkedFull} onCheckedChange={(v) => setCheckedFull(v === true)} className="mt-0.5" />
          <span>
            The money is <strong>in my account</strong>, for the{" "}
            <strong>full amount</strong> of {formatZmw(Number(order.fiat_amount_zmw))}.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox checked={checkedName} onCheckedChange={(v) => setCheckedName(v === true)} className="mt-0.5" />
          <span>
            The <strong>sender name matches</strong> the buyer named on this
            order.
          </span>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="rel-amount">Amount received (ZMW) — type it</Label>
          <Input
            id="rel-amount"
            type="number"
            step="0.01"
            min={0}
            value={receivedAmount}
            onChange={(e) => setReceivedAmount(e.target.value)}
            placeholder={String(order.fiat_amount_zmw)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rel-ref">Reference — type it from your account</Label>
          <Input
            id="rel-ref"
            value={receivedReference}
            onChange={(e) => setReceivedReference(e.target.value)}
            maxLength={120}
            placeholder="The reference you see in your account"
          />
        </div>
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Button
        onClick={submit}
        disabled={release.isPending || delayActive}
        className="w-full sm:w-auto"
      >
        {release.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Release Bitcoin to the buyer
      </Button>
      <p className="text-[11px] text-muted-foreground">
        Releasing is final. If anything does not match, do not release — open a
        dispute and the escrow stays frozen while it is resolved.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------

export function CancelOrderButton({
  order,
  role,
}: {
  order: P2pOrder;
  role: DisputeRole;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [idemKey] = useState(() => newIdempotencyKey());

  const windowExpired = new Date(order.expires_at).getTime() <= Date.now();
  // §3.6: the buyer may cancel freely before paying; the seller only
  // once the payment window has expired (their remedy before that is
  // to wait for expiry). The RPC enforces both.
  const canCancel = role === "buyer" || windowExpired;

  const cancel = useMutation({
    mutationFn: () =>
      p2pAction(
        "cancel_order",
        { order_id: order.id, reason: reason.trim() || undefined, idempotency_key: idemKey },
        "We couldn't cancel this order. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Order cancelled", description: "The escrowed Bitcoin has been returned to the seller." });
      setOpen(false);
      invalidate();
    },
    onError: (e: unknown) =>
      toast({
        title: "Cancel failed",
        description: errorText(e, "We couldn't cancel this order. Please try again."),
        variant: "destructive",
      }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Cancel order</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this order?</DialogTitle>
          <DialogDescription>
            {role === "buyer"
              ? "Only cancel if you have NOT paid. If you already paid, do not cancel — open a dispute instead so the escrow stays frozen. Cancelling returns the Bitcoin to the seller."
              : "Cancelling returns the escrowed Bitcoin to you. The buyer's unpaid-cancel counter is recorded."}
          </DialogDescription>
        </DialogHeader>
        {!canCancel && (
          <Alert>
            <AlertDescription>
              As the seller you can cancel once the payment window has
              expired. Until then the buyer still has time to pay.
            </AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Why are you cancelling?"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Keep the order
          </Button>
          <Button
            variant="destructive"
            disabled={!canCancel || cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Cancel the order
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Open dispute
// ---------------------------------------------------------------------

export function OpenDisputeDialog({
  order,
  role,
  trigger,
}: {
  order: P2pOrder;
  role: DisputeRole;
  trigger?: ReactNode;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const invalidate = useInvalidateP2p();
  const reasons = disputeReasonsFor(role, order.status as never);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [detail, setDetail] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [idemKey] = useState(() => newIdempotencyKey());

  const openDispute = useMutation({
    mutationFn: () =>
      p2pAction<{ dispute?: { id: string }; auto_resolved?: string }>(
        "open_dispute",
        {
          order_id: order.id,
          reason,
          detail: detail.trim() || undefined,
          idempotency_key: idemKey,
        },
        "We couldn't open this dispute. Please try again.",
      ),
    onSuccess: (res) => {
      setOpen(false);
      invalidate();
      if (res.auto_resolved) {
        toast({
          title: "Order cancelled",
          description: "The order was cancelled and the escrowed Bitcoin returned to the seller.",
        });
      } else if (res.dispute?.id) {
        toast({
          title: "Dispute opened",
          description: "The escrow is frozen. Add your evidence so the case can be ruled on quickly.",
        });
        navigate(`/p2p/disputes/${res.dispute.id}`);
      }
    },
    onError: (e: unknown) =>
      setFormError(errorText(e, "We couldn't open this dispute. Please try again.")),
  });

  if (reasons.length === 0) return null;

  const submit = () => {
    if (!reason) {
      setFormError("Choose what went wrong.");
      return;
    }
    if (reason === "other" && !detail.trim()) {
      setFormError("Describe the problem so the support team can help.");
      return;
    }
    setFormError(null);
    openDispute.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className="gap-2">
            <ShieldAlert className="h-4 w-4" /> Open a dispute
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open a dispute</DialogTitle>
          <DialogDescription>
            Opening a dispute freezes the escrow immediately — the Bitcoin
            cannot move until the dispute is settled or ruled on. A chat
            screenshot is not proof of payment; the support team rules on the
            payment record itself.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>What went wrong?</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a reason" />
              </SelectTrigger>
              <SelectContent>
                {reasons.map((r) => (
                  <SelectItem key={r} value={r}>
                    {DISPUTE_REASON_LABELS[r] ?? r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dispute-detail">
              Details {reason === "other" ? "(required)" : "(optional)"}
            </Label>
            <Textarea
              id="dispute-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="What happened, in your own words?"
            />
          </div>
          {formError && (
            <Alert variant="destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Not yet
          </Button>
          <Button onClick={submit} disabled={openDispute.isPending}>
            {openDispute.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Freeze escrow & open dispute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Block / report the counterparty
// ---------------------------------------------------------------------

export function CounterpartyActions({
  order,
  counterpartyId,
  counterpartyName,
}: {
  order: P2pOrder;
  counterpartyId: string;
  counterpartyName: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const invalidate = useInvalidateP2p();
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [reportCategory, setReportCategory] = useState("");
  const [reportDetail, setReportDetail] = useState("");

  const block = useMutation({
    mutationFn: () =>
      p2pAction(
        "block_user",
        { blocked_id: counterpartyId, reason: blockReason.trim() || undefined },
        "We couldn't block this trader. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Trader blocked", description: "You will not be able to open orders with each other." });
      setBlockOpen(false);
      invalidate();
    },
    onError: (e: unknown) =>
      toast({ title: "Block failed", description: errorText(e, "We couldn't block this trader."), variant: "destructive" }),
  });

  const report = useMutation({
    mutationFn: () =>
      p2pAction(
        "report_user",
        {
          subject_id: counterpartyId,
          category: reportCategory,
          order_id: order.id,
          detail: reportDetail.trim() || undefined,
        },
        "We couldn't send this report. Please try again.",
      ),
    onSuccess: () => {
      toast({ title: "Report sent", description: "Thank you — the safety team will review it." });
      setReportOpen(false);
    },
    onError: (e: unknown) =>
      toast({ title: "Report failed", description: errorText(e, "We couldn't send this report."), variant: "destructive" }),
  });

  if (!user || user.id === counterpartyId) return null;

  return (
    <div className="flex gap-2 flex-wrap">
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm">
            Report {counterpartyName}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Report this trader</DialogTitle>
            <DialogDescription>
              Reports go to the safety team with this order attached. Reporting
              does not change this trade — open a dispute for that.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={reportCategory} onValueChange={setReportCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a category" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(REPORT_CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-detail">Details (optional)</Label>
              <Textarea
                id="report-detail"
                value={reportDetail}
                onChange={(e) => setReportDetail(e.target.value)}
                maxLength={2000}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!reportCategory || report.isPending}
              onClick={() => report.mutate()}
            >
              {report.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
            Block {counterpartyName}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block this trader?</DialogTitle>
            <DialogDescription>
              You will not be able to open new orders with each other. This
              does not affect the current trade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="block-reason">Reason (optional)</Label>
            <Input
              id="block-reason"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value)}
              maxLength={500}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBlockOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={block.isPending} onClick={() => block.mutate()}>
              {block.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Block trader
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
