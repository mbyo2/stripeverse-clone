import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePaymentPlans } from '@/hooks/usePaymentPlans';
import { CalendarClock, Plus, Users } from 'lucide-react';
import { format } from 'date-fns';

const PaymentPlans = () => {
  const { plans, createPlan } = usePaymentPlans();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_email: '', customer_name: '', description: '', total_amount: '', installments_total: '4', frequency: 'monthly' });

  const handleCreate = () => {
    createPlan.mutate({
      customer_email: form.customer_email,
      customer_name: form.customer_name || undefined,
      description: form.description || undefined,
      total_amount: Number(form.total_amount),
      installments_total: Number(form.installments_total),
      frequency: form.frequency,
    }, { onSuccess: () => { setOpen(false); setForm({ customer_email: '', customer_name: '', description: '', total_amount: '', installments_total: '4', frequency: 'monthly' }); } });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Payment Plans</h1>
            <p className="text-muted-foreground">Create installment plans for your customers</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New Plan</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Payment Plan</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Customer Email</Label><Input value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} /></div>
                <div><Label>Customer Name</Label><Input value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} /></div>
                <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Total Amount (ZMW)</Label><Input type="number" value={form.total_amount} onChange={e => setForm(p => ({ ...p, total_amount: e.target.value }))} /></div>
                  <div><Label>Installments</Label>
                    <Select value={form.installments_total} onValueChange={v => setForm(p => ({ ...p, installments_total: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[2, 3, 4, 6, 12].map(n => <SelectItem key={n} value={String(n)}>{n} payments</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {form.total_amount && <p className="text-sm text-muted-foreground">Each installment: ZMW {(Number(form.total_amount) / Number(form.installments_total)).toFixed(2)}</p>}
                <Button onClick={handleCreate} disabled={createPlan.isPending || !form.customer_email || !form.total_amount} className="w-full">Create Plan</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-4">
          {plans.data?.length === 0 && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <CalendarClock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No payment plans yet. Create one to offer installment payments.</p>
            </CardContent></Card>
          )}
          {plans.data?.map(plan => (
            <Card key={plan.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Users className="h-5 w-5 text-primary" /></div>
                  <div>
                    <p className="font-medium">{plan.customer_name || plan.customer_email}</p>
                    <p className="text-sm text-muted-foreground">{plan.description || `${plan.installments_total} installments`}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{plan.currency} {Number(plan.total_amount).toLocaleString()}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={plan.status === 'active' ? 'default' : 'secondary'}>{plan.status}</Badge>
                    <span className="text-xs text-muted-foreground">{plan.installments_paid}/{plan.installments_total} paid</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
};

export default PaymentPlans;
