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
      <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">Payment Links</h1>
            <p className="text-sm text-muted-foreground mt-1">Create shareable checkout pages to collect payments</p>
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

        {/* Summary + Stats */}
        <div className="space-y-6 mb-8">
          <Card>
            <CardContent className="p-6 md:p-8">
              <p className="text-sm font-medium text-muted-foreground">Total Collected</p>
              <p className="text-4xl md:text-[44px] leading-tight font-display font-semibold mt-2">K{links?.reduce((s, l) => s + (l.total_collected || 0), 0).toLocaleString() || '0'}</p>
              <p className="text-sm text-muted-foreground mt-1">Across all your payment links</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="px-6 py-2">
              <div className="divide-y divide-border">
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Link2 className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-[15px] font-medium">Total Links</p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{links?.length || 0}</p>
                </div>
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Eye className="h-5 w-5 text-primary" />
                    </div>
                    <p className="text-[15px] font-medium">Active Links</p>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{links?.filter(l => l.status === 'active').length || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? <p className="text-muted-foreground">Loading...</p> : links?.length === 0 ? (
          <Card><CardContent className="py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Link2 className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">No payment links yet. Create one to start collecting payments.</p>
          </CardContent></Card>
        ) : (
          <Card>
            <CardContent className="px-6 py-2">
              <div className="divide-y divide-border">
                {links?.map(link => (
                  <div key={link.id} className="flex items-start justify-between py-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-[15px]">{link.title}</h3>
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
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default PaymentLinks;
