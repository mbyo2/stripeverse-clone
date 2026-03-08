import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useSavings } from '@/hooks/useSavings';
import { PiggyBank, Plus, TrendingUp, Target } from 'lucide-react';

const Savings = () => {
  const { accounts, createAccount, deposit } = useSavings();
  const [openNew, setOpenNew] = useState(false);
  const [openDeposit, setOpenDeposit] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ name: '', target_amount: '' });
  const [depositAmount, setDepositAmount] = useState('');

  const totalBalance = accounts.data?.reduce((s, a) => s + Number(a.balance), 0) || 0;
  const totalInterest = accounts.data?.reduce((s, a) => s + Number(a.interest_earned), 0) || 0;

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Savings</h1>
            <p className="text-muted-foreground">Grow your money with interest</p>
          </div>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New Goal</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Name</Label><Input value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Emergency Fund" /></div>
                <div><Label>Target Amount (ZMW)</Label><Input type="number" value={newForm.target_amount} onChange={e => setNewForm(p => ({ ...p, target_amount: e.target.value }))} /></div>
                <Button onClick={() => { createAccount.mutate({ name: newForm.name, target_amount: newForm.target_amount ? Number(newForm.target_amount) : undefined }); setOpenNew(false); }} disabled={!newForm.name} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><PiggyBank className="h-5 w-5 text-primary" /></div>
            <div><p className="text-sm text-muted-foreground">Total Savings</p><p className="text-xl font-bold">ZMW {totalBalance.toLocaleString()}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-success" /></div>
            <div><p className="text-sm text-muted-foreground">Interest Earned</p><p className="text-xl font-bold">ZMW {totalInterest.toFixed(2)}</p></div>
          </CardContent></Card>
          <Card><CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center"><Target className="h-5 w-5 text-warning" /></div>
            <div><p className="text-sm text-muted-foreground">Active Goals</p><p className="text-xl font-bold">{accounts.data?.filter(a => a.status === 'active').length || 0}</p></div>
          </CardContent></Card>
        </div>

        <div className="grid gap-4">
          {accounts.data?.map(account => {
            const progress = account.target_amount ? (Number(account.balance) / Number(account.target_amount)) * 100 : 0;
            return (
              <Card key={account.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold">{account.name}</p>
                      <p className="text-sm text-muted-foreground">{account.interest_rate}% APY</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">ZMW {Number(account.balance).toLocaleString()}</p>
                      <p className="text-xs text-success">+ZMW {Number(account.interest_earned).toFixed(2)} earned</p>
                    </div>
                  </div>
                  {account.target_amount && (
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>Progress</span><span>{progress.toFixed(0)}% of ZMW {Number(account.target_amount).toLocaleString()}</span>
                      </div>
                      <Progress value={Math.min(progress, 100)} />
                    </div>
                  )}
                  <Dialog open={openDeposit === account.id} onOpenChange={v => { setOpenDeposit(v ? account.id : null); setDepositAmount(''); }}>
                    <DialogTrigger asChild><Button size="sm" variant="outline">Deposit</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Deposit to {account.name}</DialogTitle></DialogHeader>
                      <div className="space-y-4">
                        <div><Label>Amount (ZMW)</Label><Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} /></div>
                        <Button onClick={() => { deposit.mutate({ id: account.id, amount: Number(depositAmount) }); setOpenDeposit(null); }} disabled={!depositAmount} className="w-full">Deposit</Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            );
          })}
          {!accounts.data?.length && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <PiggyBank className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Start saving today and earn interest on your balance</p>
            </CardContent></Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Savings;
