import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import { useInvalidateMoneyState } from "@/utils/moneyFreshness";
import { resolveEdgeFunctionError } from "@/utils/edgeFunctionError";
import { interpretOnchainSendResponse } from "@/utils/btcSend";
import { useMultiCurrencyWallets } from "@/hooks/useMultiCurrency";
import { formatBitcoinAmount, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import QRCode from "qrcode.react";
import { Copy, QrCode, Zap, Loader2, Send, ArrowLeftRight, KeyRound, ArrowUpRight, ArrowDownLeft, Bitcoin, CreditCard } from "lucide-react";
import { useMoonpay } from "@/hooks/useMoonpay";
import { MOONPAY_COMING_SOON_COPY } from "@/config/moonpay";

const satsToBtc = (sats?: number) => (sats ? sats / 100_000_000 : 0);

function OnchainDeposit({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const getAddress = async () => {
    setLoading(true);
    try {
      // Uses the existing btc-onchain function (receive action) —
      // derives from BTC_XPUB via the live watch-only setup.
      const { data, error } = await supabase.functions.invoke("btc-onchain", {
        body: { action: "receive" },
      });
      if (error) throw error;
      setAddress(data.address);
    } catch (e: any) {
      toast({ title: "Failed to generate address", description: await resolveEdgeFunctionError(e, "Could not generate a deposit address. Please try again."), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      toast({ title: "Address copied" });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Send BTC to your unique deposit address. Funds appear after 2 confirmations
        for deposits under 500,000 sats, and 3 confirmations for larger deposits
        (usually about 20–30 minutes).
      </p>
      {!address ? (
        <Button onClick={getAddress} disabled={loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
          Generate deposit address
        </Button>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="rounded bg-white p-3">
              <QRCode value={`bitcoin:${address}`} size={180} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">{address}</div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy} className="flex-1">
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button variant="outline" onClick={getAddress} disabled={loading} className="flex-1">
              New address
            </Button>
          </div>
          <Button onClick={onDone} className="w-full">Done</Button>
        </div>
      )}
    </div>
  );
}

const LIGHTNING_UNAVAILABLE_MESSAGE =
  "Lightning deposits are not available yet — please use an on-chain Bitcoin deposit for now.";

function LightningDeposit({ onDone, onUseOnchain }: { onDone: () => void; onUseOnchain: () => void }) {
  const { toast } = useToast();
  const [sats, setSats] = useState(10000);
  const [invoice, setInvoice] = useState<{ bolt11: string; payment_id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  // Set when the backend answers with its designed not-configured /
  // unavailable 503: the panel then renders the honest unavailable
  // state (no error box) and routes to the on-chain tab instead.
  const [unavailable, setUnavailable] = useState(false);
  // Persistent in-dialog error: a transient toast alone left users
  // staring at an unchanged form with no explanation when invoice
  // creation failed (live QA, 2026-10-22 — the failure was invisible).
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const invoiceRef = useRef<{ bolt11: string; payment_id: string } | null>(null);
  invoiceRef.current = invoice;

  const create = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("breez-lightning", {
        body: { action: "create_invoice", amount_sats: sats },
      });
      if (error) throw error;
      // A 2xx with an incomplete payload is still a failure — never
      // treat it as a created invoice.
      if (!data?.bolt11 || !data?.payment_id) {
        throw new Error(LIGHTNING_UNAVAILABLE_MESSAGE);
      }
      setInvoice(data);
    } catch (e: any) {
      const msg = await resolveEdgeFunctionError(e, "Could not create a Lightning invoice. Please try again.");
      // The designed 503 copy (not configured / provider unavailable)
      // is a deployment state, not a user error: show the honest
      // unavailable panel rather than an error box.
      if (msg.includes("Lightning deposits are not available yet")) {
        setUnavailable(true);
        return;
      }
      setErrorMsg(msg);
      toast({ title: "Failed to create invoice", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // One status check against the open invoice. Returns the status so
  // the auto-poller can stop itself; manual checks toast the outcome.
  const checkPaid = async (manual: boolean): Promise<string | null> => {
    const inv = invoiceRef.current;
    if (!inv) return null;
    if (manual) setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("breez-lightning", {
        body: { action: "check_status", breez_invoice_id: inv.payment_id },
      });
      if (error) throw error;
      if (data.status === "paid") {
        toast({ title: "Payment received!" });
        onDone();
        return "paid";
      }
      if (data.status === "expired") {
        setInvoice(null);
        setErrorMsg("That Lightning invoice expired before it was paid — create a new one to try again.");
        return "expired";
      }
      if (manual) {
        toast({ title: "Still pending", description: "The invoice hasn't been paid yet." });
      }
      return "pending";
    } catch (e: any) {
      if (manual) {
        toast({ title: "Check failed", description: await resolveEdgeFunctionError(e, "Could not check the payment status. Please try again."), variant: "destructive" });
      }
      return null;
    } finally {
      if (manual) setChecking(false);
    }
  };

  // Auto-poll every 5s while an unpaid invoice is open in the dialog;
  // stops on paid/expired and cleans up on unmount / tab switch (the
  // tab content unmounts) / invoice reset.
  useEffect(() => {
    if (!invoice) return;
    let stopped = false;
    const id = setInterval(async () => {
      const status = await checkPaid(false);
      if (stopped || status === "paid" || status === "expired") {
        clearInterval(id);
      }
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice]);

  const copy = () => {
    if (invoice) {
      navigator.clipboard.writeText(invoice.bolt11);
      toast({ title: "Invoice copied" });
    }
  };

  if (unavailable) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <p className="text-sm flex items-start gap-2">
            <Zap className="h-4 w-4 mt-0.5 shrink-0" />
            {LIGHTNING_UNAVAILABLE_MESSAGE}
          </p>
        </div>
        <Button onClick={onUseOnchain} className="w-full">
          Use on-chain deposit
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Instant Lightning deposits — no waiting for confirmations.
      </p>
      {!invoice ? (
        <>
          {errorMsg && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {errorMsg}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="sats">Amount (sats)</Label>
            <Input id="sats" type="number" min={1} value={sats} onChange={(e) => setSats(Number(e.target.value))} />
          </div>
          <Button onClick={create} disabled={loading} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
            Create Lightning invoice
          </Button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-center">
            <div className="rounded bg-white p-3">
              <QRCode value={invoice.bolt11} size={180} />
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all max-h-32 overflow-y-auto">
            {invoice.bolt11}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy} className="flex-1">
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button onClick={() => void checkPaid(true)} disabled={checking} className="flex-1">
              {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              I've paid
            </Button>
          </div>
          <p className="text-xs text-muted-foreground text-center">
            Checking for your payment automatically every few seconds…
          </p>
        </div>
      )}
    </div>
  );
}

function SendOnchain({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const invalidateMoney = useInvalidateMoneyState();
  const [address, setAddress] = useState("");
  const [sats, setSats] = useState("");
  const [sending, setSending] = useState(false);
  // One idempotency key per send intent: a retried click can never
  // broadcast twice. Reset only after a completed send.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<
    | { kind: "broadcast"; txid: string; fee_sats: number }
    | { kind: "verifying"; txid: string | null; message: string }
    | null
  >(null);

  const send = async () => {
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("btc-onchain", {
        body: {
          action: "send",
          to_address: address.trim(),
          amount_sats: Number(sats),
          idempotency_key: idemKey,
        },
      });
      if (error) throw error;
      // A 2xx is not always a broadcast: btc-onchain answers 202 with
      // status "verifying" (and no fee_sats) when the broadcast outcome
      // is ambiguous — the withdrawal stays reserved server-side and
      // must NOT be retried. Route every response through the
      // interpreter rather than assuming success fields exist.
      const outcome = interpretOnchainSendResponse(data);
      if (outcome.kind === "verifying") {
        setResult({ kind: "verifying", txid: outcome.txid, message: outcome.message });
        toast({ title: "Withdrawal being verified", description: outcome.message });
        // Funds are now held in the reserved row: refresh shared money
        // state so balances reflect the hold. The idempotency key is
        // deliberately NOT rotated — this send must not be repeated.
        invalidateMoney();
        onDone();
        return;
      }
      if (outcome.kind !== "broadcast") {
        toast({
          title: "Withdrawal status unclear",
          description: "We couldn't confirm the result of this withdrawal. Please check your recent activity before trying again.",
          variant: "destructive",
        });
        return;
      }
      setResult({ kind: "broadcast", txid: outcome.txid, fee_sats: outcome.feeSats });
      toast({ title: "Withdrawal broadcast", description: `Fee: ${outcome.feeSats.toLocaleString()} sats` });
      setIdemKey(crypto.randomUUID());
      // The withdrawal wrote ledger rows: refresh shared money state
      // so the Wallet page / Dashboard activity reflects it.
      invalidateMoney();
      onDone();
    } catch (e: any) {
      toast({ title: "Withdrawal failed", description: await resolveEdgeFunctionError(e, "The withdrawal could not be completed."), variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (result) {
    if (result.kind === "verifying") {
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Your withdrawal is being verified</p>
          <p className="text-sm text-muted-foreground">{result.message}</p>
          {result.txid && (
            <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">{result.txid}</div>
          )}
          <p className="text-sm text-muted-foreground">
            Your Bitcoin is held safely while this is checked — please do not send it again.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <p className="text-sm">Your withdrawal is on its way. Transaction ID:</p>
        <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all">{result.txid}</div>
        <p className="text-sm text-muted-foreground">Network fee paid: {result.fee_sats.toLocaleString()} sats</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="dest">Destination address (mainnet)</Label>
        <Input id="dest" placeholder="bc1…" value={address} onChange={(e) => setAddress(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="sendSats">Amount (sats)</Label>
        <Input id="sendSats" type="number" min={1} value={sats} onChange={(e) => setSats(e.target.value)} />
      </div>
      <p className="text-xs text-muted-foreground">
        A network fee is added on top, calculated from live network rates when you send.
        Minimum withdrawal 10,000 sats.
      </p>
      <Button onClick={send} disabled={sending || !address || !sats} className="w-full">
        {sending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
        Send Bitcoin
      </Button>
    </div>
  );
}

type TradeQuote = {
  quote_id: string;
  side: "buy" | "sell";
  mid_rate_zmw: number;
  fee_bps: number;
  fee_zmw: number;
  amount_zmw: number;
  amount_sats: number;
  expires_at: string;
};

function TradePanel({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const invalidateMoney = useInvalidateMoneyState();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [zmwInput, setZmwInput] = useState("");
  const [satsInput, setSatsInput] = useState("");
  const [quote, setQuote] = useState<TradeQuote | null>(null);
  const [idemKey, setIdemKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const { data: fiatWallets, refetch: refetchFiat } = useMultiCurrencyWallets();
  const zmwBalance = Number(fiatWallets?.find((w: any) => w.currency === "ZMW")?.balance ?? 0);

  useEffect(() => {
    if (!quote) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((new Date(quote.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [quote]);

  const switchSide = (v: string) => {
    setSide(v as "buy" | "sell");
    setQuote(null);
    setIdemKey(null);
  };

  const getQuote = async () => {
    setLoading(true);
    try {
      const body = side === "buy"
        ? { action: "quote", side, amount_zmw: Number(zmwInput) }
        : { action: "quote", side, amount_sats: Number(satsInput) };
      const { data, error } = await supabase.functions.invoke("btc-trade", { body });
      if (error) throw error;
      setQuote(data as TradeQuote);
      setIdemKey(crypto.randomUUID());
    } catch (e: any) {
      toast({ title: "Could not get a quote", description: await resolveEdgeFunctionError(e, "Could not get a quote right now. Please try again."), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const execute = async () => {
    if (!quote || !idemKey) return;
    setExecuting(true);
    try {
      const { error } = await supabase.functions.invoke("btc-trade", {
        body: { action: "execute", quote_id: quote.quote_id, idempotency_key: idemKey },
      });
      if (error) throw error;
      toast({
        title: side === "buy" ? "Bitcoin bought" : "Bitcoin sold",
        description: side === "buy"
          ? `${quote.amount_sats.toLocaleString()} sats added to your wallet`
          : `${formatCurrency(quote.amount_zmw)} credited to your ZMW wallet`,
      });
      setQuote(null);
      setIdemKey(null);
      setZmwInput("");
      setSatsInput("");
      // A trade moves the ZMW wallet too: refresh shared money state
      // (not just this panel's wallet list) for the Wallet page and
      // Dashboard.
      invalidateMoney();
      await refetchFiat();
      onDone();
    } catch (e: any) {
      toast({ title: "Trade failed", description: await resolveEdgeFunctionError(e, "The trade could not be completed."), variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ArrowLeftRight className="h-5 w-5" /> Buy & Sell Bitcoin
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={side} onValueChange={switchSide} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="buy">Buy</TabsTrigger>
            <TabsTrigger value="sell">Sell</TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="pt-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="buyZmw">You pay (ZMW) — balance {formatCurrency(zmwBalance)}</Label>
              <Input id="buyZmw" type="number" min={10} placeholder="e.g. 500" value={zmwInput} onChange={(e) => { setZmwInput(e.target.value); setQuote(null); }} />
            </div>
          </TabsContent>
          <TabsContent value="sell" className="pt-4 space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="sellSats">You sell (sats)</Label>
              <Input id="sellSats" type="number" min={1000} placeholder="e.g. 50000" value={satsInput} onChange={(e) => { setSatsInput(e.target.value); setQuote(null); }} />
            </div>
          </TabsContent>
        </Tabs>

        {!quote ? (
          <Button onClick={getQuote} disabled={loading || (side === "buy" ? !zmwInput : !satsInput)} className="w-full mt-4">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Get quote
          </Button>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg bg-muted p-4 space-y-1 text-sm">
              {side === "buy" ? (
                <>
                  <p>You pay: <strong>{formatCurrency(quote.amount_zmw)}</strong></p>
                  <p>You receive: <strong>{quote.amount_sats.toLocaleString()} sats</strong> ({formatBitcoinAmount(quote.amount_sats / 100_000_000)})</p>
                </>
              ) : (
                <>
                  <p>You sell: <strong>{quote.amount_sats.toLocaleString()} sats</strong></p>
                  <p>You receive: <strong>{formatCurrency(quote.amount_zmw)}</strong></p>
                </>
              )}
              <p className="text-muted-foreground">Rate: {formatCurrency(quote.mid_rate_zmw)} per BTC · Fee: {formatCurrency(quote.fee_zmw)} ({(quote.fee_bps / 100).toFixed(2)}%)</p>
              <p className={secondsLeft === 0 ? "text-destructive" : "text-muted-foreground"}>
                {secondsLeft > 0 ? `Quote locked for ${secondsLeft}s` : "Quote expired — get a new quote"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { setQuote(null); setIdemKey(null); }}>Cancel</Button>
              <Button className="flex-1" disabled={executing || secondsLeft === 0} onClick={execute}>
                {executing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm {side === "buy" ? "buy" : "sell"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Card (MoonPay) buy entry — sits beside the Buy & Sell panel in
 * the Bitcoin buy area.
 *
 * Truthful gate, mirroring the Stripe card gate in Wallet: while
 * platform_settings.moonpay_enabled is off, the entry is disabled
 * as "Coming soon" with plain copy and the purchase flow is
 * unreachable; while it is on, "Buy with card" starts a purchase
 * through useMoonpay (which itself surfaces MoonPay's
 * not-configured answer truthfully if the keys are not in yet).
 * Purchases are in USD — MoonPay does not support ZMW — and the
 * Bitcoin is delivered straight to the user's wallet.
 */
function MoonpayBuyCard() {
  const { enabled, loading, startMoonpayBuy, isStartingMoonpayBuy } = useMoonpay();
  const [usdInput, setUsdInput] = useState("");

  const buy = async () => {
    const amount = Number(usdInput);
    await startMoonpayBuy({
      fiatCurrency: "USD",
      fiatAmount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CreditCard className="h-5 w-5" /> Card (MoonPay)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled ? (
          <>
            <p className="text-sm text-muted-foreground">{MOONPAY_COMING_SOON_COPY}</p>
            <Button disabled className="w-full">
              Card (MoonPay) — Coming soon
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Buy Bitcoin with a debit or credit card, delivered straight to your
              wallet. Purchases are in US dollars and completed on MoonPay.
            </p>
            <div className="grid gap-2">
              <Label htmlFor="moonpayUsd">You pay (USD, optional — MoonPay confirms the final amount)</Label>
              <Input
                id="moonpayUsd"
                type="number"
                min={1}
                placeholder="e.g. 50"
                value={usdInput}
                onChange={(e) => setUsdInput(e.target.value)}
              />
            </div>
            <Button onClick={buy} disabled={loading || isStartingMoonpayBuy} className="w-full">
              {isStartingMoonpayBuy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CreditCard className="h-4 w-4 mr-2" />}
              Buy with card
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function BitcoinWallet() {
  const navigate = useNavigate();
  const { wallet, isLoading, refetchWallet, transactions, isTxLoading, refetchTx } = useBitcoinWallet();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  // Controlled so the Lightning panel can route the user onto the
  // On-chain tab (custodial Lightning deposits are unavailable).
  const [depositTab, setDepositTab] = useState("onchain");

  useEffect(() => {
    document.title = "Bitcoin Wallet | BTC balance & deposits";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'Manage your Bitcoin wallet: view BTC balance, deposit on-chain or via Lightning, and track recent BTC transactions.');
  }, []);

  const handleDone = async () => {
    await Promise.all([refetchWallet(), refetchTx()]);
    setOpen(false);
  };

  const btcBalance = useMemo(() => formatBitcoinAmount(satsToBtc(wallet?.balance_sats || 0)), [wallet]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <section className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 py-8 md:py-10">
          <h1 className="text-[28px] leading-tight font-display font-semibold mb-6">Bitcoin Wallet</h1>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                Balance
                <Badge variant="outline" className="border-[#003087] text-[#003087] dark:text-[#A9BCDA] dark:border-[#A9BCDA]">CUSTODIAL ACCOUNT</Badge>
              </CardTitle>
              <CardDescription>
                BMaGlass holds the keys for this account — access is recovered by signing in,
                and you can buy/sell against your ZMW balance. Your self-custody wallet (below)
                is separate: there, you hold the keys.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div>
                {isLoading ? (
                  <div className="h-10 w-40 animate-pulse bg-muted rounded" />
                ) : (
                  <p className="text-[40px] md:text-[44px] leading-none font-display font-semibold">{btcBalance}</p>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  Asset: BTC · {(wallet?.balance_sats ?? 0).toLocaleString()} sats
                  {wallet && wallet.available_sats !== wallet.balance_sats
                    ? ` · ${wallet.available_sats.toLocaleString()} available`
                    : ""}
                </p>
              </div>

              <div className="flex flex-wrap gap-3 mt-6">
              <Dialog
                open={open}
                onOpenChange={(next) => {
                  setOpen(next);
                  // Reopening Deposit always lands on the working
                  // On-chain tab, as it did when Tabs was uncontrolled.
                  if (!next) setDepositTab("onchain");
                }}
              >
                <DialogTrigger asChild>
                  <Button size="lg">Deposit BTC</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deposit Bitcoin</DialogTitle>
                  </DialogHeader>

                  <Tabs value={depositTab} onValueChange={setDepositTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="onchain">On-chain</TabsTrigger>
                      <TabsTrigger value="lightning">Lightning</TabsTrigger>
                    </TabsList>
                    <TabsContent value="onchain" className="pt-4">
                      <OnchainDeposit onDone={handleDone} />
                    </TabsContent>
                    <TabsContent value="lightning" className="pt-4">
                      <LightningDeposit onDone={handleDone} onUseOnchain={() => setDepositTab("onchain")} />
                    </TabsContent>
                  </Tabs>
                </DialogContent>
              </Dialog>

              <Dialog open={sendOpen} onOpenChange={setSendOpen}>
                <DialogTrigger asChild>
                  <Button size="lg" variant="outline">Send BTC</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send Bitcoin (on-chain)</DialogTitle>
                  </DialogHeader>
                  <SendOnchain onDone={handleDone} />
                </DialogContent>
              </Dialog>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
          <TradePanel onDone={handleDone} />

          <MoonpayBuyCard />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent BTC activity</CardTitle>
            </CardHeader>
            <CardContent>
              {isTxLoading ? (
                <div className="h-24 animate-pulse bg-muted rounded" />
              ) : transactions.length === 0 ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <Bitcoin className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground">No Bitcoin transactions yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {transactions.map((t: any) => {
                    const outgoing = t.direction === "outgoing" || (!t.direction && Number(t.amount || 0) < 0);
                    const label = t.description
                      || (t.metadata?.type === "lightning_deposit" ? "Lightning deposit"
                        : t.metadata?.type === "lightning_payment" ? "Lightning payment"
                        : t.metadata?.type === "withdrawal" ? "Bitcoin withdrawal"
                        : "BTC transaction");
                    return (
                      <li key={t.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            {outgoing ? (
                              <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ArrowDownLeft className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-[15px]">{label}</p>
                            <p className="text-[13px] text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{outgoing ? "−" : "+"}{formatBitcoinAmount(Math.abs(Number(t.amount || 0)))}</p>
                          <p className="text-[13px] text-muted-foreground">{t.status}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
            </div>

          <Card className="border-amber-500/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-5 w-5" /> Your self-custody wallet
                <Badge variant="outline" className="border-amber-500 text-amber-600">SELF-CUSTODY</Badge>
              </CardTitle>
              <CardDescription>
                Prefer to hold your own keys? A self-custody wallet lives only on your device,
                protected by a seed phrase that only you have. BMaGlass cannot recover it —
                losing the phrase means losing the funds. You can hold both wallets and move
                Bitcoin between them with an ordinary send.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => navigate("/bitcoin-wallet/self-custody")}>
                Open self-custody wallet
              </Button>
            </CardContent>
          </Card>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
