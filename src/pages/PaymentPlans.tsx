import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { usePaymentPlans, advanceDateByFrequency } from '@/hooks/usePaymentPlans';
import { CalendarClock, Plus, Users, CheckCircle2, Loader2, History } from 'lucide-react';
import { format } from 'date-fns';

const FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const frequencyLabel = (f: string) =>
  FREQUENCIES.find((x) => x.value === f)?.label || 'Monthly';

const PaymentPlans = () => {
  const { plans, createPlan, recordInstallmentPayment, paymentHistory } = usePaymentPlans();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payDialog, setPayDialog] = useState<{ plan: any } | null>(null);
  const [payForm, setPayForm] = useState({ payment_method: 'manual', reference: '', notes: '' });
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

  const handleRecordPayment = () => {
    if (!payDialog) return;
    recordInstallmentPayment.mutate({
      plan: payDialog.plan,
      payment_method: payForm.payment_method,
      reference: payForm.reference || undefined,
      notes: payForm.notes || undefined,
    }, {
      onSuccess: () => {
        setPayDialog(null);
        setPayForm({ payment_method: 'manual', reference: '', notes: '' });
      },
    });
  };

  /** Build the installment schedule for a plan (due dates from next_payment_date backwards/forwards). */
  const buildSchedule = (plan: any) => {
    const items: Array<{ n: number; due: Date | null; paid: boolean }> = [];
    const freq = plan.frequency || 'monthly';
    // Anchor: the plan's next_payment_date is the due date of the NEXT unpaid installment.
    const anchor = plan.next_payment_date ? new Date(plan.next_payment_date) : null;
    for (let n = 1; n <= plan.installments_total; n++) {
      const paid = n <= (plan.installments_paid || 0);
      let due: Date | null = null;
      if (anchor) {
        // Walk backwards from the anchor for past installments
        const stepsBack = n - (plan.installments_paid || 0) - 1;
        due = new Date(anchor);
        // step back by frequency * -stepsBack
        for (let s = 0; s < Math.abs(stepsBack); s++) {
          due = stepsBack > 0
            ? advanceDateByFrequency(due.toISOString(), freq)
            : advanceDateByFrequencyBack(due, freq);
        }
      }
      items.push({ n, due, paid });
    }
    return items;
  };

  const advanceDateByFrequencyBack = (date: Date, frequency: string): Date => {
    const d = new Date(date);
    switch (frequency) {
      case 'weekly': d.setDate(d.getDate() - 7); break;
      case 'biweekly': d.setDate(d.getDate() - 14); break;
      case 'quarterly': d.setMonth(d.getMonth() - 3); break;
      case 'yearly': d.setFullYear(d.getFullYear() - 1); break;
      case 'monthly':
      default: d.setMonth(d.getMonth() - 1);
    }
    return d;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-2 pb-24 px-4 max-w-5xl mx-auto">
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
                <div><Label>Billing Frequency</Label>
                  <Select value={form.frequency} onValueChange={v => setForm(p => ({ ...p, frequency: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {form.total_amount && <p className="text-sm text-muted-foreground">Each installment: ZMW {(Number(form.total_amount) / Number(form.installments_total)).toFixed(2)} · {frequencyLabel(form.frequency)}</p>}
                <Button onClick={handleCreate} disabled={createPlan.isPending || !form.customer_email || !form.total_amount} className="w-full">Create Plan</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="plans" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="plans">Plans</TabsTrigger>
            <TabsTrigger value="history"><History className="h-4 w-4 mr-2" />Payment History</TabsTrigger>
          </TabsList>

          <TabsContent value="plans">
            <div className="grid gap-4">
              {plans.data?.length === 0 && (
                <Card><CardContent className="py-12 text-center text-muted-foreground">
                  <CalendarClock className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No payment plans yet. Create one to offer installment payments.</p>
                </CardContent></Card>
              )}
              {plans.data?.map(plan => {
                const isExpanded = expanded === plan.id;
                const schedule = isExpanded ? buildSchedule(plan) : [];
                const progress = plan.installments_total > 0
                  ? (plan.installments_paid / plan.installments_total) * 100
                  : 0;
                return (
                  <Card key={plan.id}>
                    <CardContent className="p-4">
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpanded(isExpanded ? null : plan.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Users className="h-5 w-5 text-primary" /></div>
                          <div>
                            <p className="font-medium">{plan.customer_name || plan.customer_email}</p>
                            <p className="text-sm text-muted-foreground">{plan.description || `${plan.installments_total} installments · ${frequencyLabel(plan.frequency)}`}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">{plan.currency} {Number(plan.total_amount).toLocaleString()}</p>
                          <div className="flex items-center gap-2">
                            <Badge variant={plan.status === 'active' ? 'default' : 'secondary'}>{plan.status}</Badge>
                            <span className="text-xs text-muted-foreground">{plan.installments_paid}/{plan.installments_total} paid</span>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t space-y-4" onClick={e => e.stopPropagation()}>
                          <div>
                            <div className="flex justify-between text-sm mb-1">
                              <span>{plan.installments_paid} of {plan.installments_total} collected</span>
                              <span className="text-muted-foreground">
                                {frequencyLabel(plan.frequency)} · {plan.currency} {Number(plan.installment_amount).toLocaleString()} each
                              </span>
                            </div>
                            <Progress value={progress} className="h-2" />
                          </div>

                          <div className="space-y-2">
                            {schedule.map(s => (
                              <div key={s.n} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                                <div className="flex items-center gap-2">
                                  {s.paid
                                    ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                    : <CalendarClock className="h-4 w-4 text-muted-foreground" />}
                                  <span>Installment {s.n}</span>
                                  {s.due && <span className="text-muted-foreground">· due {format(s.due, 'MMM d, yyyy')}</span>}
                                </div>
                                <span className={s.paid ? 'text-green-600 font-medium' : 'text-muted-foreground'}>
                                  {s.paid ? 'Paid' : `${plan.currency} ${Number(plan.installment_amount).toLocaleString()}`}
                                </span>
                              </div>
                            ))}
                          </div>

                          {plan.status === 'active' && (
                            <Button
                              size="sm"
                              onClick={() => { setPayForm({ payment_method: 'manual', reference: '', notes: '' }); setPayDialog({ plan }); }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" />
                              Record installment {(plan.installments_paid || 0) + 1} payment
                            </Button>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader><CardTitle className="text-base">Collected Installments</CardTitle></CardHeader>
              <CardContent>
                {!paymentHistory.data || paymentHistory.data.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No installments recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {paymentHistory.data.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                        <div>
                          <p className="font-medium">
                            {p.merchant_payment_plans?.customer_name || p.merchant_payment_plans?.customer_email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Installment {p.installment_number} · {format(new Date(p.paid_at), 'MMM d, yyyy HH:mm')} · {p.payment_method}
                            {p.reference && ` · ref ${p.reference}`}
                          </p>
                        </div>
                        <span className="font-semibold">{p.currency} {Number(p.amount).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Record payment dialog */}
        <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                Record payment — installment {(payDialog?.plan.installments_paid || 0) + 1} of {payDialog?.plan.installments_total}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Amount</Label>
                <Input disabled value={`${payDialog?.plan.currency || 'ZMW'} ${Number(payDialog?.plan.installment_amount || 0).toLocaleString()}`} />
              </div>
              <div>
                <Label>Payment Method</Label>
                <Select value={payForm.payment_method} onValueChange={v => setPayForm(p => ({ ...p, payment_method: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Cash / Manual</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Reference (optional)</Label><Input value={payForm.reference} onChange={e => setPayForm(p => ({ ...p, reference: e.target.value }))} placeholder="Receipt / transaction ref" /></div>
              <div><Label>Notes (optional)</Label><Input value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <Button onClick={handleRecordPayment} disabled={recordInstallmentPayment.isPending} className="w-full">
                {recordInstallmentPayment.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Confirm payment received
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
};

export default PaymentPlans;
