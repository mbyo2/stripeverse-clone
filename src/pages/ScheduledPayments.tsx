import { useState } from 'react';
import { format } from 'date-fns';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useScheduledPayments, CreateScheduledPaymentInput } from '@/hooks/useScheduledPayments';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  CalendarIcon,
  Clock,
  Plus,
  Pause,
  Play,
  Trash2,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
} from 'lucide-react';

const frequencies = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 Weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  paused: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  completed: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
};

const ScheduledPayments = () => {
  const { payments, isLoading, createPayment, updateStatus, deletePayment } = useScheduledPayments();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [form, setForm] = useState({
    recipient_name: '',
    recipient_account: '',
    recipient_bank: '',
    amount: '',
    frequency: 'monthly',
    description: '',
    max_runs: '',
  });

  const handleCreate = () => {
    if (!form.recipient_name || !form.amount || !startDate) return;

    const input: CreateScheduledPaymentInput = {
      recipient_name: form.recipient_name,
      recipient_account: form.recipient_account || undefined,
      recipient_bank: form.recipient_bank || undefined,
      amount: parseFloat(form.amount),
      frequency: form.frequency,
      description: form.description || undefined,
      next_run_at: startDate.toISOString(),
      end_date: endDate?.toISOString(),
      max_runs: form.max_runs ? parseInt(form.max_runs) : undefined,
    };

    createPayment.mutate(input, {
      onSuccess: () => {
        setDialogOpen(false);
        setForm({ recipient_name: '', recipient_account: '', recipient_bank: '', amount: '', frequency: 'monthly', description: '', max_runs: '' });
        setStartDate(undefined);
        setEndDate(undefined);
      },
    });
  };

  const activePayments = payments.filter((p) => p.status === 'active');
  const otherPayments = payments.filter((p) => p.status !== 'active');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="pt-20 pb-24 md:pb-12 px-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Scheduled Payments</h1>
            <p className="text-muted-foreground mt-1">Automate recurring payments on your schedule</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Schedule
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Scheduled Payment</DialogTitle>
                <DialogDescription>Set up an automatic recurring payment</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Recipient Name *</Label>
                  <Input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} placeholder="John Doe" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input value={form.recipient_account} onChange={(e) => setForm({ ...form, recipient_account: e.target.value })} placeholder="Optional" />
                  </div>
                  <div className="space-y-2">
                    <Label>Bank</Label>
                    <Input value={form.recipient_bank} onChange={(e) => setForm({ ...form, recipient_bank: e.target.value })} placeholder="Optional" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Amount (ZMW) *</Label>
                    <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0.00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Frequency *</Label>
                    <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {frequencies.map((f) => (
                          <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Rent, subscription, etc." />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !startDate && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {startDate ? format(startDate, 'PPP') : 'Pick date'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={startDate} onSelect={setStartDate} disabled={(d) => d < new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>End Date</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn('w-full justify-start text-left font-normal', !endDate && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {endDate ? format(endDate, 'PPP') : 'Optional'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={endDate} onSelect={setEndDate} disabled={(d) => d < new Date()} initialFocus className="p-3 pointer-events-auto" />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Max Runs</Label>
                  <Input type="number" value={form.max_runs} onChange={(e) => setForm({ ...form, max_runs: e.target.value })} placeholder="Unlimited" />
                </div>
                <Button onClick={handleCreate} disabled={createPayment.isPending} className="w-full">
                  {createPayment.isPending ? 'Creating...' : 'Create Scheduled Payment'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardContent className="h-24" />
              </Card>
            ))}
          </div>
        ) : payments.length === 0 ? (
          <Card className="text-center py-16">
            <CardContent>
              <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">No scheduled payments</h3>
              <p className="text-muted-foreground mb-6">Set up automatic recurring payments to save time</p>
              <Button onClick={() => setDialogOpen(true)} className="gap-2">
                <Plus className="h-4 w-4" /> Create Your First Schedule
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {activePayments.length > 0 && (
              <div>
                <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-primary" /> Active Schedules
                </h2>
                <div className="grid gap-4">
                  {activePayments.map((p) => (
                    <PaymentCard key={p.id} payment={p} onPause={() => updateStatus.mutate({ id: p.id, status: 'paused' })} onDelete={() => deletePayment.mutate(p.id)} />
                  ))}
                </div>
              </div>
            )}

            {otherPayments.length > 0 && (
              <div>
                <Separator className="mb-6" />
                <h2 className="text-lg font-semibold text-muted-foreground mb-4">Past & Paused</h2>
                <div className="grid gap-4">
                  {otherPayments.map((p) => (
                    <PaymentCard
                      key={p.id}
                      payment={p}
                      onResume={p.status === 'paused' ? () => updateStatus.mutate({ id: p.id, status: 'active' }) : undefined}
                      onDelete={() => deletePayment.mutate(p.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
};

interface PaymentCardProps {
  payment: any;
  onPause?: () => void;
  onResume?: () => void;
  onDelete: () => void;
}

const PaymentCard = ({ payment, onPause, onResume, onDelete }: PaymentCardProps) => {
  const freq = frequencies.find((f) => f.value === payment.frequency)?.label || payment.frequency;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <ArrowUpRight className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-semibold text-foreground truncate">{payment.recipient_name}</p>
              <Badge variant="outline" className={cn('text-xs', statusColors[payment.status])}>
                {payment.status}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {freq} · {payment.description || 'No description'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Next: {payment.status === 'active' ? format(new Date(payment.next_run_at), 'PPP') : '—'}
              {payment.total_runs > 0 && ` · ${payment.total_runs} runs`}
              {payment.max_runs && ` / ${payment.max_runs}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-lg font-bold text-foreground">
            {payment.currency} {Number(payment.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          <div className="flex gap-1">
            {onPause && (
              <Button variant="ghost" size="icon" onClick={onPause} title="Pause">
                <Pause className="h-4 w-4" />
              </Button>
            )}
            {onResume && (
              <Button variant="ghost" size="icon" onClick={onResume} title="Resume">
                <Play className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={onDelete} title="Delete" className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScheduledPayments;
