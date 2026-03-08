import React, { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RotateCcw, Plus, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useRefunds, useCreateRefund } from '@/hooks/useRefunds';
import { format } from 'date-fns';

const Refunds = () => {
  const { data: refunds, isLoading } = useRefunds();
  const createRefund = useCreateRefund();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ transaction_id: '', amount: '', reason: '', refund_type: 'full', notes: '' });

  const handleCreate = () => {
    createRefund.mutate({ ...form, amount: Number(form.amount) }, {
      onSuccess: () => { setOpen(false); setForm({ transaction_id: '', amount: '', reason: '', refund_type: 'full', notes: '' }); }
    });
  };

  const statusIcon = (s: string) => {
    switch (s) { case 'approved': case 'completed': return <CheckCircle className="h-4 w-4 text-green-500" />; case 'rejected': return <XCircle className="h-4 w-4 text-destructive" />; case 'pending': return <Clock className="h-4 w-4 text-yellow-500" />; default: return <AlertCircle className="h-4 w-4 text-muted-foreground" />; }
  };

  const stats = {
    total: refunds?.length || 0,
    pending: refunds?.filter(r => r.status === 'pending').length || 0,
    approved: refunds?.filter(r => ['approved', 'completed'].includes(r.status)).length || 0,
    totalAmount: refunds?.reduce((s, r) => s + Number(r.amount), 0) || 0,
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Refunds</h1>
            <p className="text-muted-foreground">Request and manage refunds for transactions</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Request Refund</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Request a Refund</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Transaction ID</Label><Input value={form.transaction_id} onChange={e => setForm(p => ({ ...p, transaction_id: e.target.value }))} placeholder="Enter transaction ID" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Refund Type</Label>
                    <Select value={form.refund_type} onValueChange={v => setForm(p => ({ ...p, refund_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full Refund</SelectItem>
                        <SelectItem value="partial">Partial Refund</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Amount (ZMW)</Label><Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
                </div>
                <div>
                  <Label>Reason</Label>
                  <Select value={form.reason} onValueChange={v => setForm(p => ({ ...p, reason: v }))}>
                    <SelectTrigger><SelectValue placeholder="Select reason" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="duplicate">Duplicate charge</SelectItem>
                      <SelectItem value="fraud">Fraudulent transaction</SelectItem>
                      <SelectItem value="not_received">Service not received</SelectItem>
                      <SelectItem value="defective">Defective product/service</SelectItem>
                      <SelectItem value="cancelled">Order cancelled</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Additional Notes</Label><Textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Provide details..." /></div>
                <Button onClick={handleCreate} disabled={createRefund.isPending || !form.transaction_id || !form.amount || !form.reason} className="w-full">
                  {createRefund.isPending ? 'Submitting...' : 'Submit Refund Request'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-muted-foreground">Total Refunds</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold text-yellow-500">{stats.pending}</p><p className="text-sm text-muted-foreground">Pending</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold text-green-500">{stats.approved}</p><p className="text-sm text-muted-foreground">Approved</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold">K{stats.totalAmount.toLocaleString()}</p><p className="text-sm text-muted-foreground">Total Refunded</p></CardContent></Card>
        </div>

        <div className="space-y-4">
          {isLoading ? <p className="text-muted-foreground">Loading...</p> : refunds?.length === 0 ? (
            <Card><CardContent className="py-12 text-center"><RotateCcw className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No refunds yet.</p></CardContent></Card>
          ) : refunds?.map(refund => (
            <Card key={refund.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    {statusIcon(refund.status)}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">K{Number(refund.amount).toLocaleString()}</p>
                        <Badge variant={refund.refund_type === 'full' ? 'default' : 'outline'}>{refund.refund_type}</Badge>
                        <Badge variant={refund.status === 'pending' ? 'secondary' : refund.status === 'completed' ? 'default' : 'destructive'}>{refund.status}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">Reason: {refund.reason}</p>
                      <p className="text-xs text-muted-foreground">Transaction: {refund.transaction_id}</p>
                      {refund.notes && <p className="text-sm text-muted-foreground mt-1">{refund.notes}</p>}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{format(new Date(refund.created_at), 'MMM d, yyyy HH:mm')}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Refunds;
