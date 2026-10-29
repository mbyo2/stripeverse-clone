import { useCallback, useEffect, useRef, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { TablePageSkeleton } from "@/components/ui/skeletons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { Globe2, RefreshCw, Send, Wallet } from "lucide-react";

interface MovePayment {
  id: string;
  transaction_reference: string;
  rail: string;
  kind: string;
  amount: number;
  source_currency: string;
  destination_currency: string;
  destination_country: string;
  destination_type: string;
  recipient_name: string | null;
  proposal_id: string | null;
  provider_payment_id: string | null;
  status: string;
  env: string;
  created_at: string;
}

const CURRENCIES = ["ZMW", "USD", "EUR", "GBP", "ZAR", "KES", "NGN", "GHS"];

/**
 * Cross-Border Payouts (Mastercard — Sandbox).
 *
 * Admin / super_admin only — the route is role-guarded in
 * AnimatedRoutes and the `mastercard-move` edge function enforces
 * the same gate server-side. This panel drives Mastercard Move
 * (Send + Cross-Border Services) against the SANDBOX: quotes,
 * payments with an idempotency reference that is generated once per
 * payment intent and reused on every retry, status checks, and the
 * pre-funded account balances. The sandbox banner is always shown —
 * sandbox responses are simulated and never move real money.
 */
const AdminMastercardMove = () => {
  const { toast } = useToast();
  const [payments, setPayments] = useState<MovePayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [balances, setBalances] = useState<string | null>(null);
  const [lastQuote, setLastQuote] = useState<string | null>(null);

  const [amount, setAmount] = useState("25.00");
  const [sourceCurrency, setSourceCurrency] = useState("USD");
  const [destinationCurrency, setDestinationCurrency] = useState("ZMW");
  const [destinationCountry, setDestinationCountry] = useState("ZM");
  const [destinationType, setDestinationType] = useState("mobile_money");
  const [recipientName, setRecipientName] = useState("");
  const [recipientAccount, setRecipientAccount] = useState("");
  const [proposalId, setProposalId] = useState("");

  // One idempotency key per payment intent. It is minted when the
  // form is first used for a payment, REUSED if the admin retries
  // after a failure, and only rotated when they explicitly start a
  // new payment — so a retry can never create a second payment.
  const idempotencyKeyRef = useRef<string | null>(null);
  const [lastReference, setLastReference] = useState<string | null>(null);
  const idempotencyKey = () => {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID();
    }
    return idempotencyKeyRef.current;
  };

  const loadPayments = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("mastercard-move", {
      body: { action: "list_payments" },
    });
    if (error) {
      toast({
        title: "Could not load payments",
        description: await resolveEdgeFunctionError(error, "The payment list could not be loaded. Please try again."),
        variant: "destructive",
      });
      return;
    }
    setPayments((data?.payments as MovePayment[]) ?? []);
  }, [toast]);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadPayments();
      setIsLoading(false);
    })();
  }, [loadPayments]);

  const formBody = () => ({
    amount: Number(amount),
    source_currency: sourceCurrency,
    destination_currency: destinationCurrency,
    destination_country: destinationCountry,
    destination_type: destinationType,
    recipient_name: recipientName,
    recipient_account: recipientAccount,
    proposal_id: proposalId || undefined,
  });

  const runQuote = async () => {
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mastercard-move", {
        body: { action: "xbs_quote", ...formBody() },
      });
      if (error) throw error;
      const proposal = (data as { proposal_id?: string })?.proposal_id;
      if (proposal) {
        setProposalId(proposal);
        setLastQuote(`Quote created — proposal ${proposal}. It is saved in the list below.`);
      } else {
        setLastQuote("Quote created and saved in the list below.");
      }
      await loadPayments();
    } catch (error) {
      toast({
        title: "Quote failed",
        description: await resolveEdgeFunctionError(error, "The quote could not be created. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const runPayment = async () => {
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mastercard-move", {
        body: {
          action: "xbs_payment",
          ...formBody(),
          idempotency_key: idempotencyKey(),
          transaction_reference: lastReference ?? undefined,
        },
      });
      if (error) {
        // The function returns the reference on provider errors so a
        // retry continues the SAME payment instead of starting one.
        const message = await resolveEdgeFunctionError(error, "The payment could not be completed. Please try again.");
        toast({ title: "Payment not completed", description: message, variant: "destructive" });
        await loadPayments();
        return;
      }
      const payment = (data as { payment?: MovePayment })?.payment;
      if (payment) setLastReference(payment.transaction_reference);
      toast({
        title: (data as { idempotent_replay?: boolean })?.idempotent_replay
          ? "Already submitted"
          : "Payment submitted",
        description: (data as { idempotent_replay?: boolean })?.idempotent_replay
          ? "This payment was already submitted with the same reference — it has not been sent twice."
          : "The sandbox payment was submitted. Check its status in the list below.",
      });
      await loadPayments();
    } catch (error) {
      toast({
        title: "Payment failed",
        description: await resolveEdgeFunctionError(error, "The payment could not be completed. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const startNewPayment = () => {
    idempotencyKeyRef.current = crypto.randomUUID();
    setLastReference(null);
    setProposalId("");
    toast({ title: "New payment", description: "A new payment reference will be used for the next submission." });
  };

  const runStatus = async (payment: MovePayment) => {
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mastercard-move", {
        body: {
          action: payment.rail === "send" ? "send_status" : "xbs_status",
          transaction_reference: payment.transaction_reference,
          payment_id: payment.provider_payment_id ?? undefined,
        },
      });
      if (error) throw error;
      toast({ title: "Status updated", description: `Latest status: ${(data as { status?: string })?.status ?? payment.status}` });
      await loadPayments();
    } catch (error) {
      toast({
        title: "Status check failed",
        description: await resolveEdgeFunctionError(error, "The status could not be checked. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  const runBalances = async () => {
    setIsBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("mastercard-move", {
        body: { action: "xbs_balances" },
      });
      if (error) throw error;
      setBalances(JSON.stringify((data as { accounts?: unknown })?.accounts ?? {}, null, 2));
    } catch (error) {
      toast({
        title: "Balances failed",
        description: await resolveEdgeFunctionError(error, "The account balances could not be loaded. Please try again."),
        variant: "destructive",
      });
    } finally {
      setIsBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
          <TablePageSkeleton />
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-muted">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">
            Cross-Border Payouts (Mastercard — Sandbox)
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Mastercard Move — Send and Cross-Border Services. Administrators only.
          </p>
        </div>

        <Alert className="mb-6 border-amber-500/60 bg-amber-500/10">
          <Globe2 className="h-4 w-4" />
          <AlertTitle>Sandbox — no real money moves</AlertTitle>
          <AlertDescription>
            This panel talks to the Mastercard sandbox. Responses are simulated by
            Mastercard, quotes and payments here never settle real funds, and every
            record below is labelled with the environment it was created in.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>New cross-border payout</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="mc-amount">Amount</Label>
                  <Input id="mc-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>From currency</Label>
                  <Select value={sourceCurrency} onValueChange={setSourceCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>To currency</Label>
                  <Select value={destinationCurrency} onValueChange={setDestinationCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mc-country">Destination country (ISO)</Label>
                  <Input id="mc-country" value={destinationCountry} onChange={(e) => setDestinationCountry(e.target.value.toUpperCase().slice(0, 2))} />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Destination type</Label>
                  <Select value={destinationType} onValueChange={setDestinationType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bank">Bank account</SelectItem>
                      <SelectItem value="mobile_money">Mobile money</SelectItem>
                      <SelectItem value="card">Card</SelectItem>
                      <SelectItem value="cash_pickup">Cash pick-up</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mc-recipient-name">Recipient name</Label>
                  <Input id="mc-recipient-name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mc-recipient-account">Recipient account / mobile number</Label>
                  <Input id="mc-recipient-account" value={recipientAccount} onChange={(e) => setRecipientAccount(e.target.value)} />
                </div>
              </div>

              {proposalId && (
                <p className="text-sm text-muted-foreground">
                  Paying against quote proposal <span className="font-mono">{proposalId}</span>
                </p>
              )}
              {lastQuote && <p className="text-sm text-muted-foreground">{lastQuote}</p>}
              {lastReference && (
                <p className="text-sm text-muted-foreground">
                  Current payment reference <span className="font-mono">{lastReference}</span> — retries reuse it.
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <Button variant="outline" onClick={runQuote} disabled={isBusy}>
                  <Wallet className="h-4 w-4 mr-2" /> Get quote
                </Button>
                <Button onClick={runPayment} disabled={isBusy}>
                  <Send className="h-4 w-4 mr-2" /> Create payment
                </Button>
                <Button variant="ghost" onClick={startNewPayment} disabled={isBusy}>
                  Start a new payment
                </Button>
                <Button variant="outline" onClick={runBalances} disabled={isBusy}>
                  Check balances
                </Button>
              </div>

              {balances && (
                <pre className="text-xs bg-background border rounded-md p-3 overflow-x-auto">{balances}</pre>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How this works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>1. Get a quote — Mastercard prices the corridor and returns a proposal.</p>
              <p>2. Create the payment — the payment is saved first with its unique reference, then submitted once. Retrying reuses the same reference.</p>
              <p>3. Check status from the list — the saved record is updated from Mastercard each time.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Payments &amp; quotes</CardTitle>
            <Button variant="outline" size="sm" onClick={loadPayments} disabled={isBusy}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Mastercard Move payments or quotes yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Rail / kind</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Env</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.transaction_reference}</TableCell>
                      <TableCell>{p.rail} · {p.kind}</TableCell>
                      <TableCell>{p.source_currency} {Number(p.amount).toFixed(2)} → {p.destination_currency}</TableCell>
                      <TableCell>{p.destination_country} · {p.destination_type}{p.recipient_name ? ` · ${p.recipient_name}` : ""}</TableCell>
                      <TableCell><Badge variant="secondary">{p.status}</Badge></TableCell>
                      <TableCell><Badge variant="outline">{p.env}</Badge></TableCell>
                      <TableCell>
                        {p.kind === "payment" && (
                          <Button variant="ghost" size="sm" onClick={() => runStatus(p)} disabled={isBusy}>
                            Check status
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default AdminMastercardMove;
