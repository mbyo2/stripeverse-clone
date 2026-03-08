import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useBillPayments } from '@/hooks/useBillPayments';
import { Zap, Smartphone, Tv, Wifi, Droplets, Receipt } from 'lucide-react';
import { format } from 'date-fns';

const categoryIcons: Record<string, React.ElementType> = {
  electricity: Zap, airtime: Smartphone, tv: Tv, internet: Wifi, water: Droplets,
};

const BillPayments = () => {
  const { payments, payBill, billers } = useBillPayments();
  const [selectedBiller, setSelectedBiller] = useState<typeof billers[0] | null>(null);
  const [accountNumber, setAccountNumber] = useState('');
  const [amount, setAmount] = useState('');
  const categories = [...new Set(billers.map(b => b.category))];

  const handlePay = () => {
    if (!selectedBiller) return;
    payBill.mutate({
      biller_name: selectedBiller.name,
      biller_code: selectedBiller.code,
      category: selectedBiller.category,
      account_number: accountNumber,
      amount: Number(amount),
    }, { onSuccess: () => { setSelectedBiller(null); setAccountNumber(''); setAmount(''); } });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-foreground mb-2">Bill Payments</h1>
        <p className="text-muted-foreground mb-6">Pay utilities, airtime, TV subscriptions and more</p>

        <Tabs defaultValue="pay">
          <TabsList><TabsTrigger value="pay">Pay Bills</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>

          <TabsContent value="pay" className="space-y-6 mt-4">
            {categories.map(cat => {
              const Icon = categoryIcons[cat] || Receipt;
              return (
                <div key={cat}>
                  <h3 className="font-semibold capitalize mb-3 flex items-center gap-2"><Icon className="h-4 w-4" /> {cat}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {billers.filter(b => b.category === cat).map(biller => (
                      <Card key={biller.code} className="cursor-pointer hover:border-primary transition-colors" onClick={() => setSelectedBiller(biller)}>
                        <CardContent className="p-4 text-center">
                          <span className="text-2xl mb-2 block">{biller.icon}</span>
                          <p className="font-medium text-sm">{biller.name}</p>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}
          </TabsContent>

          <TabsContent value="history" className="mt-4 space-y-3">
            {payments.data?.map(p => (
              <Card key={p.id}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{p.biller_name}</p>
                    <p className="text-sm text-muted-foreground">Acc: {p.account_number} • {p.reference}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(p.created_at), 'MMM d, yyyy HH:mm')}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">ZMW {Number(p.amount).toLocaleString()}</p>
                    <Badge variant={p.status === 'completed' ? 'default' : 'secondary'}>{p.status}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!payments.data?.length && <p className="text-center text-muted-foreground py-8">No bill payments yet</p>}
          </TabsContent>
        </Tabs>

        <Dialog open={!!selectedBiller} onOpenChange={() => setSelectedBiller(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Pay {selectedBiller?.name}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Account / Meter Number</Label><Input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} placeholder="Enter account number" /></div>
              <div><Label>Amount (ZMW)</Label><Input type="number" value={amount} onChange={e => setAmount(e.target.value)} /></div>
              <Button onClick={handlePay} disabled={payBill.isPending || !accountNumber || !amount} className="w-full">Pay ZMW {amount || '0'}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default BillPayments;
