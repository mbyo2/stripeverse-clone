import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useEscrow } from '@/hooks/useEscrow';
import { useAuth } from '@/contexts/AuthContext';
import { Lock, Plus, ShieldCheck, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

const statusColors: Record<string, string> = {
  pending: 'bg-warning/10 text-warning', funded: 'bg-primary/10 text-primary',
  released: 'bg-success/10 text-success', disputed: 'bg-destructive/10 text-destructive',
};

const Escrow = () => {
  const { user } = useAuth();
  const { escrows, createEscrow, releaseEscrow } = useEscrow();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ seller_id: '', amount: '', description: '', release_conditions: '' });

  const handleCreate = () => {
    createEscrow.mutate({
      seller_id: form.seller_id,
      amount: Number(form.amount),
      description: form.description || undefined,
      release_conditions: form.release_conditions || undefined,
    }, { onSuccess: () => { setOpen(false); setForm({ seller_id: '', amount: '', description: '', release_conditions: '' }); } });
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Marketplace Escrow</h1>
            <p className="text-muted-foreground">Secure funds until delivery is confirmed</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New Escrow</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Escrow</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Seller ID</Label><Input placeholder="Seller's user ID" value={form.seller_id} onChange={e => setForm(p => ({ ...p, seller_id: e.target.value }))} /></div>
                <div><Label>Amount (ZMW)</Label><Input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} /></div>
                <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div><Label>Release Conditions</Label><Textarea placeholder="e.g., Goods delivered and inspected" value={form.release_conditions} onChange={e => setForm(p => ({ ...p, release_conditions: e.target.value }))} /></div>
                <Button onClick={handleCreate} disabled={createEscrow.isPending || !form.seller_id || !form.amount} className="w-full">Create Escrow</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {[
            { label: 'Active Escrows', value: escrows.data?.filter(e => e.status === 'funded').length || 0, icon: Lock },
            { label: 'Total Held', value: `ZMW ${escrows.data?.filter(e => e.status === 'funded').reduce((s, e) => s + Number(e.amount), 0).toLocaleString() || 0}`, icon: ShieldCheck },
            { label: 'Released', value: escrows.data?.filter(e => e.status === 'released').length || 0, icon: ArrowRight },
          ].map((s, i) => (
            <Card key={i}><CardContent className="p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><s.icon className="h-5 w-5 text-primary" /></div>
              <div><p className="text-sm text-muted-foreground">{s.label}</p><p className="text-xl font-bold">{s.value}</p></div>
            </CardContent></Card>
          ))}
        </div>

        <div className="space-y-3">
          {escrows.data?.map(escrow => (
            <Card key={escrow.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">ZMW {Number(escrow.amount).toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">{escrow.description || 'No description'}</p>
                  <p className="text-xs text-muted-foreground mt-1">{format(new Date(escrow.created_at), 'MMM d, yyyy')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={statusColors[escrow.status] || ''}>{escrow.status}</Badge>
                  {escrow.status === 'funded' && escrow.buyer_id === user?.id && (
                    <Button size="sm" variant="outline" onClick={() => releaseEscrow.mutate(escrow.id)}>Release</Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
          {!escrows.data?.length && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <Lock className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No escrow transactions yet</p>
            </CardContent></Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default Escrow;
