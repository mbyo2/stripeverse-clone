import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { QrScanButton } from "@/components/QrScanButton";
import { supabase } from "@/integrations/supabase/client";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import { useInvalidateMoneyState } from "@/utils/moneyFreshness";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { useToast } from "@/hooks/use-toast";
import {
  classifySendInput,
  type LnurlIntent,
} from "@/lib/unifiedSendInput";
import { Zap, Loader2, Send } from "lucide-react";

/**
 * Custodial Lightning SEND — pay a bolt11 invoice from the custodial
 * Bitcoin wallet's balance (lightning-service pay_invoice).
 *
 * Flow: paste or scan an invoice → decode_invoice shows the exact
 * amount + description for review (fee policy: exactly the invoice
 * amount leaves the wallet — Lightning-out carries no provider fee)
 * → pay_invoice reserves, pays via the provider, and settles only on
 * the provider's independent read-back. A send whose outcome is not
 * yet known lands in the "processing" state: the sats stay held,
 * the screen says plainly not to pay the invoice again, and
 * check_status keeps polling until it resolves — the same doctrine
 * as the on-chain send's "verifying" state. Payment ids, hashes,
 * and raw provider text never render — states are crafted plain
 * language only.
 *
 * The idempotency key is minted once per reviewed invoice, so a
 * double-tap or a retry of the same reviewed payment can never pay
 * twice.
 *
 * Unified input (close-out B1): the paste/scan field accepts any
 * Bitcoin destination and routes on classifySendInput — invoices
 * review here; anything else is handed to the parent dialog
 * (onRouteOnchain / onLnurlIntent) or answered in plain language.
 * Only the entry point is unified; decode → review → pay is as it was.
 */

type DecodedInvoice = {
  amount_sats: number;
  description: string | null;
  expires_at: string | null;
};

type SendResult =
  | { kind: "paid"; sats: number }
  | { kind: "failed"; message: string }
  | { kind: "processing"; paymentId: string };

function newIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `lnsend-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function LightningSend({
  onDone,
  initialInvoice,
  onRouteOnchain,
  onLnurlIntent,
}: {
  onDone: () => void;
  /**
   * Unified routing (close-out B1): an invoice handed over from the
   * On-chain tab (or the send dialog's unified classification) opens
   * straight into this review flow. Entry-point reuse only — the
   * payment logic below is untouched.
   */
  initialInvoice?: string;
  /** Called when the pasted destination is an on-chain address. */
  onRouteOnchain?: (address: string, amountSats?: number) => void;
  /** Called when the pasted destination is an LNURL intent. */
  onLnurlIntent?: (intent: LnurlIntent) => void;
}) {
  const { toast } = useToast();
  const { wallet } = useBitcoinWallet();
  const invalidateMoney = useInvalidateMoneyState();
  const [invoice, setInvoice] = useState("");
  const [decoded, setDecoded] = useState<DecodedInvoice | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const idemKeyRef = useRef<string>("");
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };
  useEffect(() => stopPolling, []);

  const reviewInvoice = async (raw: string) => {
    const bolt11 = raw.trim();
    if (!bolt11) return;
    setDecoding(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: { action: "decode_invoice", bolt11 },
      });
      if (error) throw error;
      if (!data || typeof data.amount_sats !== "number") {
        throw new Error("decode_invoice returned no amount");
      }
      // A fresh review mints a fresh idempotency key; paying the same
      // reviewed invoice with the same key replays, never re-pays.
      idemKeyRef.current = newIdempotencyKey();
      setDecoded(data as DecodedInvoice);
    } catch (e: unknown) {
      setDecoded(null);
      toast({
        title: "Couldn't read that invoice",
        description: await resolveEdgeFunctionError(
          e,
          "That doesn't look like a valid Lightning invoice — check the code and try again.",
        ),
        variant: "destructive",
      });
    } finally {
      setDecoding(false);
    }
  };

  // Unified routing (close-out B1): this field accepts ANY Bitcoin
  // destination, not just invoices. The shared classifier decides —
  // an invoice reviews here, an address routes to the on-chain form,
  // a Lightning address / LNURL surfaces as a typed intent, and
  // anything else answers with a plain-language reason. Review and
  // payment below are unchanged.
  const routeInput = (raw: string) => {
    const classified = classifySendInput(raw);
    switch (classified.kind) {
      case "bolt11": {
        if (classified.expired) {
          toast({
            title: "This invoice has expired",
            description:
              "Lightning invoices are only valid for a short time — ask the sender for a new one and paste that instead. Nothing was sent.",
            variant: "destructive",
          });
          return;
        }
        setInvoice(classified.destination);
        void reviewInvoice(classified.destination);
        return;
      }
      case "onchain": {
        if (onRouteOnchain) {
          onRouteOnchain(classified.destination, classified.amountSats);
          toast({
            title: "That's a Bitcoin address",
            description:
              "We've opened the On-chain tab with it filled in — a plain address can't be paid over Lightning.",
          });
        } else {
          toast({
            title: "That's a Bitcoin address",
            description:
              "Use the On-chain tab above to send to a plain address — Lightning needs an invoice.",
            variant: "destructive",
          });
        }
        return;
      }
      case "lightningAddress":
      case "lnurl": {
        if (onLnurlIntent) {
          onLnurlIntent(classified.intent);
        } else {
          toast({
            title: "Not available yet",
            description:
              "Lightning address support is being switched on — for now, ask for a Lightning invoice (lnbc…) and paste that instead.",
          });
        }
        return;
      }
      case "invalid": {
        toast({
          title: "Couldn't use that destination",
          description: classified.reason,
          variant: "destructive",
        });
        return;
      }
    }
  };

  const handleScanned = (text: string) => {
    routeInput(text);
  };

  // A routed-in invoice opens straight into the review flow, once.
  const initialHandledRef = useRef(false);
  useEffect(() => {
    if (initialInvoice && !initialHandledRef.current) {
      initialHandledRef.current = true;
      routeInput(initialInvoice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInvoice]);

  const startProcessingPoll = (paymentId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: { action: "check_status", breez_invoice_id: paymentId },
      });
      if (error || !data?.status) return;
      if (data.status === "paid") {
        stopPolling();
        setResult({ kind: "paid", sats: 0 });
        invalidateMoney();
        onDone();
      } else if (data.status === "failed") {
        stopPolling();
        setResult({
          kind: "failed",
          message:
            "This payment didn't go through, and the held sats are back in your wallet. Nothing was sent.",
        });
        invalidateMoney();
        onDone();
      }
    }, 5000);
  };

  const pay = async () => {
    if (!decoded) return;
    if (wallet && decoded.amount_sats > wallet.available_sats) {
      toast({
        title: "Not enough Bitcoin",
        description:
          `This invoice is ${decoded.amount_sats.toLocaleString()} sats, but only ${wallet.available_sats.toLocaleString()} sats are available.`,
        variant: "destructive",
      });
      return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("lightning-service", {
        body: {
          action: "pay_invoice",
          bolt11: invoice.trim(),
          idempotency_key: idemKeyRef.current || newIdempotencyKey(),
        },
      });
      if (error) throw error;
      if (data?.status === "paid") {
        setResult({ kind: "paid", sats: decoded.amount_sats });
        // Rotate the key: the next reviewed payment is a new intent.
        idemKeyRef.current = newIdempotencyKey();
        invalidateMoney();
        onDone();
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
        onDone();
        return;
      }
      // Processing: the outcome isn't known yet — the hold stays and
      // the send must not be repeated. Poll until it resolves.
      const paymentId = typeof data?.payment_id === "string" ? data.payment_id : "";
      setResult({ kind: "processing", paymentId });
      if (paymentId) startProcessingPoll(paymentId);
      invalidateMoney();
      onDone();
    } catch (e: unknown) {
      // A transport-level failure answers nothing about the payment:
      // the crafted server refusals (invalid / expired / insufficient)
      // arrive here too, and any of them means no send was settled —
      // the server releases or never took the hold for those.
      setResult({
        kind: "failed",
        message: await resolveEdgeFunctionError(
          e,
          "This payment didn't go through. Nothing was sent — check the invoice and try again.",
        ),
      });
    } finally {
      setSending(false);
    }
  };

  const reset = () => {
    stopPolling();
    setInvoice("");
    setDecoded(null);
    setResult(null);
  };

  if (result) {
    if (result.kind === "processing") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Your payment is being confirmed</p>
          <p className="text-sm text-muted-foreground">
            Your Bitcoin is held safely while this is checked — please do not
            pay this invoice again. We're confirming it with the Lightning
            network automatically, and your balance updates as soon as it
            settles.
          </p>
          <Button variant="outline" className="w-full" onClick={reset}>
            Pay a different invoice
          </Button>
        </div>
      );
    }
    if (result.kind === "paid") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Payment sent</p>
          <p className="text-sm text-muted-foreground">
            {result.sats > 0
              ? `${result.sats.toLocaleString()} sats left your wallet over Lightning.`
              : "Your Lightning payment went through."}
          </p>
          <Button className="w-full" onClick={reset}>Pay another invoice</Button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Payment not sent</p>
        <p className="text-sm text-muted-foreground">{result.message}</p>
        <Button className="w-full" onClick={reset}>Try again</Button>
      </div>
    );
  }

  if (decoded) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border p-3 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">{decoded.amount_sats.toLocaleString()} sats</span>
          </div>
          {decoded.description && (
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">For</span>
              <span className="text-right break-words">{decoded.description}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fee</span>
            <span className="font-medium">None</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Exactly the invoice amount leaves your wallet — Lightning
            payments here carry no fee.
          </p>
          {decoded.expires_at && (
            <p className="text-xs text-muted-foreground">
              Pay before {new Date(decoded.expires_at).toLocaleString()} —
              Lightning invoices expire.
            </p>
          )}
        </div>
        <Button className="w-full" onClick={pay} disabled={sending}>
          {sending
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <Zap className="h-4 w-4 mr-2" />}
          {sending ? "Sending…" : `Pay ${decoded.amount_sats.toLocaleString()} sats`}
        </Button>
        <Button variant="ghost" className="w-full" onClick={reset} disabled={sending}>
          Use a different invoice
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="lnInvoice">Destination</Label>
          <QrScanButton onScan={handleScanned} />
        </div>
        <Textarea
          id="lnInvoice"
          placeholder="lnbc… — or paste an address, LNURL, or Lightning address"
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          rows={4}
          className="break-all"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {wallet
          ? `Available: ${wallet.available_sats.toLocaleString()} sats. `
          : ""}
        Paste any Bitcoin destination — we'll take you to the right
        place for it. You'll see the exact amount before anything is sent.
      </p>
      <Button onClick={() => routeInput(invoice)} disabled={!invoice.trim() || decoding} className="w-full">
        {decoding
          ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
          : <Send className="h-4 w-4 mr-2" />}
        {decoding ? "Reading invoice…" : "Review payment"}
      </Button>
    </div>
  );
}
