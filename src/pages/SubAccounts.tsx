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
import { Users, Plus, Percent, DollarSign, GitBranch } from 'lucide-react';
import { useSubaccounts, useCreateSubaccount, useSplitRules, useCreateSplitRule } from '@/hooks/useSubaccounts';

const SubAccounts = () => {
  const { data: subaccounts, isLoading } = useSubaccounts();
  const { data: rules } = useSplitRules();
  const createSub = useCreateSubaccount();
  const createRule = useCreateSplitRule();
  const [subOpen, setSubOpen] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [subForm, setSubForm] = useState({ account_name: '', account_email: '', split_type: 'percentage', split_value: '' });
  const [ruleForm, setRuleForm] = useState({ name: '', subaccount_id: '', split_type: 'percentage', split_value: '' });

  const handleCreateSub = () => {
    createSub.mutate({ ...subForm, split_value: Number(subForm.split_value) }, {
      onSuccess: () => { setSubOpen(false); setSubForm({ account_name: '', account_email: '', split_type: 'percentage', split_value: '' }); }
    });
  };

  const handleCreateRule = () => {
    createRule.mutate({ ...ruleForm, split_value: Number(ruleForm.split_value) }, {
      onSuccess: () => { setRuleOpen(false); setRuleForm({ name: '', subaccount_id: '', split_type: 'percentage', split_value: '' }); }
    });
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Subaccounts & Split Payments</h1>
            <p className="text-muted-foreground">Automatically split incoming payments between multiple recipients</p>
          </div>
        </div>

        <Tabs defaultValue="subaccounts">
          <TabsList>
            <TabsTrigger value="subaccounts">Subaccounts</TabsTrigger>
            <TabsTrigger value="rules">Split Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="subaccounts" className="mt-6">
            <div className="flex justify-end mb-4">
              <Dialog open={subOpen} onOpenChange={setSubOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Subaccount</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Subaccount</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Account Name</Label><Input value={subForm.account_name} onChange={e => setSubForm(p => ({ ...p, account_name: e.target.value }))} placeholder="e.g. Partner Revenue" /></div>
                    <div><Label>Email</Label><Input type="email" value={subForm.account_email} onChange={e => setSubForm(p => ({ ...p, account_email: e.target.value }))} /></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Split Type</Label>
                        <Select value={subForm.split_type} onValueChange={v => setSubForm(p => ({ ...p, split_type: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">Percentage</SelectItem>
                            <SelectItem value="flat">Flat Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>{subForm.split_type === 'percentage' ? 'Percentage (%)' : 'Amount (ZMW)'}</Label>
                        <Input type="number" value={subForm.split_value} onChange={e => setSubForm(p => ({ ...p, split_value: e.target.value }))} />
                      </div>
                    </div>
                    <Button onClick={handleCreateSub} disabled={createSub.isPending || !subForm.account_name || !subForm.split_value} className="w-full">
                      {createSub.isPending ? 'Creating...' : 'Create Subaccount'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {isLoading ? <p className="text-muted-foreground">Loading...</p> : subaccounts?.length === 0 ? (
                <Card className="col-span-full"><CardContent className="py-12 text-center"><Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No subaccounts yet.</p></CardContent></Card>
              ) : subaccounts?.map(sub => (
                <Card key={sub.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{sub.account_name}</CardTitle>
                      <Badge variant={sub.status === 'active' ? 'default' : 'secondary'}>{sub.status}</Badge>
                    </div>
                    {sub.account_email && <CardDescription>{sub.account_email}</CardDescription>}
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 mb-2">
                      {sub.split_type === 'percentage' ? <Percent className="h-4 w-4 text-primary" /> : <DollarSign className="h-4 w-4 text-primary" />}
                      <span className="font-semibold">{sub.split_value}{sub.split_type === 'percentage' ? '%' : ' ZMW'}</span>
                      <span className="text-sm text-muted-foreground">per transaction</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Total received: K{Number(sub.total_received || 0).toLocaleString()}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="rules" className="mt-6">
            <div className="flex justify-end mb-4">
              <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Rule</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Create Split Rule</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Rule Name</Label><Input value={ruleForm.name} onChange={e => setRuleForm(p => ({ ...p, name: e.target.value }))} /></div>
                    <div>
                      <Label>Subaccount</Label>
                      <Select value={ruleForm.subaccount_id} onValueChange={v => setRuleForm(p => ({ ...p, subaccount_id: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select subaccount" /></SelectTrigger>
                        <SelectContent>
                          {subaccounts?.map(s => <SelectItem key={s.id} value={s.id}>{s.account_name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Split Type</Label>
                        <Select value={ruleForm.split_type} onValueChange={v => setRuleForm(p => ({ ...p, split_type: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="percentage">Percentage</SelectItem>
                            <SelectItem value="flat">Flat Amount</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Value</Label><Input type="number" value={ruleForm.split_value} onChange={e => setRuleForm(p => ({ ...p, split_value: e.target.value }))} /></div>
                    </div>
                    <Button onClick={handleCreateRule} disabled={createRule.isPending || !ruleForm.name || !ruleForm.subaccount_id} className="w-full">
                      {createRule.isPending ? 'Creating...' : 'Create Rule'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-3">
              {rules?.length === 0 ? (
                <Card><CardContent className="py-12 text-center"><GitBranch className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No split rules configured.</p></CardContent></Card>
              ) : rules?.map((rule: any) => (
                <Card key={rule.id}>
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{rule.name}</p>
                      <p className="text-sm text-muted-foreground">→ {rule.subaccounts?.account_name}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{rule.split_type === 'percentage' ? `${rule.split_value}%` : `K${rule.split_value}`}</Badge>
                      <Badge variant={rule.is_active ? 'default' : 'secondary'}>{rule.is_active ? 'Active' : 'Inactive'}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
      <Footer />
    </div>
  );
};

export default SubAccounts;
