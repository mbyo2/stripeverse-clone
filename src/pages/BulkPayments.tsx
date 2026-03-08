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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Users, Plus, Play, Trash2, Upload, FileSpreadsheet } from 'lucide-react';
import { useBulkPayments, useCreateBulkPayment, useProcessBulkPayment, useBulkPaymentItems } from '@/hooks/useBulkPayments';
import { format } from 'date-fns';

const BulkPayments = () => {
  const { data: batches, isLoading } = useBulkPayments();
  const createBatch = useCreateBulkPayment();
  const processBatch = useProcessBulkPayment();
  const [open, setOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const { data: items } = useBulkPaymentItems(selectedBatch || undefined);
  const [name, setName] = useState('');
  const [recipients, setRecipients] = useState<Array<{ recipient_name: string; recipient_account: string; recipient_bank: string; amount: number }>>([
    { recipient_name: '', recipient_account: '', recipient_bank: '', amount: 0 },
  ]);

  const addRow = () => setRecipients(p => [...p, { recipient_name: '', recipient_account: '', recipient_bank: '', amount: 0 }]);
  const removeRow = (i: number) => setRecipients(p => p.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: string, value: string | number) => setRecipients(p => p.map((r, idx) => idx === i ? { ...r, [field]: value } : r));

  const total = recipients.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const handleCreate = () => {
    createBatch.mutate({ name, items: recipients.filter(r => r.recipient_name && r.amount > 0) }, {
      onSuccess: () => { setOpen(false); setName(''); setRecipients([{ recipient_name: '', recipient_account: '', recipient_bank: '', amount: 0 }]); }
    });
  };

  const statusColor = (s: string) => {
    switch (s) { case 'completed': return 'default'; case 'processing': return 'secondary'; case 'draft': return 'outline'; case 'failed': return 'destructive'; default: return 'outline'; }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Bulk Payments</h1>
            <p className="text-muted-foreground">Pay multiple recipients at once — payroll, disbursements, vendor payments</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New Batch</Button></DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Bulk Payment</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Batch Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. March Payroll" /></div>
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead><TableHead>Account #</TableHead><TableHead>Bank</TableHead><TableHead>Amount</TableHead><TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recipients.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell><Input value={r.recipient_name} onChange={e => updateRow(i, 'recipient_name', e.target.value)} placeholder="Name" className="h-8" /></TableCell>
                          <TableCell><Input value={r.recipient_account} onChange={e => updateRow(i, 'recipient_account', e.target.value)} placeholder="Account" className="h-8" /></TableCell>
                          <TableCell><Input value={r.recipient_bank} onChange={e => updateRow(i, 'recipient_bank', e.target.value)} placeholder="Bank" className="h-8" /></TableCell>
                          <TableCell><Input type="number" value={r.amount || ''} onChange={e => updateRow(i, 'amount', Number(e.target.value))} placeholder="0.00" className="h-8" /></TableCell>
                          <TableCell><Button size="sm" variant="ghost" onClick={() => removeRow(i)} disabled={recipients.length === 1}><Trash2 className="h-3 w-3" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between">
                  <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-3 w-3 mr-1" />Add Row</Button>
                  <p className="font-semibold">Total: K{total.toLocaleString()}</p>
                </div>
                <Button onClick={handleCreate} disabled={createBatch.isPending || !name || total === 0} className="w-full">
                  {createBatch.isPending ? 'Creating...' : `Create Batch (${recipients.filter(r => r.recipient_name && r.amount).length} recipients)`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{batches?.length || 0}</p><p className="text-sm text-muted-foreground">Total Batches</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold">K{batches?.reduce((s, b) => s + Number(b.total_amount), 0).toLocaleString() || '0'}</p><p className="text-sm text-muted-foreground">Total Disbursed</p></CardContent></Card>
          <Card><CardContent className="pt-6"><p className="text-2xl font-bold">{batches?.reduce((s, b) => s + b.total_items, 0) || 0}</p><p className="text-sm text-muted-foreground">Total Recipients</p></CardContent></Card>
        </div>

        <div className="space-y-4">
          {isLoading ? <p className="text-muted-foreground">Loading...</p> : batches?.length === 0 ? (
            <Card><CardContent className="py-12 text-center"><FileSpreadsheet className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No bulk payments yet.</p></CardContent></Card>
          ) : batches?.map(batch => (
            <Card key={batch.id} className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setSelectedBatch(selectedBatch === batch.id ? null : batch.id)}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-lg">{batch.name}</h3>
                      <Badge variant={statusColor(batch.status) as any}>{batch.status}</Badge>
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                      <span>{batch.total_items} recipients</span>
                      <span>K{Number(batch.total_amount).toLocaleString()}</span>
                      <span>{batch.completed_items}/{batch.total_items} completed</span>
                      <span>{format(new Date(batch.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                  {batch.status === 'draft' && (
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); processBatch.mutate(batch.id); }}>
                      <Play className="h-3 w-3 mr-1" />Process
                    </Button>
                  )}
                </div>
                {selectedBatch === batch.id && items && (
                  <div className="mt-4 border-t pt-4">
                    <Table>
                      <TableHeader><TableRow><TableHead>Recipient</TableHead><TableHead>Account</TableHead><TableHead>Bank</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {items.map(item => (
                          <TableRow key={item.id}>
                            <TableCell>{item.recipient_name}</TableCell>
                            <TableCell>{item.recipient_account || '—'}</TableCell>
                            <TableCell>{item.recipient_bank || '—'}</TableCell>
                            <TableCell>K{Number(item.amount).toLocaleString()}</TableCell>
                            <TableCell><Badge variant={statusColor(item.status) as any}>{item.status}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default BulkPayments;
