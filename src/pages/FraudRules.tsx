import { useState } from 'react';
import Header from '@/components/Header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useFraudRules } from '@/hooks/useFraudRules';
import { ShieldAlert, Plus, Activity } from 'lucide-react';

const FraudRules = () => {
  const { rules, createRule, toggleRule } = useFraudRules();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', rule_type: 'velocity', action: 'flag', severity: 'medium', conditions: '' });

  const handleCreate = () => {
    let conditions = {};
    try { conditions = JSON.parse(form.conditions || '{}'); } catch { conditions = { raw: form.conditions }; }
    createRule.mutate({ ...form, conditions }, { onSuccess: () => { setOpen(false); setForm({ name: '', description: '', rule_type: 'velocity', action: 'flag', severity: 'medium', conditions: '' }); } });
  };

  const severityColors: Record<string, string> = { low: 'bg-success/10 text-success', medium: 'bg-warning/10 text-warning', high: 'bg-destructive/10 text-destructive', critical: 'bg-destructive text-destructive-foreground' };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 px-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Fraud Rules Engine</h1>
            <p className="text-muted-foreground">Configure transaction monitoring rules</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> New Rule</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Create Fraud Rule</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Name</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
                <div><Label>Description</Label><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Type</Label>
                    <Select value={form.rule_type} onValueChange={v => setForm(p => ({ ...p, rule_type: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="velocity">Velocity</SelectItem>
                        <SelectItem value="amount">Amount Threshold</SelectItem>
                        <SelectItem value="geofencing">Geofencing</SelectItem>
                        <SelectItem value="pattern">Pattern</SelectItem>
                        <SelectItem value="device">Device</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Action</Label>
                    <Select value={form.action} onValueChange={v => setForm(p => ({ ...p, action: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flag">Flag for Review</SelectItem>
                        <SelectItem value="block">Block</SelectItem>
                        <SelectItem value="require_2fa">Require 2FA</SelectItem>
                        <SelectItem value="notify">Notify Only</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Severity</Label>
                  <Select value={form.severity} onValueChange={v => setForm(p => ({ ...p, severity: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['low', 'medium', 'high', 'critical'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Conditions (JSON)</Label><Textarea placeholder='{"max_amount": 10000, "time_window": "1h", "max_count": 5}' value={form.conditions} onChange={e => setForm(p => ({ ...p, conditions: e.target.value }))} /></div>
                <Button onClick={handleCreate} disabled={!form.name} className="w-full">Create Rule</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3">
          {rules.data?.map(rule => (
            <Card key={rule.id}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <ShieldAlert className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{rule.name}</p>
                    <p className="text-sm text-muted-foreground">{rule.description || rule.rule_type} • {rule.action}</p>
                    <div className="flex gap-2 mt-1">
                      <Badge className={severityColors[rule.severity] || ''}>{rule.severity}</Badge>
                      <Badge variant="outline">{rule.rule_type}</Badge>
                      {rule.hits_count > 0 && <Badge variant="secondary">{rule.hits_count} hits</Badge>}
                    </div>
                  </div>
                </div>
                <Switch checked={rule.is_active} onCheckedChange={v => toggleRule.mutate({ id: rule.id, is_active: v })} />
              </CardContent>
            </Card>
          ))}
          {!rules.data?.length && (
            <Card><CardContent className="py-12 text-center text-muted-foreground">
              <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No fraud rules configured. Add rules to monitor transactions.</p>
            </CardContent></Card>
          )}
        </div>
      </main>
    </div>
  );
};

export default FraudRules;
