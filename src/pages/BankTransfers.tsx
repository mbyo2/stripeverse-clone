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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Plus, Send, Trash2, Globe, ArrowRight } from 'lucide-react';
import { useBankAccounts, useAddBankAccount, useDeleteBankAccount, useInitiateBankTransfer } from '@/hooks/useBankTransfers';

const ZAMBIAN_BANKS = [
  { code: 'ZANACO', name: 'Zanaco' },
  { code: 'FNB', name: 'First National Bank' },
  { code: 'STANBIC', name: 'Stanbic Bank' },
  { code: 'ABSA', name: 'Absa Bank' },
  { code: 'SBZ', name: 'Standard Chartered' },
  { code: 'INDO', name: 'Indo Zambia Bank' },
  { code: 'ACCESS', name: 'Access Bank' },
  { code: 'ATLAS', name: 'Atlas Mara' },
  { code: 'UBA', name: 'United Bank for Africa' },
];

const BankTransfers = () => {
  const { data: accounts, isLoading } = useBankAccounts();
  const addAccount = useAddBankAccount();
  const deleteAccount = useDeleteBankAccount();
  const initiateTransfer = useInitiateBankTransfer();
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [form, setForm] = useState({ bank_name: '', account_number: '', account_name: '', account_type: 'savings', swift_code: '', country: 'ZM' });
  const [transferForm, setTransferForm] = useState({ bank_account_id: '', amount: '', description: '' });

  const handleAdd = () => {
    addAccount.mutate({ ...form }, { onSuccess: () => { setAddOpen(false); setForm({ bank_name: '', account_number: '', account_name: '', account_type: 'savings', swift_code: '', country: 'ZM' }); } });
  };

  const handleTransfer = () => {
    const acc = accounts?.find(a => a.id === transferForm.bank_account_id);
    if (!acc) return;
    initiateTransfer.mutate({
      bank_account_id: acc.id, amount: Number(transferForm.amount),
      description: transferForm.description, recipient_name: acc.account_name,
      recipient_account: acc.account_number, recipient_bank: acc.bank_name,
    }, { onSuccess: () => { setTransferOpen(false); setTransferForm({ bank_account_id: '', amount: '', description: '' }); } });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Bank Transfers</h1>
            <p className="text-muted-foreground">Send money to any bank account locally or internationally</p>
          </div>
          <div className="flex gap-2">
            <Dialog open={addOpen} onOpenChange={setAddOpen}>
              <DialogTrigger asChild><Button variant="outline"><Plus className="h-4 w-4 mr-2" />Add Account</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Add Bank Account</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Bank</Label>
                    <Select value={form.bank_name} onValueChange={v => setForm(p => ({ ...p, bank_name: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select bank" /></SelectTrigger>
                      <SelectContent>
                        {ZAMBIAN_BANKS.map(b => <SelectItem key={b.code} value={b.name}>{b.name}</SelectItem>)}
                        <SelectItem value="other">Other (International)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Account Name</Label><Input value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} /></div>
                  <div><Label>Account Number</Label><Input value={form.account_number} onChange={e => setForm(p => ({ ...p, account_number: e.target.value }))} /></div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Type</Label>
                      <Select value={form.account_type} onValueChange={v => setForm(p => ({ ...p, account_type: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="savings">Savings</SelectItem>
                          <SelectItem value="current">Current</SelectItem>
                          <SelectItem value="business">Business</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>SWIFT Code</Label><Input value={form.swift_code} onChange={e => setForm(p => ({ ...p, swift_code: e.target.value }))} placeholder="For international" /></div>
                  </div>
                  <Button onClick={handleAdd} disabled={addAccount.isPending || !form.bank_name || !form.account_number || !form.account_name} className="w-full">
                    {addAccount.isPending ? 'Adding...' : 'Add Bank Account'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
              <DialogTrigger asChild><Button><Send className="h-4 w-4 mr-2" />New Transfer</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Send Bank Transfer</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Recipient Account</Label>
                    <Select value={transferForm.bank_account_id} onValueChange={v => setTransferForm(p => ({ ...p, bank_account_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select saved account" /></SelectTrigger>
                      <SelectContent>
                        {accounts?.map(a => <SelectItem key={a.id} value={a.id}>{a.account_name} - {a.bank_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Amount (ZMW)</Label><Input type="number" value={transferForm.amount} onChange={e => setTransferForm(p => ({ ...p, amount: e.target.value }))} /></div>
                  <div><Label>Description</Label><Input value={transferForm.description} onChange={e => setTransferForm(p => ({ ...p, description: e.target.value }))} /></div>
                  <Button onClick={handleTransfer} disabled={initiateTransfer.isPending || !transferForm.bank_account_id || !transferForm.amount} className="w-full">
                    {initiateTransfer.isPending ? 'Processing...' : 'Send Transfer'}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Tabs defaultValue="accounts">
          <TabsList><TabsTrigger value="accounts">Saved Accounts</TabsTrigger><TabsTrigger value="local">Local Transfer</TabsTrigger><TabsTrigger value="international">International</TabsTrigger></TabsList>
          <TabsContent value="accounts" className="mt-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {isLoading ? <p className="text-muted-foreground">Loading...</p> : accounts?.length === 0 ? (
                <Card className="col-span-full"><CardContent className="pt-6 text-center text-muted-foreground">No bank accounts saved. Add one to get started.</CardContent></Card>
              ) : accounts?.map(acc => (
                <Card key={acc.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-primary" />
                        <CardTitle className="text-base">{acc.bank_name}</CardTitle>
                      </div>
                      {acc.is_primary && <Badge variant="secondary">Primary</Badge>}
                    </div>
                    <CardDescription>{acc.account_name}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">****{acc.account_number.slice(-4)}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <Badge variant="outline">{acc.account_type}</Badge>
                      {acc.swift_code && <Badge variant="outline"><Globe className="h-3 w-3 mr-1" />International</Badge>}
                    </div>
                    <div className="flex gap-2 mt-4">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => { setTransferForm(p => ({ ...p, bank_account_id: acc.id })); setTransferOpen(true); }}>
                        <ArrowRight className="h-3 w-3 mr-1" />Send
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteAccount.mutate(acc.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="local" className="mt-6">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Local Bank Transfer (RTGS/EFT)</CardTitle><CardDescription>Transfer to any Zambian bank account. Processed within 1-2 business days via EFT or same-day via RTGS.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
                  <div><p className="text-xs text-muted-foreground">EFT Transfer</p><p className="font-semibold">1-2 business days</p><p className="text-xs text-muted-foreground">Fee: K5.00</p></div>
                  <div><p className="text-xs text-muted-foreground">RTGS Transfer</p><p className="font-semibold">Same day</p><p className="text-xs text-muted-foreground">Fee: K25.00</p></div>
                </div>
                <Button onClick={() => setTransferOpen(true)} className="w-full">Initiate Local Transfer</Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="international" className="mt-6">
            <Card><CardHeader><CardTitle className="flex items-center gap-2"><Globe className="h-5 w-5" />International Wire Transfer (SWIFT)</CardTitle><CardDescription>Send money to bank accounts worldwide. Requires SWIFT/BIC code. Processing time: 2-5 business days.</CardDescription></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-muted/50">
                  <div><p className="text-xs text-muted-foreground">Processing Time</p><p className="font-semibold">2-5 days</p></div>
                  <div><p className="text-xs text-muted-foreground">Transfer Fee</p><p className="font-semibold">K150 + 1.5%</p></div>
                  <div><p className="text-xs text-muted-foreground">Supported</p><p className="font-semibold">180+ countries</p></div>
                </div>
                <Button onClick={() => setTransferOpen(true)} className="w-full">Initiate International Transfer</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default BankTransfers;
