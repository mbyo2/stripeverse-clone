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
import { Users, Plus, Percent, DollarSign, GitBranch, Info } from 'lucide-react';
import { useSubaccounts, useCreateSubaccount, useSplitRules, useCreateSplitRule } from '@/hooks/useSubaccounts';
import { committedPercentage, splitRulesWarning } from '@/utils/splitPayments';

const SplitPayments = () => {
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
            <h1 className="text-3xl font-bold">Split Payments</h1>
            <p className="text-muted-foreground">Recipients and rules that automatically divide the payments you receive through your payment links</p>
          </div>
        </div>

        <Card className="mb-8">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><Info className="h-4 w-4" />How splits execute</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>When a payment settles through one of your payment links — paid from a BMaGlass wallet or through a gateway — your active rules run in the same moment, before the money is yours to spend.</p>
            <p>Each rule moves its share out of the wallet the payment landed in and into the recipient's <span className="text-foreground font-medium">BMaGlass Main wallet</span>, in the payment's currency. Every split shows in both your history and the recipient's, and counts toward their "Total received" below.</p>
            <p>Recipients are matched by email: the email saved on a recipient must be the email of their BMaGlass account. If there is no BMaGlass account under that email, that share is <span className="text-foreground font-medium">not sent anywhere — it stays in your wallet</span>. Splits are never paid out to bank accounts.</p>
            <p>Rules are paid in the order they were created and can never add up to more than the payment itself. Whatever is left after every rule is yours.</p>
          </CardContent>
        </Card>

        <Tabs defaultValue="subaccounts">
          <TabsList>
            <TabsTrigger value="subaccounts">Split Recipients</TabsTrigger>
            <TabsTrigger value="rules">Split Rules</TabsTrigger>
          </TabsList>

          <TabsContent value="subaccounts" className="mt-6">
            <div className="flex justify-end mb-4">
              <Dialog open={subOpen} onOpenChange={setSubOpen}>
                <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Add Recipient</Button></DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Add Split Recipient</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div><Label>Recipient Name</Label><Input value={subForm.account_name} onChange={e => setSubForm(p => ({ ...p, account_name: e.target.value }))} placeholder="e.g. Partner Revenue" /></div>
                    <div>
                      <Label>Recipient's BMaGlass account email</Label>
                      <Input type="email" value={subForm.account_email} onChange={e => setSubForm(p => ({ ...p, account_email: e.target.value }))} placeholder="The email they sign in to BMaGlass with" />
                      <p className="text-xs text-muted-foreground mt-1">Splits are delivered to a BMaGlass wallet, matched by this email. If no account exists under it, this recipient's share stays in your wallet instead.</p>
                    </div>
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
                    <Button onClick={handleCreateSub} disabled={createSub.isPending || !subForm.account_name || !subForm.account_email || !subForm.split_value} className="w-full">
                      {createSub.isPending ? 'Creating...' : 'Create Recipient'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {isLoading ? <p className="text-muted-foreground">Loading...</p> : subaccounts?.length === 0 ? (
                <Card className="col-span-full"><CardContent className="py-12 text-center"><Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" /><p className="text-muted-foreground">No split recipients yet.</p></CardContent></Card>
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
                    {!sub.account_email && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">No account email saved — this recipient can't receive splits. Create the recipient again with their BMaGlass account email to pay them.</p>
                    )}
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
                      <Label>Recipient</Label>
                      <Select value={ruleForm.subaccount_id} onValueChange={v => setRuleForm(p => ({ ...p, subaccount_id: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select recipient" /></SelectTrigger>
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
                    {(() => {
                      const prospective = [
                        ...(rules ?? []).filter((r: any) => r.is_active),
                        ...(ruleForm.split_type === 'percentage' && Number(ruleForm.split_value) > 0
                          ? [{ id: 'new', split_type: 'percentage', split_value: Number(ruleForm.split_value) }]
                          : []),
                      ];
                      const warning = splitRulesWarning(prospective);
                      return warning ? <p className="text-xs text-amber-600 dark:text-amber-400">{warning}</p> : null;
                    })()}
                    <Button onClick={handleCreateRule} disabled={createRule.isPending || !ruleForm.name || !ruleForm.subaccount_id} className="w-full">
                      {createRule.isPending ? 'Creating...' : 'Create Rule'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-3">
              {rules && rules.length > 0 && (() => {
                const activeRules = rules.filter((r: any) => r.is_active);
                const pctTotal = committedPercentage(activeRules);
                const flatTotal = activeRules
                  .filter((r: any) => r.split_type === 'flat' && Number(r.split_value) > 0)
                  .reduce((s: number, r: any) => s + Number(r.split_value), 0);
                const warning = splitRulesWarning(activeRules);
                return (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>
                      Your active rules divert{' '}
                      <span className="text-foreground font-medium">
                        {pctTotal > 0 ? `${pctTotal}%` : ''}{pctTotal > 0 && flatTotal > 0 ? ' plus ' : ''}{flatTotal > 0 ? `K${flatTotal} flat` : ''}{pctTotal === 0 && flatTotal === 0 ? 'nothing' : ''}
                      </span>{' '}
                      of every payment-link payment you receive, paid in creation order. The rest is yours.
                    </p>
                    {warning && <p className="text-amber-600 dark:text-amber-400">{warning}</p>}
                  </div>
                );
              })()}
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

export default SplitPayments;
