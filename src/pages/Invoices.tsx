import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useMerchantInvoices, InvoiceItem } from '@/hooks/useMerchantInvoices';
import { useCurrency } from '@/contexts/CurrencyContext';
import { FileText, Plus, Send, Eye, Trash2, Copy, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const Invoices = () => {
  const { invoices, isLoading, createInvoice, updateStatus } = useMerchantInvoices();
  const { formatAmount } = useCurrency();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    const updated = [...items];
    (updated[index] as any)[field] = value;
    updated[index].total = updated[index].quantity * updated[index].unit_price;
    setItems(updated);
  };

  const addItem = () => setItems([...items, { description: '', quantity: 1, unit_price: 0, total: 0 }]);
  const removeItem = (index: number) => setItems(items.filter((_, i) => i !== index));

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);

  const handleCreate = async () => {
    if (!customerEmail || items.some((i) => !i.description || i.unit_price <= 0)) {
      toast({ title: 'Error', description: 'Fill in all required fields.', variant: 'destructive' });
      return;
    }
    await createInvoice.mutateAsync({
      customer_email: customerEmail,
      customer_name: customerName || undefined,
      items,
      due_date: dueDate || undefined,
      notes: notes || undefined,
    });
    setShowCreate(false);
    resetForm();
  };

  const resetForm = () => {
    setCustomerEmail('');
    setCustomerName('');
    setDueDate('');
    setNotes('');
    setItems([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/invoice/${code}`);
    toast({ title: 'Invoice link copied!' });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge className="bg-green-500/10 text-green-600"><CheckCircle2 className="h-3 w-3 mr-1" />Paid</Badge>;
      case 'sent': return <Badge className="bg-blue-500/10 text-blue-600"><Send className="h-3 w-3 mr-1" />Sent</Badge>;
      case 'overdue': return <Badge className="bg-red-500/10 text-red-600"><XCircle className="h-3 w-3 mr-1" />Overdue</Badge>;
      default: return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Invoices</h1>
            <p className="text-muted-foreground">Create, send, and track invoices</p>
          </div>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Invoice</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Invoice</DialogTitle>
                <DialogDescription>Create a professional invoice to send to your customer</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Customer Email *</Label>
                    <Input type="email" placeholder="customer@example.com" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Customer Name</Label>
                    <Input placeholder="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Due Date</Label>
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>

                <div>
                  <Label className="mb-2 block">Items</Label>
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                        <div className="col-span-5">
                          <Input placeholder="Description" value={item.description} onChange={(e) => updateItem(idx, 'description', e.target.value)} />
                        </div>
                        <div className="col-span-2">
                          <Input type="number" placeholder="Qty" min={1} value={item.quantity} onChange={(e) => updateItem(idx, 'quantity', parseInt(e.target.value) || 1)} />
                        </div>
                        <div className="col-span-3">
                          <Input type="number" placeholder="Price" min={0} value={item.unit_price || ''} onChange={(e) => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="col-span-1 text-right font-medium text-sm pt-2">{formatAmount(item.total)}</div>
                        <div className="col-span-1">
                          {items.length > 1 && (
                            <Button size="icon" variant="ghost" onClick={() => removeItem(idx)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" className="mt-2" onClick={addItem}>
                    <Plus className="h-3 w-3 mr-1" />Add Item
                  </Button>
                </div>

                <div className="border-t pt-3 text-right">
                  <p className="text-lg font-bold">Total: {formatAmount(subtotal)}</p>
                </div>

                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea placeholder="Payment terms, thank you note..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { setShowCreate(false); resetForm(); }}>Cancel</Button>
                <Button onClick={handleCreate} disabled={createInvoice.isPending}>
                  {createInvoice.isPending ? 'Creating...' : 'Create Invoice'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Invoiced</p>
              <p className="text-xl font-bold">{formatAmount(invoices.reduce((s, i) => s + i.total_amount, 0))}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Paid</p>
              <p className="text-xl font-bold text-green-600">
                {formatAmount(invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.total_amount, 0))}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="text-xl font-bold text-amber-600">
                {formatAmount(invoices.filter((i) => ['sent', 'draft'].includes(i.status)).reduce((s, i) => s + i.total_amount, 0))}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Invoices</p>
              <p className="text-xl font-bold">{invoices.length}</p>
            </CardContent>
          </Card>
        </div>

        {/* Invoice List */}
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="sent">Sent</TabsTrigger>
            <TabsTrigger value="paid">Paid</TabsTrigger>
          </TabsList>

          {['all', 'draft', 'sent', 'paid'].map((tab) => (
            <TabsContent key={tab} value={tab}>
              {isLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Card key={i} className="animate-pulse"><CardContent className="p-4"><div className="h-16 bg-muted rounded" /></CardContent></Card>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {invoices
                    .filter((inv) => tab === 'all' || inv.status === tab)
                    .map((inv) => (
                      <Card key={inv.id} className="hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-3 mb-1">
                                <span className="font-mono text-sm font-medium">{inv.invoice_number}</span>
                                {getStatusBadge(inv.status)}
                              </div>
                              <p className="text-sm">
                                {inv.customer_name || inv.customer_email} · <span className="font-bold">{formatAmount(inv.total_amount)}</span>
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                Created {format(new Date(inv.created_at), 'MMM d, yyyy')}
                                {inv.due_date && ` · Due ${format(new Date(inv.due_date), 'MMM d')}`}
                              </p>
                            </div>
                            <div className="flex gap-1">
                              {inv.status === 'draft' && (
                                <Button size="sm" variant="outline" onClick={() => updateStatus.mutate({ id: inv.id, status: 'sent' })}>
                                  <Send className="h-4 w-4 mr-1" />Send
                                </Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => copyLink(inv.payment_link_code)}>
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  {invoices.filter((inv) => tab === 'all' || inv.status === tab).length === 0 && (
                    <Card>
                      <CardContent className="p-8 text-center text-muted-foreground">
                        <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
                        <p>No {tab === 'all' ? '' : tab} invoices</p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default Invoices;
