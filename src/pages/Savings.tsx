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
import { PiggyBank, Plus, Target } from 'lucide-react';

const Savings = () => {
  const { accounts, createAccount, deposit, withdraw } = useSavings();
  const [openNew, setOpenNew] = useState(false);
  const [openDeposit, setOpenDeposit] = useState<string | null>(null);
  const [openWithdraw, setOpenWithdraw] = useState<string | null>(null);
  const [newForm, setNewForm] = useState({ name: '', target_amount: '' });
  const [depositAmount, setDepositAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const totalBalance = accounts.data?.reduce((s, a) => s + Number(a.balance), 0) || 0;
  // NOTE: no interest is shown anywhere on this page. savings_accounts
  // carries interest_rate / interest_earned columns (schema defaults),
  // but nothing in the platform ever accrues or pays interest — no
  // function, RPC, trigger or cron writes those fields — so displaying
  // an APY or "interest earned" would promise money the platform does
  // not pay. If an accrual engine is ever built (a CEO decision), the
  // claims can come back, wired to its real output.

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-24 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold text-foreground">Savings</h1>
            <p className="text-sm text-muted-foreground mt-1">Set money aside for your goals</p>
          </div>
          <Dialog open={openNew} onOpenChange={setOpenNew}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New Goal</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Savings Goal</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Name</Label><Input value={newForm.name} onChange={e => setNewForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g., Emergency Fund" /></div>
                <div><Label>Target Amount (ZMW)</Label><Input type="number" value={newForm.target_amount} onChange={e => setNewForm(p => ({ ...p, target_amount: e.target.value }))} /></div>
                <Button onClick={() => { createAccount.mutate({ name: newForm.name, target_amount: newForm.target_amount ? Number(newForm.target_amount) : undefined }, { onSuccess: () => { setOpenNew(false); setNewForm({ name: '', target_amount: '' }); } }); }} disabled={!newForm.name || createAccount.isPending} className="w-full">Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-6 mb-6">
          <Card>
            <CardContent className="p-6 md:p-8">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><PiggyBank className="h-5 w-5 text-primary" /></div>
                <p className="text-sm font-medium text-muted-foreground">Total Savings</p>
              </div>
              <p className="text-4xl md:text-[44px] leading-tight font-display font-semibold mt-3">ZMW {totalBalance.toLocaleString()}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-6 py-2">
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center"><Target className="h-5 w-5 text-warning" /></div>
                    <p className="text-[15px] font-medium">Active Goals</p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{accounts.data?.filter(a => a.status === 'active').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 items-start">
          {accounts.data?.map(account => {
            const progress = account.target_amount ? (Number(account.balance) / Number(account.target_amount)) * 100 : 0;
            return (
              <Card key={account.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold">{account.name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums">ZMW {Number(account.balance).toLocaleString()}</p>
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
                  <div className="flex gap-2">
                    <Dialog open={openDeposit === account.id} onOpenChange={v => { setOpenDeposit(v ? account.id : null); setDepositAmount(''); }}>
                      <DialogTrigger asChild><Button size="sm" variant="outline">Deposit</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Deposit to {account.name}</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <p className="text-sm text-muted-foreground">The amount moves from your wallet into this goal.</p>
                          <div><Label>Amount (ZMW)</Label><Input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} /></div>
                          <Button onClick={() => { deposit.mutate({ id: account.id, amount: Number(depositAmount) }, { onSuccess: () => setOpenDeposit(null) }); }} disabled={!depositAmount || deposit.isPending} className="w-full">Deposit</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Dialog open={openWithdraw === account.id} onOpenChange={v => { setOpenWithdraw(v ? account.id : null); setWithdrawAmount(''); }}>
                      <DialogTrigger asChild><Button size="sm" variant="outline" disabled={Number(account.balance) <= 0}>Withdraw</Button></DialogTrigger>
                      <DialogContent>
                        <DialogHeader><DialogTitle>Withdraw from {account.name}</DialogTitle></DialogHeader>
                        <div className="space-y-4">
                          <p className="text-sm text-muted-foreground">The amount moves from this goal back to your wallet. Available: ZMW {Number(account.balance).toLocaleString()}</p>
                          <div><Label>Amount (ZMW)</Label><Input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} /></div>
                          <Button onClick={() => { withdraw.mutate({ id: account.id, amount: Number(withdrawAmount) }, { onSuccess: () => setOpenWithdraw(null) }); }} disabled={!withdrawAmount || Number(withdrawAmount) > Number(account.balance) || withdraw.isPending} className="w-full">Withdraw</Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {!accounts.data?.length && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                <PiggyBank className="h-6 w-6 text-muted-foreground" />
              </div>
              <p>Start saving today — create a goal and track your progress</p>
            </CardContent></Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Savings;
