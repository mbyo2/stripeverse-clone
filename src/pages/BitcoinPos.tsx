import React, { useCallback, useEffect, useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Bitcoin, Copy, Download, FileText, KeyRound, Loader2, Plus, RefreshCw, Store, Trash2, XCircle,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { resolveEdgeFunctionError } from '@/utils/edgeFunctionError';
import { buildPosReceiptHtml, buildPosStatementHtml, openPosPrintWindow } from '@/utils/posStatement';
import { useProfile } from '@/hooks/useProfile';
import { SkeletonTableRows } from "@/components/ui/skeletons";
import { useAuth } from '@/contexts/AuthContext';
import { useVisibilityPolling } from '@/lib/polling';

// Bitcoin POS — data bridge. This page is a merchant data tool, not a
// checkout: create a payment request at the till, the customer pays
// Bitcoin on-chain to your BMaGlass deposit address, and your existing
// POS or accounting system pulls the settled records out (JSON API
// with a POS API key, or the CSV export below) to reconcile the sale.

interface PosRequest {
  id: string;
  merchant_reference: string;
  fiat_amount_zmw: number | string;
  sats_expected: number;
  btc_zmw_rate: number | string;
  deposit_address: string;
  status: string;
  txid: string | null;
  sats_received: number | null;
  confirmations_at_detection: number | null;
  btc_zmw_rate_at_payment: number | string | null;
  paid_at: string | null;
  expires_at: string;
  created_at: string;
  bip21_uri: string;
}

interface PosApiKey {
  id: string;
  label: string;
  key_prefix: string;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  awaiting_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  underpaid: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  overpaid: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  expired: 'bg-muted text-muted-foreground',
  cancelled: 'bg-muted text-muted-foreground',
};

const statusLabel = (s: string) => s.replace(/_/g, ' ');
const satsToBtc = (sats: number) => (sats / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '.0');

async function invokePos(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('pos', { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export default function BitcoinPos() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const merchantName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ')
    || user?.email?.split('@')[0] || 'Merchant';
  const merchantEmail = user?.email ?? '';
  const [requests, setRequests] = useState<PosRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [expiryMinutes, setExpiryMinutes] = useState('120');
  const [creating, setCreating] = useState(false);
  const [active, setActive] = useState<PosRequest | null>(null);

  const [keys, setKeys] = useState<PosApiKey[]>([]);
  const [keyLabel, setKeyLabel] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);

  const [exportFrom, setExportFrom] = useState(() => format(new Date(Date.now() - 30 * 86400_000), 'yyyy-MM-dd'));
  const [exportTo, setExportTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const loadRequests = useCallback(async () => {
    try {
      const data = await invokePos({
        action: 'list_requests',
        limit: 50,
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
      });
      setRequests(data.requests ?? []);
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not load your payment requests.'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const loadKeys = useCallback(async () => {
    try {
      const data = await invokePos({ action: 'list_api_keys' });
      setKeys(data.keys ?? []);
    } catch {
      // Keys panel is secondary; a failure here is surfaced on create.
    }
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);
  useEffect(() => { loadKeys(); }, [loadKeys]);

  // Live status for the request currently on screen: poll every 15s
  // while it is still awaiting payment. Visibility-gated (scalability
  // fix #5): nothing fires from a hidden tab, one refresh lands the
  // moment the merchant looks again, and polling stops for good once
  // the request leaves awaiting_payment (paid / expired / cancelled).
  const activeId = active?.id;
  useVisibilityPolling(
    async () => {
      if (!activeId) return;
      try {
        const data = await invokePos({ action: 'get_request', id: activeId });
        if (data?.request) {
          setActive(data.request);
          if (data.request.status !== 'awaiting_payment') {
            toast.success(`Request ${data.request.merchant_reference} is now ${statusLabel(data.request.status)}.`);
            loadRequests();
          }
        }
      } catch { /* polling is best-effort */ }
    },
    15_000,
    { enabled: !!active && active.status === 'awaiting_payment' },
  );

  const handleCreate = async () => {
    if (!reference.trim()) { toast.error('Enter your till or order reference first.'); return; }
    const fiat = Number(amount);
    if (!fiat || fiat <= 0) { toast.error('Enter the amount in kwacha.'); return; }
    setCreating(true);
    try {
      const data = await invokePos({
        action: 'create_request',
        reference: reference.trim(),
        fiat_amount_zmw: fiat,
        expires_in_minutes: Number(expiryMinutes),
      });
      setActive(data.request);
      toast.success(data.reused ? 'That reference already has a request — showing it.' : 'Payment request created.');
      setReference('');
      setAmount('');
      loadRequests();
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not create the payment request.'));
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (r: PosRequest) => {
    try {
      const data = await invokePos({ action: 'cancel_request', id: r.id });
      if (active?.id === r.id) setActive(data.request);
      toast.success(`Request ${r.merchant_reference} cancelled.`);
      loadRequests();
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not cancel that request.'));
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  };

  const handleCreateKey = async () => {
    setCreatingKey(true);
    try {
      const data = await invokePos({ action: 'create_api_key', label: keyLabel.trim() || undefined });
      setNewKey(data.key);
      setKeyLabel('');
      loadKeys();
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not create an API key.'));
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (k: PosApiKey) => {
    try {
      await invokePos({ action: 'revoke_api_key', id: k.id });
      toast.success('API key revoked. Systems using it will stop working immediately.');
      loadKeys();
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not revoke that key.'));
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const data = await invokePos({
        action: 'export_csv',
        from: `${exportFrom}T00:00:00.000Z`,
        to: `${exportTo}T23:59:59.999Z`,
      });
      const blob = new Blob([data.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename ?? 'bmaglass-pos-export.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.count} request${data.count === 1 ? '' : 's'}.`);
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not export the CSV.'));
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      // The statement covers the whole range: page through the list
      // API (200 at a time, the function's page cap).
      const all: PosRequest[] = [];
      let offset = 0;
      for (;;) {
        const data = await invokePos({
          action: 'list_requests',
          from: `${exportFrom}T00:00:00.000Z`,
          to: `${exportTo}T23:59:59.999Z`,
          limit: 200,
          offset,
        });
        const page = (data.requests ?? []) as PosRequest[];
        all.push(...page);
        offset += page.length;
        if (page.length === 0 || offset >= (data.total ?? all.length) || offset >= 2000) break;
      }
      if (offset >= 2000 && all.length >= 2000) {
        toast.warning('This statement was capped at the first 2,000 requests. Narrow the dates for the rest.');
      }
      const html = buildPosStatementHtml({
        merchantName,
        merchantEmail,
        periodFrom: `${exportFrom}T00:00:00.000Z`,
        periodTo: `${exportTo}T23:59:59.999Z`,
        generatedAt: new Date(),
        rows: all,
      });
      if (!openPosPrintWindow(html)) {
        toast.error('Your browser blocked the statement window. Allow pop-ups for this site and try again.');
      }
    } catch (e) {
      toast.error(await resolveEdgeFunctionError(e, 'Could not build the PDF statement.'));
    } finally {
      setExportingPdf(false);
    }
  };

  const handleReceiptPdf = (r: PosRequest) => {
    const html = buildPosReceiptHtml({
      merchantName,
      merchantEmail,
      generatedAt: new Date(),
      request: r,
    });
    if (!openPosPrintWindow(html)) {
      toast.error('Your browser blocked the receipt window. Allow pop-ups for this site and try again.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center gap-3 mb-2">
          <Store className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Bitcoin POS — Data Bridge</h1>
        </div>
        <p className="text-muted-foreground max-w-3xl mb-8">
          Take Bitcoin at your till and let your own systems do the books. Create a request here,
          your customer pays <strong>on-chain Bitcoin</strong> to your BMaGlass deposit address, and your
          existing POS or accounting system pulls the settled records out — by API key or CSV export —
          matched to your own order references. This is not a card or mobile-money checkout, and it
          does not replace your till: it gives your till Bitcoin payment data it can reconcile.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── Create request ─────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> New payment request</CardTitle>
              <CardDescription>
                The amount is converted at the live Bitcoin price when you create the request, and
                that price is locked onto the record. A request is marked paid after{' '}
                <strong>1 network confirmation</strong> — usually minutes, but on-chain payments are
                never instant.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pos-reference">Your reference (till / order number)</Label>
                <Input id="pos-reference" value={reference} onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. TILL4-0091" maxLength={64} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pos-amount">Amount (ZMW)</Label>
                  <Input id="pos-amount" type="number" min="0" step="0.01" value={amount}
                    onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 250.00" />
                </div>
                <div className="space-y-2">
                  <Label>Time to pay</Label>
                  <Select value={expiryMinutes} onValueChange={setExpiryMinutes}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="30">30 minutes</SelectItem>
                      <SelectItem value="60">1 hour</SelectItem>
                      <SelectItem value="120">2 hours</SelectItem>
                      <SelectItem value="1440">24 hours</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={handleCreate} disabled={creating} className="w-full">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bitcoin className="h-4 w-4" />}
                Create request
              </Button>
            </CardContent>
          </Card>

          {/* ── Active request / QR ────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle>Customer payment</CardTitle>
              <CardDescription>
                {active
                  ? 'Show this to the customer. Their wallet fills in the exact Bitcoin amount.'
                  : 'Your newest request will appear here with its QR code.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {active ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={active.bip21_uri} size={200} />
                  </div>
                  <div className="text-center space-y-1">
                    <div className="text-lg font-semibold text-foreground">
                      K{Number(active.fiat_amount_zmw).toFixed(2)} · {satsToBtc(active.sats_expected)} BTC
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {active.sats_expected.toLocaleString()} sats · reference {active.merchant_reference}
                    </div>
                    <Badge className={STATUS_STYLES[active.status] ?? ''}>{statusLabel(active.status)}</Badge>
                    {active.status === 'awaiting_payment' && (
                      <div className="text-xs text-muted-foreground">
                        Waiting for payment · expires {format(new Date(active.expires_at), 'HH:mm, d MMM')}
                      </div>
                    )}
                    {(active.status === 'underpaid' || active.status === 'overpaid') && active.sats_received != null && (
                      <div className="text-xs text-muted-foreground">
                        Received {active.sats_received.toLocaleString()} sats of {active.sats_expected.toLocaleString()} expected.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full">
                    <Input readOnly value={active.deposit_address} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => copy(active.deposit_address, 'Address')}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    This is your BMaGlass Bitcoin deposit address — the same one as in your Bitcoin
                    wallet. Payments to it are matched to open requests automatically.
                  </p>
                  <Button variant="outline" onClick={() => handleReceiptPdf(active)} className="w-full">
                    <FileText className="h-4 w-4" /> Receipt (PDF)
                  </Button>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-10">
                  No request selected. Create one, or pick one from the list below.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Requests list ────────────────────────────────── */}
        <Card className="mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Payment requests</CardTitle>
                <CardDescription>What your till and accounting system reconcile against.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="awaiting_payment">Awaiting payment</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="underpaid">Underpaid</SelectItem>
                    <SelectItem value="overpaid">Overpaid</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="icon" onClick={loadRequests}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <SkeletonTableRows rows={5} />
            ) : requests.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No payment requests yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b border-border">
                      <th className="py-2 pr-3 font-medium">Reference</th>
                      <th className="py-2 pr-3 font-medium">Created</th>
                      <th className="py-2 pr-3 font-medium">Amount</th>
                      <th className="py-2 pr-3 font-medium">Expected</th>
                      <th className="py-2 pr-3 font-medium">Received</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id} className="border-b border-border/60 hover:bg-muted/40 cursor-pointer"
                        onClick={() => setActive(r)}>
                        <td className="py-2 pr-3 font-mono text-xs">{r.merchant_reference}</td>
                        <td className="py-2 pr-3">{format(new Date(r.created_at), 'd MMM HH:mm')}</td>
                        <td className="py-2 pr-3">K{Number(r.fiat_amount_zmw).toFixed(2)}</td>
                        <td className="py-2 pr-3">{r.sats_expected.toLocaleString()} sats</td>
                        <td className="py-2 pr-3">{r.sats_received != null ? `${r.sats_received.toLocaleString()} sats` : '—'}</td>
                        <td className="py-2 pr-3">
                          <Badge className={STATUS_STYLES[r.status] ?? ''}>{statusLabel(r.status)}</Badge>
                        </td>
                        <td className="py-2 text-right">
                          {r.status === 'awaiting_payment' && (
                            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleCancel(r); }}>
                              <XCircle className="h-4 w-4" /> Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2 mt-6">
          {/* ── API keys ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> POS API keys</CardTitle>
              <CardDescription>
                Your POS or accounting system reads payment requests with one of these keys
                (read-only). Send it as <span className="font-mono text-xs">Authorization: Bearer &lt;key&gt;</span>{' '}
                to the POS API. A key is shown once — store it in your system, not on paper.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input value={keyLabel} onChange={(e) => setKeyLabel(e.target.value)}
                  placeholder="Label, e.g. Shop till system" maxLength={80} />
                <Button onClick={handleCreateKey} disabled={creatingKey}>
                  {creatingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create
                </Button>
              </div>
              {newKey && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40 p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground">Copy this key now — it will never be shown again.</p>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={newKey} className="font-mono text-xs" />
                    <Button variant="outline" size="icon" onClick={() => copy(newKey, 'API key')}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {keys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No API keys yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {keys.map((k) => (
                    <li key={k.id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">{k.label}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {k.key_prefix}… · created {format(new Date(k.created_at), 'd MMM yyyy')}
                          {k.last_used_at ? ` · last used ${format(new Date(k.last_used_at), 'd MMM HH:mm')}` : ' · never used'}
                        </div>
                      </div>
                      {k.revoked ? (
                        <Badge className="bg-muted text-muted-foreground">revoked</Badge>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => handleRevokeKey(k)}>
                          <Trash2 className="h-4 w-4" /> Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── CSV export ───────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" /> Export for accounting</CardTitle>
              <CardDescription>
                One row per request: date, reference, status, kwacha amount, sats expected and
                received, the Bitcoin price used, the transaction id and when it was paid — ready
                to import into your accounting system.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pos-export-from">From</Label>
                  <Input id="pos-export-from" type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pos-export-to">To</Label>
                  <Input id="pos-export-to" type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} />
                </div>
              </div>
              <Button onClick={handleExport} disabled={exporting} className="w-full">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download CSV
              </Button>
              <Button onClick={handleExportPdf} disabled={exportingPdf} variant="outline" className="w-full">
                {exportingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Export statement (PDF)
              </Button>
              <p className="text-xs text-muted-foreground">
                The PDF statement is a designed document for the same dates — your name, a summary
                of what was collected, and every request itemised — ready to print, save or send to
                your accountant.
              </p>
              <p className="text-xs text-muted-foreground">
                Prefer a live connection? Your system can also poll the POS API with an API key:
                list requests, or look one up by your reference, and reconcile as payments confirm.
              </p>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
