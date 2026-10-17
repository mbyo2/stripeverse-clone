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
import { formatBitcoinAmount } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Copy, QrCode, Zap, Loader2 } from "lucide-react";

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

export default function BitcoinWallet() {
  const { wallet, isLoading, refetchWallet, transactions, isTxLoading, refetchTx } = useBitcoinWallet();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

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
                <p className="text-sm text-muted-foreground mt-1">Asset: BTC</p>
              </div>

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
            </CardContent>
          </Card>

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
                  {transactions.map((t: any) => (
                    <li key={t.id} className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">BTC deposit</p>
                        <p className="text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{formatBitcoinAmount(Number(t.amount || 0))}</p>
                        <p className="text-xs text-muted-foreground">{t.status}</p>
                      </div>
                    </li>
                  ))}
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
