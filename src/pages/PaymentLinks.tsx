import React, { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Link2, Plus, Copy, ExternalLink, XCircle, DollarSign, Eye } from 'lucide-react';
import { usePaymentLinks, useCreatePaymentLink, useDeactivatePaymentLink } from '@/hooks/usePaymentLinks';
import { toast } from 'sonner';
import { format } from 'date-fns';

const PaymentLinks = () => {
  const { data: links, isLoading } = usePaymentLinks();
  const createLink = useCreatePaymentLink();
  const deactivateLink = useDeactivatePaymentLink();
  const [open, setOpen] = useState(false);
  const [fixedAmount, setFixedAmount] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', amount: '', max_payments: '' });

  const handleCreate = () => {
    createLink.mutate({
      title: form.title, description: form.description,
      amount: fixedAmount && form.amount ? Number(form.amount) : undefined,
      max_payments: form.max_payments ? Number(form.max_payments) : undefined,
    }, { onSuccess: () => { setOpen(false); setForm({ title: '', description: '', amount: '', max_payments: '' }); } });
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${code}`);
    toast.success('Payment link copied!');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Payment Links</h1>
            <p className="text-muted-foreground">Create shareable checkout pages to collect payments</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Create Link</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Payment Link</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Title</Label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Product Purchase" /></div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What is this payment for?" /></div>
                <div className="flex items-center justify-between">
                  <Label>Fixed Amount</Label>
                  <Switch checked={fixedAmount} onCheckedChange={setFixedAmount} />
                </div>
                {fixedAmount && <div><Label>Amount (ZMW)</Label><Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>}
                <div><Label>Max Payments (optional)</Label><Input type="number" value={form.max_payments} onChange={e => setForm(p => ({ ...p, max_payments: e.target.value }))} placeholder="Unlimited" /></div>
                <Button onClick={handleCreate} disabled={createLink.isPending || !form.title} className="w-full">
                  {createLink.isPending ? 'Creating...' : 'Create Payment Link'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><Link2 className="h-8 w-8 text-primary" /><div><p className="text-2xl font-bold">{links?.length || 0}</p><p className="text-sm text-muted-foreground">Total Links</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><Eye className="h-8 w-8 text-primary" /><div><p className="text-2xl font-bold">{links?.filter(l => l.status === 'active').length || 0}</p><p className="text-sm text-muted-foreground">Active Links</p></div></div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="flex items-center gap-3"><DollarSign className="h-8 w-8 text-primary" /><div><p className="text-2xl font-bold">K{links?.reduce((s, l) => s + (l.total_collected || 0), 0).toLocaleString() || '0'}</p><p className="text-sm text-muted-foreground">Total Collected</p></div></div></CardContent></Card>
        </div>

        <div className="space-y-4">
          {isLoading ? <p className="text-muted-foreground">Loading...</p> : links?.length === 0 ? (
            <Card><CardContent className="py-12 text-center"><Link2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No payment links yet. Create one to start collecting payments.</p></CardContent></Card>
          ) : links?.map(link => (
            <Card key={link.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-lg">{link.title}</h3>
                      <Badge variant={link.status === 'active' ? 'default' : 'secondary'}>{link.status}</Badge>
                    </div>
                    {link.description && <p className="text-sm text-muted-foreground mb-2">{link.description}</p>}
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      {link.amount && <span className="font-medium text-foreground">K{Number(link.amount).toLocaleString()}</span>}
                      <span>{link.payment_count} payments</span>
                      <span>K{Number(link.total_collected || 0).toLocaleString()} collected</span>
                      <span>Created {format(new Date(link.created_at), 'MMM d, yyyy')}</span>
                    </div>
                    <div className="mt-2 p-2 rounded bg-muted/50 text-xs font-mono truncate">
                      {window.location.origin}/pay/{link.link_code}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button size="sm" variant="outline" onClick={() => copyLink(link.link_code)}><Copy className="h-3 w-3" /></Button>
                    <Button size="sm" variant="outline" onClick={() => window.open(`/pay/${link.link_code}`, '_blank')}><ExternalLink className="h-3 w-3" /></Button>
                    {link.status === 'active' && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deactivateLink.mutate(link.id)}><XCircle className="h-3 w-3" /></Button>}
                  </div>
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

export default PaymentLinks;
