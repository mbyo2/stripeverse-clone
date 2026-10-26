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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Link2, Plus, Copy, ExternalLink, XCircle, DollarSign, Eye, Pencil, Wallet } from 'lucide-react';
import { usePaymentLinks, useCreatePaymentLink, useUpdatePaymentLink, useDeactivatePaymentLink, useFeePayerDefault } from '@/hooks/usePaymentLinks';
import { useAccounts } from '@/hooks/useAccounts';
import { usePlatformSettings } from '@/hooks/useSubaccounts';
import { computePaymentLinkBreakdown, type FeePayer } from '@/utils/splitPayments';
import { settlementTargetLabel, selectableSettlementAccounts } from '@/utils/paymentLinkSettlement';
import { toast } from 'sonner';
import { format } from 'date-fns';

/** Sentinel for the Main account in the settlement picker (Radix Select needs a non-empty value). */
const MAIN_ACCOUNT_VALUE = 'main';

/**
 * The fee-bearer choice (CEO order, 2026-10-26): two plain options
 * with LIVE numbers for the amount in the form, so the seller decides
 * with the real figures in front of them — "You receive K97.50 ·
 * buyer pays K100.00" vs "You receive K100.00 · buyer pays K102.50".
 * Used by both the create and edit dialogs; the value starts from the
 * merchant's account default (create) or the link's stored choice
 * (edit) and is stored on the link — settlement enforces it.
 */
const FeePayerChoice = ({ amount, rate, value, onChange, fmtFee }: {
  amount: number; rate: number; value: FeePayer;
  onChange: (v: FeePayer) => void; fmtFee: (n: number) => string;
}) => {
  const b = computePaymentLinkBreakdown(amount, rate, value);
  const sellerBd = computePaymentLinkBreakdown(amount, rate, 'seller');
  const buyerBd = computePaymentLinkBreakdown(amount, rate, 'buyer');
  const options: { key: FeePayer; title: string; detail: string }[] = amount > 0 ? [
    {
      key: 'seller', title: 'I pay the fee',
      detail: `You receive ${fmtFee(sellerBd.sellerReceives)} · buyer pays ${fmtFee(sellerBd.buyerPays)}`,
    },
    {
      key: 'buyer', title: 'Buyer pays the fee',
      detail: `You receive ${fmtFee(buyerBd.sellerReceives)} · buyer pays ${fmtFee(buyerBd.buyerPays)}`,
    },
  ] : [
    {
      key: 'seller', title: 'I pay the fee',
      detail: `The ${rate}% platform fee comes out of what you receive on each payment.`,
    },
    {
      key: 'buyer', title: 'Buyer pays the fee',
      detail: `The ${rate}% platform fee is added on top of the amount the buyer enters — you receive the full amount.`,
    },
  ];
  return (
    <div>
      <Label>Who pays the {rate}% platform fee?</Label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2" role="radiogroup" aria-label="Who pays the platform fee">
        {options.map(o => (
          <button
            key={o.key} type="button" role="radio" aria-checked={value === o.key}
            onClick={() => onChange(o.key)}
            className={`text-left rounded-lg border p-3 transition-colors ${value === o.key ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'}`}
          >
            <span className="block text-sm font-medium">{o.title}</span>
            <span className="block text-xs text-muted-foreground mt-1">{o.detail}</span>
          </button>
        ))}
      </div>
      {amount > 0 && (
        <p className="text-xs text-muted-foreground mt-2">
          Platform fee on {fmtFee(b.price)}: {fmtFee(b.platformFee)}.
        </p>
      )}
    </div>
  );
};

