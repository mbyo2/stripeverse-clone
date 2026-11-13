import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle, Loader2, Smartphone } from "lucide-react";
import { toUserFacingError } from "@/utils/userFacingError";

/**
 * Pay a payment link with mobile money. The collection runs on the
 * SELLER's own mobile money account: the customer approves a prompt
 * on their phone, this panel polls the checkout function until the
 * payment settles or fails, and only a gateway-confirmed success is
 * ever shown as paid.
 */

interface Props {
  linkCode: string;
  /** The amount to charge: the link's fixed price, or the buyer's
   *  entered amount for any-amount links. This is the PRODUCT
   *  amount — the server grosses it up when the buyer pays the
   *  service charge, so the client never computes the total it
   *  sends. */
  amount: number;
  currency: string;
  email?: string;
  /** Who pays the 1% service charge on this link (describe) —
   *  'seller' by default. In buyer mode the buyer pays the product
   *  amount plus the service charge, and the seller receives the
   *  full product amount. */
  feeBearer?: "seller" | "buyer";
  /** The service charge added to the buyer's total (0 in seller
   *  mode). */
  serviceCharge?: number;
  /** The total the buyer actually pays (product + service charge
   *  in buyer mode; the product amount in seller mode). */
  buyerTotal?: number;
  onPaid: (transactionId: string | null) => void;
}

type Phase = "form" | "waiting" | "failed";

const OPERATOR_BY_PREFIX: Record<string, string> = {
  "096": "MTN", "076": "MTN",
  "097": "Airtel", "077": "Airtel",
  "095": "Zamtel",
};

function operatorName(phone: string): string | null {
  const p = phone.replace(/[\s\-().]/g, "").replace(/^\+/, "").replace(/^260/, "0");
  return OPERATOR_BY_PREFIX[p.slice(0, 3)] ?? null;
}

export default function MobileMoneyLinkPayment({
  linkCode,
  amount,
  currency,
  email,
  feeBearer = "seller",
  serviceCharge = 0,
  buyerTotal,
  onPaid,
}: Props) {
  const [phone, setPhone] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [waitedSeconds, setWaitedSeconds] = useState(0);
  const referenceRef = useRef<string | null>(null);
  const attemptKeyRef = useRef<string | null>(null);
  const pollRef = useRef<number | null>(null);
  // The total the buyer is charged: the product amount plus the
  // service charge in buyer mode, the product amount alone in
  // seller mode. Every number the buyer sees — the breakdown, the
  // approve prompt and the Pay button — uses this total, never the
  // product amount alone.
  const total = Math.round((buyerTotal ?? (amount + (feeBearer === "buyer" ? serviceCharge : 0))) * 100) / 100;

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => stopPolling, []);

  const pollStatus = async () => {
    const reference = referenceRef.current;
    if (!reference) return;
    try {
      const { data, error } = await supabase.functions.invoke("payment-link-checkout", {
        body: { action: "momo_status", link_code: linkCode, reference },
      });
      if (error || !data?.success) return; // transient — keep waiting
      if (data.status === "successful") {
        stopPolling();
        // Best-effort receipt, like the wallet path.
        if (email && data.transaction_id) {
          await supabase.functions
            .invoke("send-receipt", {
              body: { transaction_id: data.transaction_id, recipient_email: email, type: "payment" },
            })
            .catch(() => { /* receipt failure never unmakes a payment */ });
        }
        onPaid(data.transaction_id ?? null);
      } else if (data.status === "failed") {
        stopPolling();
        setFailureReason(
          typeof data.failure_reason === "string" && data.failure_reason
            ? data.failure_reason
            : "The payment didn't go through. No money was taken — please try again.",
        );
        setPhase("failed");
      }
    } catch {
      /* transient — the next poll retries */
    }
  };

  const start = async () => {
    setErrorMsg(null);
    const op = operatorName(phone);
    if (!op) {
      setErrorMsg("Enter a valid MTN, Airtel or Zamtel number, like 0977123456.");
      return;
    }
    setStarting(true);
    try {
      if (!attemptKeyRef.current) attemptKeyRef.current = crypto.randomUUID();
      const { data, error } = await supabase.functions.invoke("payment-link-checkout", {
        body: {
          action: "momo_create",
          link_code: linkCode,
          phone,
          amount,
          idempotency_key: attemptKeyRef.current,
        },
      });
      let failure: string | null = null;
      if (error) {
        failure = "The payment couldn't be started. No money was taken — please try again.";
        const context = (error as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === "string") failure = payload.error;
          } catch { /* keep the fallback */ }
        }
      } else if (!data?.success) {
        failure = (typeof data?.error === "string" && data.error) || failure;
      }
      if (failure) {
        setErrorMsg(toUserFacingError(failure));
        return;
      }
      if (data.status === "failed") {
        setFailureReason("The payment didn't go through. No money was taken — please try again.");
        setPhase("failed");
        return;
      }
      referenceRef.current = data.reference;
      setWaitedSeconds(0);
      setPhase("waiting");
      pollRef.current = window.setInterval(() => {
        setWaitedSeconds((s) => s + 4);
        void pollStatus();
      }, 4000);
      void pollStatus();
    } catch (e) {
      setErrorMsg(toUserFacingError(e, "The payment couldn't be started. No money was taken — please try again."));
    } finally {
      setStarting(false);
    }
  };

  const retry = () => {
    attemptKeyRef.current = crypto.randomUUID();
    referenceRef.current = null;
    setFailureReason(null);
    setPhase("form");
  };

  if (phase === "waiting") {
    return (
      <div className="space-y-4 text-center p-4 bg-muted rounded-lg">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <div>
          <p className="font-medium">Approve the prompt on your phone</p>
          <p className="text-sm text-muted-foreground mt-1">
            We sent a payment prompt to {phone}. Enter your mobile money PIN to approve{" "}
            {currency} {total.toFixed(2)}.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Waiting for approval… ({waitedSeconds}s) — this page updates itself when the payment lands.
        </p>
        <Button variant="outline" className="w-full" onClick={() => { stopPolling(); setPhase("form"); }}>
          Cancel and use a different number
        </Button>
      </div>
    );
  }

  if (phase === "failed") {
    return (
      <div className="space-y-4 p-4 bg-muted rounded-lg">
        <div className="flex gap-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{failureReason}</p>
        </div>
        <Button className="w-full" onClick={retry}>
          Try again
        </Button>
      </div>
    );
  }

  const detected = operatorName(phone);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="momo-phone">Mobile money number</Label>
        <Input
          id="momo-phone"
          inputMode="tel"
          placeholder="0977 123456"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={starting}
        />
        {detected && <p className="text-xs text-muted-foreground">{detected} Mobile Money</p>}
      </div>
      {errorMsg && (
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p>{errorMsg}</p>
        </div>
      )}
      <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground flex gap-2">
        <Smartphone className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          You'll get a prompt on your phone to approve {currency} {total.toFixed(2)} with your mobile money
          PIN. The seller is paid once you approve.
        </span>
      </div>
      {feeBearer === "buyer" && serviceCharge > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Product</span>
            <span>
              {currency} {amount.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Service charge</span>
            <span>
              {currency} {serviceCharge.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-medium">
            <span>Total you'll pay</span>
            <span>
              {currency} {total.toFixed(2)}
            </span>
          </div>
        </div>
      )}
      <Button onClick={start} disabled={starting} className="w-full h-12 text-base">
        {starting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
        {starting ? "Sending prompt..." : `Pay ${currency} ${total.toFixed(2)}`}
      </Button>
    </div>
  );
}
