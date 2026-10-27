import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { QrScanButton } from "@/components/QrScanButton";
import { supabase } from "@/integrations/supabase/client";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import { useInvalidateMoneyState } from "@/utils/moneyFreshness";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useToast } from "@/hooks/use-toast";
import { Zap, Loader2, Send, Download } from "lucide-react";

/**
 * Custodial LNURL — pay a Lightning address / LNURL-pay code, or
 * claim an LNURL-withdraw offer, from the custodial Bitcoin wallet
 * (lightning-service lnurl_pay_resolve / lnurl_pay / lnurl_withdraw).
 *
 * This component is the LNURL sibling of LightningSend: the
 * coordinator mounts it beside the invoice form in the send dialog.
 * It takes a classified intent from the QR classifier
 * (src/lib/qrScan.ts kinds "lnurl" | "lightningAddress") or a pasted
 * destination, then drives:
 *
 *   resolve → review (destination domain, amount inside the
 *   service's own bounds, description, optional note) → pay — the
 *   server re-resolves, fetches the invoice from the service's
 *   callback, and pays it reserve-first; settlement is confirmed
 *   by read-back, so an unconfirmed send lands in the same
 *   "processing" hold wording as LightningSend and polls
 *   check_status until it resolves.
 *
 *   withdraw offers resolve to the withdraw review instead:
 *   amount inside the offer's bounds → claim — the server creates
 *   a wallet invoice and hands it to the service; the Bitcoin then
 *   arrives as an ordinary Lightning deposit, and this component
 *   polls check_status until it lands.
 *
 * Fees: exactly the invoice amount leaves the wallet for a pay —
 * the same no-fee Lightning-out policy LightningSend states.
 * Payment ids, hashes, raw endpoint text and LNURL internals
 * (callback URLs, k1) never render — plain language only.
 *
 * LNURL-auth sign-in is NOT offered here: custodial sign-in would
 * need the platform to hold a signing key for the user (see the
 * close-out assessment). Self-custody keeps that feature.
 */

export interface LnurlIntent {
  kind: "lnurl" | "lightningAddress";
  destination: string;
}

interface ResolvedPay {
  kind: "pay";
  domain: string;
  min_sats: number;
  max_sats: number;
  fixed_amount_sats: number | null;
  description: string | null;
  identifier: string | null;
  comment_allowed: number;
}

interface ResolvedWithdraw {
  kind: "withdraw";
  domain: string;
  min_sats: number;
  max_sats: number;
  fixed_amount_sats: number | null;
  description: string | null;
}

type Resolved = ResolvedPay | ResolvedWithdraw;

type Result =
  | { kind: "paid"; sats: number }
  | { kind: "failed"; message: string }
  | { kind: "processing"; paymentId: string }
  | { kind: "withdraw_submitted"; paymentId: string; sats: number }
  | { kind: "withdraw_paid"; sats: number };

function newIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `lnurl-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function LnurlSend({
  intent,
  initialDestination,
  onDone,
}: {
  intent?: LnurlIntent;
  initialDestination?: string;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const { wallet } = useBitcoinWallet();
  const invalidateMoney = useInvalidateMoneyState();
  const [destination, setDestination] = useState(
    intent?.destination ?? initialDestination ?? "",
  );
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [resolving, setResolving] = useState(false);
  const [amount, setAmount] = useState("");
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const idemKeyRef = useRef<string>("");
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const startStatusPoll = (paymentId: string, mode: "pay" | "withdraw", sats: number) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: { action: "check_status", breez_invoice_id: paymentId },
      });
      if (error || !data?.status) return;
      if (data.status === "paid") {
        stopPolling();
        setResult(
          mode === "pay" ? { kind: "paid", sats } : { kind: "withdraw_paid", sats },
        );
        invalidateMoney();
        onDone?.();
      } else if (data.status === "failed" && mode === "pay") {
        stopPolling();
        setResult({
          kind: "failed",
          message:
            "This payment didn't go through, and the held sats are back in your wallet. Nothing was sent.",
        });
        invalidateMoney();
        onDone?.();
      }
    }, 5000);
  };

  const resolve = async (raw: string) => {
    const input = raw.trim();
    if (!input) return;
    setResolving(true);
    setResult(null);
    setResolved(null);
    try {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: { action: "lnurl_pay_resolve", input },
      });
      if (error) throw error;
      if (!data || (data.kind !== "pay" && data.kind !== "withdraw")) {
        throw new Error("lnurl_pay_resolve returned an unknown kind");
      }
      const next = data as Resolved;
      setResolved(next);
      // A fresh review mints a fresh idempotency key (pay only);
      // retrying the same reviewed payment replays, never re-pays.
      idemKeyRef.current = newIdempotencyKey();
      setAmount(next.fixed_amount_sats !== null ? String(next.fixed_amount_sats) : "");
      setComment("");
    } catch (e: unknown) {
      toast({
        title: "Couldn't look that up",
        description: await resolveEdgeFunctionError(
          e,
          "That doesn't look like a Lightning address or LNURL code — check it and try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  };

  const handleScanned = (text: string) => {
    const value = text.trim().replace(/^lightning:/i, "");
    setDestination(value);
    void resolve(value);
  };

  const parsedAmount = (): number | null => {
    const n = Number(amount);
    return Number.isInteger(n) && n > 0 ? n : null;
  };

  const pay = async () => {
    if (!resolved || resolved.kind !== "pay") return;
    const sats = resolved.fixed_amount_sats ?? parsedAmount();
    if (sats === null) {
      toast({
        title: "Enter an amount",
        description: "Enter the amount to pay, in sats.",
        variant: "destructive",
      });
      return;
    }
    if (wallet && sats > wallet.available_sats) {
      toast({
        title: "Not enough Bitcoin",
        description: `This payment is ${sats.toLocaleString()} sats, but only ${wallet.available_sats.toLocaleString()} sats are available.`,
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: {
          action: "lnurl_pay",
          input: destination.trim(),
          amount_sats: sats,
          comment: comment.trim() || undefined,
          idempotency_key: idemKeyRef.current || newIdempotencyKey(),
        },
      });
      if (error) throw error;
      if (data?.status === "paid") {
        setResult({ kind: "paid", sats });
        idemKeyRef.current = newIdempotencyKey();
        invalidateMoney();
        onDone?.();
        return;
      }
      if (data?.status === "failed") {
        setResult({
          kind: "failed",
          message: typeof data?.error === "string"
            ? data.error
            : "This payment didn't go through. Nothing was sent.",
        });
        invalidateMoney();
        onDone?.();
        return;
      }
      const paymentId = typeof data?.payment_id === "string" ? data.payment_id : "";
      setResult({ kind: "processing", paymentId });
      if (paymentId) startStatusPoll(paymentId, "pay", sats);
      invalidateMoney();
      onDone?.();
    } catch (e: unknown) {
      setResult({
        kind: "failed",
        message: await resolveEdgeFunctionError(
          e,
          "This payment didn't go through. Nothing was sent — check the address and try again.",
        ),
      });
    } finally {
      setSending(false);
    }
  };

  const claimWithdraw = async () => {
    if (!resolved || resolved.kind !== "withdraw") return;
    const sats = resolved.fixed_amount_sats ?? parsedAmount();
    if (sats === null) {
      toast({
        title: "Enter an amount",
        description: "Enter the amount to withdraw, in sats.",
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: {
          action: "lnurl_withdraw",
          input: destination.trim(),
          amount_sats: sats,
        },
      });
      if (error) throw error;
      const paymentId = typeof data?.payment_id === "string" ? data.payment_id : "";
      setResult({ kind: "withdraw_submitted", paymentId, sats });
      if (paymentId) startStatusPoll(paymentId, "withdraw", sats);
      invalidateMoney();
      onDone?.();
    } catch (e: unknown) {
      setResult({
        kind: "failed",
        message: await resolveEdgeFunctionError(
          e,
          "That withdrawal didn't go through. Nothing was taken from anywhere — try again.",
        ),
      });
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    stopPolling();
    setDestination("");
    setResolved(null);
    setAmount("");
    setComment("");
    setResult(null);
  };

  if (result) {
    if (result.kind === "processing") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Your payment is being confirmed</p>
          <p className="text-sm text-muted-foreground">
            Your Bitcoin is held safely while this is checked — please do not
            pay this address again. We&apos;re confirming it with the Lightning
            network automatically, and your balance updates as soon as it
            settles.
          </p>
          <Button variant="outline" className="w-full" onClick={reset}>
            Pay a different address
          </Button>
        </div>
      );
    }
    if (result.kind === "paid") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Payment sent</p>
          <p className="text-sm text-muted-foreground">
            {result.sats.toLocaleString()} sats left your wallet over Lightning.
          </p>
          <Button className="w-full" onClick={reset}>Make another payment</Button>
        </div>
      );
    }
    if (result.kind === "withdraw_submitted") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Withdrawal requested</p>
          <p className="text-sm text-muted-foreground">
            Your withdrawal request was sent. When the service pays,{" "}
            {result.sats.toLocaleString()} sats arrive in your wallet
            automatically — there&apos;s nothing else to do.
          </p>
          <Button variant="outline" className="w-full" onClick={reset}>
            Done
          </Button>
        </div>
      );
    }
    if (result.kind === "withdraw_paid") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Bitcoin received</p>
          <p className="text-sm text-muted-foreground">
            {result.sats.toLocaleString()} sats arrived in your wallet over Lightning.
          </p>
          <Button className="w-full" onClick={reset}>Done</Button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">That didn&apos;t go through</p>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Button className="w-full" onClick={reset}>Try again</Button>
      </div>
    );
  }

  if (resolved?.kind === "pay") {
    const fixed = resolved.fixed_amount_sats !== null;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border p-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Paying</span>
            <span className="text-right break-words font-medium">
              {resolved.identifier ?? resolved.domain}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Service</span>
            <span className="font-medium">{resolved.domain}</span>
          </div>
          {resolved.description && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">For</span>
              <span className="text-right break-words">{resolved.description}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fee</span>
            <span className="font-medium">None</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Exactly the amount you enter leaves your wallet — Lightning
            payments here carry no fee.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lnurlAmount">Amount (sats)</Label>
          <Input
            id="lnurlAmount"
            type="number"
            min={resolved.min_sats}
            max={resolved.max_sats}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={fixed}
            placeholder={`${resolved.min_sats.toLocaleString()} – ${resolved.max_sats.toLocaleString()}`}
          />
          <p className="text-xs text-muted-foreground">
            {fixed
              ? `This service set the amount at ${resolved.fixed_amount_sats?.toLocaleString()} sats.`
              : `This service accepts between ${resolved.min_sats.toLocaleString()} and ${resolved.max_sats.toLocaleString()} sats.`}
          </p>
        </div>
        {resolved.comment_allowed > 0 && (
          <div className="space-y-1">
            <Label htmlFor="lnurlComment">Note (optional)</Label>
            <Input
              id="lnurlComment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={resolved.comment_allowed}
              placeholder="A short note for the receiver"
            />
          </div>
        )}
        <Button className="w-full" onClick={pay} disabled={sending}>
          {sending
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Zap className="h-4 w-4 mr-2" />}
          {sending ? "Sending…" : "Pay"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={reset} disabled={sending}>
          Use a different address
        </Button>
      </div>
    );
  }

  if (resolved?.kind === "withdraw") {
    const fixed = resolved.fixed_amount_sats !== null;
    return (
      <div className="space-y-4">
        <div className="rounded-lg border p-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Withdrawing from</span>
            <span className="font-medium">{resolved.domain}</span>
          </div>
          {resolved.description && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">For</span>
              <span className="text-right break-words">{resolved.description}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The Bitcoin arrives in this wallet as a Lightning payment from{" "}
            {resolved.domain} — there is no fee to receive it here.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="lnurlWithdrawAmount">Amount (sats)</Label>
          <Input
            id="lnurlWithdrawAmount"
            type="number"
            min={resolved.min_sats}
            max={resolved.max_sats}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={fixed}
            placeholder={`${resolved.min_sats.toLocaleString()} – ${resolved.max_sats.toLocaleString()}`}
          />
          <p className="text-xs text-muted-foreground">
            {fixed
              ? `This offer is fixed at ${resolved.fixed_amount_sats?.toLocaleString()} sats.`
              : `This offer lets you withdraw between ${resolved.min_sats.toLocaleString()} and ${resolved.max_sats.toLocaleString()} sats.`}
          </p>
        </div>
        <Button className="w-full" onClick={claimWithdraw} disabled={sending}>
          {sending
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Download className="h-4 w-4 mr-2" />}
          {sending ? "Requesting…" : "Withdraw to this wallet"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={reset} disabled={sending}>
          Use a different code
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lnurlDestination">Lightning address or LNURL code</Label>
          <QrScanButton onScan={handleScanned} />
        </div>
        <Textarea
          id="lnurlDestination"
          placeholder="name@service.com or lnurl1…"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          rows={3}
          className="break-all"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {wallet
          ? `Available: ${wallet.available_sats.toLocaleString()} sats. `
          : ""}
        You&apos;ll see the destination, its amount limits and the exact
        amount before anything is sent. Withdrawal codes are recognised
        here too.
      </p>
      <Button
        onClick={() => void resolve(destination)}
        disabled={!destination.trim() || resolving}
        className="w-full"
      >
        {resolving
          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
          : <Send className="h-4 w-4 mr-2" />}
        {resolving ? "Looking it up…" : "Review"}
      </Button>
    </div>
  );
}