const PaymentLinks = () => {
  const { data: links, isLoading } = usePaymentLinks();
  const { data: accounts } = useAccounts();
  const createLink = useCreatePaymentLink();
  const updateLink = useUpdatePaymentLink();
  const deactivateLink = useDeactivatePaymentLink();
  const [open, setOpen] = useState(false);
  const [fixedAmount, setFixedAmount] = useState(true);
  const [form, setForm] = useState({ title: '', description: '', amount: '', max_payments: '' });
  const [settleAccount, setSettleAccount] = useState(MAIN_ACCOUNT_VALUE);
  const [feePayer, setFeePayer] = useState<FeePayer>('seller');

  const [editLinkId, setEditLinkId] = useState<string | null>(null);
  const [editFixedAmount, setEditFixedAmount] = useState(true);
  const [editForm, setEditForm] = useState({ title: '', description: '', amount: '', max_payments: '' });
  const [editSettleAccount, setEditSettleAccount] = useState(MAIN_ACCOUNT_VALUE);
  const [editFeePayer, setEditFeePayer] = useState<FeePayer>('seller');

  const settlementOptions = selectableSettlementAccounts(accounts ?? []);

  // Platform fee disclosure + the fee-bearer choice. Every
  // payment-link settlement pays the BMaGlass Pay platform fee (the
  // rate is platform_settings.split_platform_fee_percent, 2.5% at
  // launch). WHO funds it is the seller's choice (CEO order
  // 2026-10-26): out of the seller's side, or added on top for the
  // buyer. The create form starts from the merchant's account
  // default (Settings → Payment) and can be changed per link; the
  // stored choice is what execute_payment_link_settlement enforces.
  // Wave B QA (2026-10-24) found the fee was disclosed nowhere before
  // the fact — a K2.00 link payment simply landed as K1.95.
  const { data: platformSettings } = usePlatformSettings();
  const { data: feePayerDefault } = useFeePayerDefault();
  const platformFeeRate = Number(platformSettings?.split_platform_fee_percent ?? 2.5);
  const fmtFee = (n: number) => `K${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const handleCreate = () => {
    createLink.mutate({
      title: form.title, description: form.description,
      amount: fixedAmount && form.amount ? Number(form.amount) : undefined,
      max_payments: form.max_payments ? Number(form.max_payments) : undefined,
      account_id: settleAccount === MAIN_ACCOUNT_VALUE ? null : settleAccount,
      fee_payer: feePayer,
    }, { onSuccess: () => { setOpen(false); setForm({ title: '', description: '', amount: '', max_payments: '' }); setSettleAccount(MAIN_ACCOUNT_VALUE); setFeePayer(feePayerDefault ?? 'seller'); } });
  };

  const openEdit = (link: NonNullable<typeof links>[number]) => {
    setEditLinkId(link.id);
    setEditFixedAmount(link.amount != null);
    setEditForm({
      title: link.title,
      description: link.description ?? '',
      amount: link.amount != null ? String(link.amount) : '',
      max_payments: link.max_payments != null ? String(link.max_payments) : '',
    });
    setEditSettleAccount(link.account_id ?? MAIN_ACCOUNT_VALUE);
    setEditFeePayer(link.fee_payer === 'buyer' ? 'buyer' : 'seller');
  };

  const handleEdit = () => {
    if (!editLinkId) return;
    updateLink.mutate({
      id: editLinkId,
      title: editForm.title,
      description: editForm.description || undefined,
      amount: editFixedAmount && editForm.amount ? Number(editForm.amount) : null,
      max_payments: editForm.max_payments ? Number(editForm.max_payments) : null,
      account_id: editSettleAccount === MAIN_ACCOUNT_VALUE ? null : editSettleAccount,
      fee_payer: editFeePayer,
    }, { onSuccess: () => setEditLinkId(null) });
  };

  const copyLink = (code: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/pay/${code}`);
    toast.success('Payment link copied!');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[28px] leading-tight font-display font-semibold">Payment Links</h1>
            <p className="text-sm text-muted-foreground mt-1">Create shareable checkout pages to collect payments</p>
          </div>
          <Dialog open={open} onOpenChange={o => { setOpen(o); if (o) setFeePayer(feePayerDefault ?? 'seller'); }}>
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
                <FeePayerChoice amount={fixedAmount ? Number(form.amount) || 0 : 0} rate={platformFeeRate} value={feePayer} onChange={setFeePayer} fmtFee={fmtFee} />
                <p className="text-xs text-muted-foreground">This starts from your account default. Change the default for new links any time in Settings → Payment.</p>
                <div><Label>Max Payments (optional)</Label><Input type="number" value={form.max_payments} onChange={e => setForm(p => ({ ...p, max_payments: e.target.value }))} placeholder="Unlimited" /></div>
                <div>
                  <Label>Settles Into</Label>
                  <Select value={settleAccount} onValueChange={setSettleAccount}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MAIN_ACCOUNT_VALUE}>Main account</SelectItem>
                      {settlementOptions.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}{a.status === 'frozen' ? ' (frozen)' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Payments to this link land in the chosen account's wallet.</p>
                </div>
                <Button onClick={handleCreate} disabled={createLink.isPending || !form.title} className="w-full">
                  {createLink.isPending ? 'Creating...' : 'Create Payment Link'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={editLinkId !== null} onOpenChange={o => { if (!o) setEditLinkId(null); }}>
            <DialogContent>
              <DialogHeader><DialogTitle>Edit Payment Link</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div><Label>Title</Label><Input value={editForm.title} onChange={e => setEditForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. Product Purchase" /></div>
                <div><Label>Description</Label><Textarea value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} placeholder="What is this payment for?" /></div>
                <div className="flex items-center justify-between">
                  <Label>Fixed Amount</Label>
                  <Switch checked={editFixedAmount} onCheckedChange={setEditFixedAmount} />
                </div>
                {editFixedAmount && <div><Label>Amount (ZMW)</Label><Input type="number" value={editForm.amount} onChange={e => setEditForm(p => ({ ...p, amount: e.target.value }))} /></div>}
                <FeePayerChoice amount={editFixedAmount ? Number(editForm.amount) || 0 : 0} rate={platformFeeRate} value={editFeePayer} onChange={setEditFeePayer} fmtFee={fmtFee} />
                <div><Label>Max Payments (optional)</Label><Input type="number" value={editForm.max_payments} onChange={e => setEditForm(p => ({ ...p, max_payments: e.target.value }))} placeholder="Unlimited" /></div>
                <div>
                  <Label>Settles Into</Label>
                  <Select value={editSettleAccount} onValueChange={setEditSettleAccount}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MAIN_ACCOUNT_VALUE}>Main account</SelectItem>
                      {settlementOptions.map(a => (
                        <SelectItem key={a.id} value={a.id}>{a.name}{a.status === 'frozen' ? ' (frozen)' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">Payments to this link land in the chosen account's wallet.</p>
                </div>
                <Button onClick={handleEdit} disabled={updateLink.isPending || !editForm.title} className="w-full">
                  {updateLink.isPending ? 'Saving...' : 'Save Changes'}
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
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                        <Wallet className="h-3.5 w-3.5" />
                        <span>Settles to: {settlementTargetLabel(link.account_id, accounts ?? [])}</span>
                      </div>
                      {link.amount != null && Number(link.amount) > 0 && (() => {
                        const bd = computePaymentLinkBreakdown(Number(link.amount), platformFeeRate, link.fee_payer === 'buyer' ? 'buyer' : 'seller');
                        return (
                          <p className="text-xs text-muted-foreground mt-1">
                            {link.fee_payer === 'buyer'
                              ? <>Buyer pays {fmtFee(bd.buyerPays)} ({fmtFee(bd.price)} + {fmtFee(bd.platformFee)} fee) — you receive the full {fmtFee(bd.sellerReceives)}.</>
                              : <>You receive {fmtFee(bd.sellerReceives)} of each {fmtFee(bd.price)} payment ({platformFeeRate}% platform fee).</>}
                          </p>
                        );
                      })()}
                      <div className="mt-2 p-2 rounded bg-muted/50 text-xs font-mono truncate">
                        {window.location.origin}/pay/{link.link_code}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button size="sm" variant="outline" onClick={() => copyLink(link.link_code)}><Copy className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => window.open(`/pay/${link.link_code}`, '_blank')}><ExternalLink className="h-3 w-3" /></Button>
                      <Button size="sm" variant="outline" onClick={() => openEdit(link)}><Pencil className="h-3 w-3" /></Button>
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
