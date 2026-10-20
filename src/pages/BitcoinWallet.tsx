import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import { useMultiCurrencyWallets } from "@/hooks/useMultiCurrency";
import { formatBitcoinAmount, formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Copy, QrCode, Zap, Loader2, Send, ArrowLeftRight } from "lucide-react";

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
      toast({ title: "Failed to generate address", description: e.message, variant: "destructive" });
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
        Send BTC to your unique deposit address. Funds appear after 1 confirmation (~10 min).
      </p>
      {!address ? (
        <Button onClick={getAddress} disabled={loading} className="w-full">
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <QrCode className="h-4 w-4 mr-2" />}
          Generate deposit address
        </Button>
      ) : (
        <div className="space-y-3">
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

function LightningDeposit({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [sats, setSats] = useState(10000);
  const [invoice, setInvoice] = useState<{ bolt11: string; payment_id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  const create = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("breez-lightning", {
        body: { action: "create_invoice", amount_sats: sats },
      });
      if (error) throw error;
      setInvoice(data);
    } catch (e: any) {
      toast({ title: "Failed to create invoice", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const checkPaid = async () => {
    if (!invoice) return;
    setChecking(true);
    try {
      const { data, error } = await supabase.functions.invoke("breez-lightning", {
        body: { action: "check_status", breez_invoice_id: invoice.payment_id },
      });
      if (error) throw error;
      if (data.status === "paid") {
        toast({ title: "Payment received!" });
        onDone();
      } else {
        toast({ title: "Still pending", description: "The invoice hasn't been paid yet." });
      }
    } catch (e: any) {
      toast({ title: "Check failed", description: e.message, variant: "destructive" });
    } finally {
      setChecking(false);
    }
  };

  const copy = () => {
    if (invoice) {
      navigator.clipboard.writeText(invoice.bolt11);
      toast({ title: "Invoice copied" });
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Instant Lightning deposits — no waiting for confirmations.
      </p>
      {!invoice ? (
        <>
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
          <div className="p-3 rounded-lg bg-muted font-mono text-xs break-all max-h-32 overflow-y-auto">
            {invoice.bolt11}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={copy} className="flex-1">
              <Copy className="h-4 w-4 mr-2" /> Copy
            </Button>
            <Button onClick={checkPaid} disabled={checking} className="flex-1">
              {checking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              I've paid
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SendOnchain({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [address, setAddress] = useState("");
  const [sats, setSats] = useState("");
  const [sending, setSending] = useState(false);
  // One idempotency key per send intent: a retried click can never
  // broadcast twice. Reset only after a completed send.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ txid: string; fee_sats: number } | null>(null);

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
      setResult({ txid: data.txid, fee_sats: data.fee_sats });
      toast({ title: "Withdrawal broadcast", description: `Fee: ${Number(data.fee_sats).toLocaleString()} sats` });
      setIdemKey(crypto.randomUUID());
      onDone();
    } catch (e: any) {
      toast({ title: "Withdrawal failed", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  if (result) {
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
      toast({ title: "Could not get a quote", description: e.message, variant: "destructive" });
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
      await refetchFiat();
      onDone();
    } catch (e: any) {
      toast({ title: "Trade failed", description: e.message, variant: "destructive" });
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
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

export default function BitcoinWallet() {
  const { wallet, isLoading, refetchWallet, transactions, isTxLoading, refetchTx } = useBitcoinWallet();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

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
        <section className="container mx-auto px-4 py-8">
          <h1 className="text-2xl font-semibold mb-4">Bitcoin Wallet</h1>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div>
                {isLoading ? (
                  <div className="h-6 w-32 animate-pulse bg-muted rounded" />
                ) : (
                  <p className="text-xl font-bold">{btcBalance}</p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  Asset: BTC · {(wallet?.balance_sats ?? 0).toLocaleString()} sats
                  {wallet && wallet.available_sats !== wallet.balance_sats
                    ? ` · ${wallet.available_sats.toLocaleString()} available`
                    : ""}
                </p>
              </div>

              <div className="flex gap-2">
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="lg">Deposit BTC</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Deposit Bitcoin</DialogTitle>
                  </DialogHeader>

                  <Tabs defaultValue="onchain" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="onchain">On-chain</TabsTrigger>
                      <TabsTrigger value="lightning">Lightning</TabsTrigger>
                    </TabsList>
                    <TabsContent value="onchain" className="pt-4">
                      <OnchainDeposit onDone={handleDone} />
                    </TabsContent>
                    <TabsContent value="lightning" className="pt-4">
                      <LightningDeposit onDone={handleDone} />
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

          <TradePanel onDone={handleDone} />

          <Card>
            <CardHeader>
              <CardTitle>Recent BTC activity</CardTitle>
            </CardHeader>
            <CardContent>
              {isTxLoading ? (
                <div className="h-24 animate-pulse bg-muted rounded" />
              ) : transactions.length === 0 ? (
                <p className="text-muted-foreground">No Bitcoin transactions yet.</p>
              ) : (
                <ul className="space-y-3">
                  {transactions.map((t: any) => {
                    const outgoing = t.direction === "outgoing" || (!t.direction && Number(t.amount || 0) < 0);
                    const label = t.description
                      || (t.metadata?.type === "lightning_deposit" ? "Lightning deposit"
                        : t.metadata?.type === "lightning_payment" ? "Lightning payment"
                        : t.metadata?.type === "withdrawal" ? "Bitcoin withdrawal"
                        : "BTC transaction");
                    return (
                      <li key={t.id} className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{outgoing ? "−" : "+"}{formatBitcoinAmount(Math.abs(Number(t.amount || 0)))}</p>
                          <p className="text-xs text-muted-foreground">{t.status}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
      <Footer />
    </div>
  );
}
