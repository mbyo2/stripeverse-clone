import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useBitcoinWallet } from "@/hooks/useBitcoinWallet";
import BitcoinPayment from "@/components/payments/BitcoinPayment";
import { formatBitcoinAmount } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const satsToBtc = (sats?: number) => (sats ? sats / 100_000_000 : 0);

export default function BitcoinWallet() {
  const { wallet, isLoading, refetchWallet, transactions, isTxLoading, refetchTx } = useBitcoinWallet();
  const { toast } = useToast();
  const [amountUsd, setAmountUsd] = useState<number>(50);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = "Bitcoin Wallet | BTC balance & deposits";
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', 'Manage your Bitcoin wallet: view BTC balance, deposit via BTCPay, and track recent BTC transactions.');
  }, []);

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
                    <DialogTitle>Deposit via BTCPay</DialogTitle>
                  </DialogHeader>

                  <div className="space-y-4">
                    <div className="grid gap-2">
                      <Label htmlFor="amount-usd">Amount (USD)</Label>
                      <Input
                        id="amount-usd"
                        type="number"
                        min={1}
                        step={1}
                        value={amountUsd}
                        onChange={(e) => setAmountUsd(Number(e.target.value))}
                      />
                    </div>

                    <BitcoinPayment
                      amount={amountUsd}
                      onSuccess={async () => {
                        toast({ title: "Deposit credited", description: "Your BTC deposit has been credited." });
                        await Promise.all([refetchWallet(), refetchTx()]);
                        setOpen(false);
                      }}
                      onCancel={() => setOpen(false)}
                    />
                  </div>
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
