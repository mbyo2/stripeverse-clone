import React, { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Wallet, Plus, ArrowLeftRight, TrendingUp, Globe } from 'lucide-react';
import { useMultiCurrencyWallets, useCreateWallet, useConvertCurrency, useConversionHistory } from '@/hooks/useMultiCurrency';
import { format } from 'date-fns';

const CURRENCIES = [
  { code: 'ZMW', name: 'Zambian Kwacha', flag: '🇿🇲' },
  { code: 'USD', name: 'US Dollar', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', flag: '🇬🇧' },
  { code: 'ZAR', name: 'South African Rand', flag: '🇿🇦' },
  { code: 'NGN', name: 'Nigerian Naira', flag: '🇳🇬' },
  { code: 'KES', name: 'Kenyan Shilling', flag: '🇰🇪' },
  { code: 'TZS', name: 'Tanzanian Shilling', flag: '🇹🇿' },
  { code: 'BWP', name: 'Botswana Pula', flag: '🇧🇼' },
];

// Mock rates (in production, these come from exchange_rates table)
const MOCK_RATES: Record<string, number> = {
  'ZMW-USD': 0.037, 'USD-ZMW': 27.0, 'ZMW-EUR': 0.034, 'EUR-ZMW': 29.5,
  'ZMW-GBP': 0.029, 'GBP-ZMW': 34.2, 'USD-EUR': 0.92, 'EUR-USD': 1.09,
  'ZMW-ZAR': 0.67, 'ZAR-ZMW': 1.49, 'ZMW-NGN': 57.3, 'NGN-ZMW': 0.017,
};

const MultiCurrencyWallet = () => {
  const { data: wallets, isLoading } = useMultiCurrencyWallets();
  const createWallet = useCreateWallet();
  const convertCurrency = useConvertCurrency();
  const { data: conversions } = useConversionHistory();
  const [addOpen, setAddOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [newCurrency, setNewCurrency] = useState('');
  const [convertForm, setConvertForm] = useState({ from_wallet: '', to_wallet: '', amount: '' });

  const existingCurrencies = wallets?.map(w => w.currency) || [];
  const availableCurrencies = CURRENCIES.filter(c => !existingCurrencies.includes(c.code));

  const getRate = (from: string, to: string) => MOCK_RATES[`${from}-${to}`] || 1;

  const fromWallet = wallets?.find(w => w.id === convertForm.from_wallet);
  const toWallet = wallets?.find(w => w.id === convertForm.to_wallet);
  const rate = fromWallet && toWallet ? getRate(fromWallet.currency, toWallet.currency) : 0;
  const convertedAmount = Number(convertForm.amount) * rate;

  const handleConvert = () => {
    if (!fromWallet || !toWallet) return;
    convertCurrency.mutate({
      from_currency: fromWallet.currency, to_currency: toWallet.currency,
      from_amount: Number(convertForm.amount), exchange_rate: rate,
      from_wallet_id: fromWallet.id, to_wallet_id: toWallet.id,
    }, { onSuccess: () => { setConvertOpen(false); setConvertForm({ from_wallet: '', to_wallet: '', amount: '' }); } });
  };

  const getCurrencyInfo = (code: string) => CURRENCIES.find(c => c.code === code);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Multi-Currency Wallets</h1>
            <p className="text-muted-foreground">Hold and manage balances in multiple currencies</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
              <DialogTrigger asChild><Button variant="outline"><ArrowLeftRight className="h-4 w-4 mr-2" />Convert</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Convert Currency</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>From Wallet</Label>
                    <Select value={convertForm.from_wallet} onValueChange={v => setConvertForm(p => ({ ...p, from_wallet: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
                      <SelectContent>
                        {wallets?.filter(w => w.id !== convertForm.to_wallet).map(w => (
                          <SelectItem key={w.id} value={w.id}>{getCurrencyInfo(w.currency)?.flag} {w.currency} — K{Number(w.balance).toLocaleString()}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Amount</Label><Input type="number" value={convertForm.amount} onChange={e => setConvertForm(p => ({ ...p, amount: e.target.value }))} /></div>
                  <div>
                    <Label>To Wallet</Label>
                    <Select value={convertForm.to_wallet} onValueChange={v => setConvertForm(p => ({ ...p, to_wallet: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
                      <SelectContent>
                        {wallets?.filter(w => w.id !== convertForm.from_wallet).map(w => (
                          <SelectItem key={w.id} value={w.id}>{getCurrencyInfo(w.currency)?.flag} {w.currency}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {fromWallet && toWallet && convertForm.amount && (
                    <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Exchange Rate</span><span>1 {fromWallet.currency} = {rate.toFixed(4)} {toWallet.currency}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-muted-foreground">Fee (1.5%)</span><span>{(Number(convertForm.amount) * 0.015).toFixed(2)} {fromWallet.currency}</span></div>
                      <div className="flex justify-between font-semibold"><span>You receive</span><span>{convertedAmount.toFixed(2)} {toWallet.currency}</span></div>
                    </div>
                  )}
                  <Button onClick={handleConvert} disabled={convertCurrency.isPending || !convertForm.from_wallet || !convertForm.to_wallet || !convertForm.amount} className="w-full">
                    {convertCurrency.isPending ? 'Converting...' : 'Convert Now'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Wallet</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Currency Wallet</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Currency</Label>
                    <Select value={newCurrency} onValueChange={setNewCurrency}>
                      <SelectTrigger><SelectValue placeholder="Select currency" /></SelectTrigger>
                      <SelectContent>
                        {availableCurrencies.map(c => <SelectItem key={c.code} value={c.code}>{c.flag} {c.code} — {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => { createWallet.mutate(newCurrency, { onSuccess: () => { setAddOpen(false); setNewCurrency(''); } }); }} disabled={createWallet.isPending || !newCurrency} className="w-full">
                    {createWallet.isPending ? 'Creating...' : 'Create Wallet'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="wallets">
          <TabsList><TabsTrigger value="wallets">Wallets</TabsTrigger><TabsTrigger value="history">Conversion History</TabsTrigger></TabsList>
          <TabsContent value="wallets" className="mt-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {isLoading ? <p className="text-muted-foreground">Loading...</p> : wallets?.map(w => {
                const info = getCurrencyInfo(w.currency);
                return (
                  <Card key={w.id} className="relative overflow-hidden">
                    <div className="absolute top-0 right-0 text-6xl opacity-10 p-4">{info?.flag}</div>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{info?.flag}</span>
                        <div>
                          <CardTitle className="text-lg">{w.currency}</CardTitle>
                          <CardDescription>{info?.name}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-3xl font-bold mb-2">{Number(w.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      <Badge variant={w.status === 'active' ? 'default' : 'secondary'}>{w.status}</Badge>
                    </CardContent>
                  </Card>
                );
              })}
              {availableCurrencies.length > 0 && (
                <Card className="border-dashed cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setAddOpen(true)}>
                  <CardContent className="pt-6 flex flex-col items-center justify-center h-full min-h-[160px]">
                    <Plus className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground font-medium">Add Currency</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
          <TabsContent value="history" className="mt-6">
            <div className="space-y-3">
              {conversions?.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-muted-foreground">No conversions yet.</CardContent></Card>
              ) : conversions?.map(c => (
                <Card key={c.id}>
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ArrowLeftRight className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium">{Number(c.from_amount).toLocaleString()} {c.from_currency} → {Number(c.to_amount).toLocaleString()} {c.to_currency}</p>
                        <p className="text-xs text-muted-foreground">Rate: {Number(c.exchange_rate).toFixed(4)} • Fee: {Number(c.fee_amount || 0).toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge variant={c.status === 'completed' ? 'default' : 'secondary'}>{c.status}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">{format(new Date(c.created_at), 'MMM d, HH:mm')}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default MultiCurrencyWallet;
