import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode.react';
import {
  AlertCircle,
  Bitcoin,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Store,
  Zap,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useVisibilityPolling } from '@/lib/polling';
import { toUserFacingError } from '@/utils/userFacingError';

/**
 * "Pay with Bitcoin" on the public payment-link page (CEO order
 * 2026-10-26): a guest with NO BMaGlass account pays from whatever
 * Bitcoin wallet they already use. Creating an attempt locks a quote
 * (60 minutes) and returns a fresh per-attempt on-chain address and,
 * when available, a Lightning invoice; this component polls the
 * attempt status and shows the honest state — waiting, detected,
 * underpaid, paid, expired, or a plain-language reason it could not
 * complete. The same hosted page serves every shop connector
 * (WooCommerce, Odoo, PrestaShop, Magento, OpenCart, embed, SDKs),
 * so all of them offer QR Bitcoin checkout with no connector change.
 */

type AttemptState =
  | 'waiting'
  | 'detected'
  | 'underpaid'
  | 'paid'
  | 'expired'
  | 'partial_credited'
  | 'failed';

interface BtcAttempt {
  id: string;
  state: AttemptState;
  fiat_amount: number;
  fiat_currency: string;
  fee_payer: 'seller' | 'buyer';
  amount_sats: number;
  fee_sats: number;
  required_sats: number;
  seen_sats: number;
  received_sats: number;
  remaining_sats: number;
  onchain_address: string | null;
  lightning_invoice: string | null;
  expires_at: string;
  failure_reason: string | null;
}

interface Props {
  linkCode: string;
  /** Resolved fiat amount for open links; null on fixed-amount links
   *  (the server uses the link's own amount). */
  amount: number | null;
  currency: string;
  /** The link's return URL, when it carries one (shop checkouts). */
  redirectUrl: string | null;
  /** The rail the buyer picked at the method level on the pay page
   *  ("Bitcoin" = on-chain, "Lightning"). The tabs follow it and stay
   *  switchable here — one attempt carries both rails. */
  initialRail?: 'onchain' | 'lightning';
}

/** Whole sats → BTC string, 8dp trimmed (display only). */
function btc(sats: number): string {
  const whole = Math.floor(sats / 100_000_000);
  const frac = sats % 100_000_000;
  if (frac === 0) return `${whole}`;
  const fracStr = frac.toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole}.${fracStr}`;
}

function bip21(address: string, sats: number): string {
  return `bitcoin:${address}?amount=${btc(sats)}`;
}

function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const TERMINAL: AttemptState[] = ['paid', 'expired', 'partial_credited', 'failed'];

export default function BitcoinLinkPayment({ linkCode, amount, currency, redirectUrl, initialRail }: Props) {
  const { toast } = useToast();
  const [attempt, setAttempt] = useState<BtcAttempt | null>(null);
  const [rail, setRail] = useState<'onchain' | 'lightning'>(initialRail ?? 'onchain');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'address' | 'invoice' | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const attemptIdRef = useRef<string | null>(null);

  // Follow the buyer's method-level rail choice (switching tiles on
  // the pay page must not mint a second attempt — the same attempt
  // carries the address AND the invoice).
  useEffect(() => {
    if (initialRail) setRail(initialRail);
  }, [initialRail]);

  const createAttempt = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const { data, error } = await supabase.functions.invoke('payment-link-checkout', {
        body: {
          action: 'btc_create_attempt',
          link_code: linkCode,
          ...(amount != null ? { amount } : {}),
        },
      });
      if (error) {
        let message = 'Bitcoin payment could not be started.';
        const context = (error as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === 'string') message = payload.error;
          } catch { /* keep the fallback */ }
        }
        throw new Error(message);
      }
      if (!data?.success || !data?.attempt) {
        throw new Error(data?.error || 'Bitcoin payment could not be started.');
      }
      attemptIdRef.current = (data.attempt as BtcAttempt).id;
      setAttempt(data.attempt as BtcAttempt);
    } catch (err) {
      setCreateError(toUserFacingError(err, 'Bitcoin payment could not be started. Please try again.'));
    } finally {
      setCreating(false);
    }
  }, [linkCode, amount]);

  useEffect(() => {
    void createAttempt();
    // One attempt per mount / explicit restart — amount changes are
    // handled by the "new payment" affordance below, not silently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkCode]);

  const pollStatus = useCallback(async () => {
    const id = attemptIdRef.current;
    if (!id) return;
    try {
      const { data } = await supabase.functions.invoke('payment-link-checkout', {
        body: { action: 'btc_status', link_code: linkCode, attempt_id: id },
      });
      if (data?.success && data?.attempt) setAttempt(data.attempt as BtcAttempt);
    } catch {
      /* a missed poll is not an error state — the next one retries */
    }
  }, [linkCode]);

  const isTerminal = attempt ? TERMINAL.includes(attempt.state) : true;
  useVisibilityPolling(() => { void pollStatus(); }, 10_000, {
    enabled: !!attempt && !isTerminal,
  });

  // Display-only countdown tick.
  useEffect(() => {
    if (!attempt || isTerminal) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [attempt, isTerminal]);

  const copy = async (text: string, field: 'address' | 'invoice') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast({
        title: 'Copied',
        description: field === 'address' ? 'Bitcoin address copied' : 'Lightning invoice copied',
      });
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      toast({ title: 'Copy failed — long-press to copy manually', variant: 'destructive' });
    }
  };

  if (creating && !attempt) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Setting up your Bitcoin payment…</p>
      </div>
    );
  }

  if (createError && !attempt) {
    return (
      <div className="space-y-4 py-4 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
        <p className="text-sm text-muted-foreground">{createError}</p>
        <Button onClick={() => void createAttempt()} className="w-full">
          Try again
        </Button>
      </div>
    );
  }

  if (!attempt) return null;

  const amountChanged =
    amount != null && Math.abs(amount - attempt.fiat_amount) > 0.001;
  const timeLeft = new Date(attempt.expires_at).getTime() - now;

  return (
    <div className="space-y-4">
      {/* ── State banner ── */}
      {attempt.state === 'waiting' && (
        <div className="flex gap-3 rounded-lg bg-muted p-3 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            <span className="font-medium">Waiting for your payment.</span>{' '}
            Send <span className="font-medium">{btc(attempt.required_sats)} BTC</span>{' '}
            ({attempt.required_sats.toLocaleString()} sats) within{' '}
            <span className="font-medium">{mmss(timeLeft)}</span> — the price is locked
            until then.
            {attempt.fee_payer === 'buyer' && attempt.fee_sats > 0 && (
              <> The total includes the payment fee, so the seller receives the full{' '}
              {attempt.fiat_currency} {attempt.fiat_amount.toFixed(2)}.</>
            )}
          </p>
        </div>
      )}
      {attempt.state === 'detected' && (
        <div className="flex gap-3 rounded-lg bg-muted p-3 text-sm">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          <p>
            <span className="font-medium">Payment spotted.</span> We've seen{' '}
            {btc(attempt.seen_sats)} BTC on its way. Bitcoin payments need a short
            confirmation before they complete — keep this page open.
          </p>
        </div>
      )}
      {attempt.state === 'underpaid' && (
        <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>
            <span className="font-medium">
              You sent {btc(attempt.received_sats)} BTC — {btc(attempt.remaining_sats)} BTC
              still needed.
            </span>{' '}
            Send the rest to the same address. Every payment to it counts toward this
            purchase.
          </p>
        </div>
      )}
      {attempt.state === 'paid' && (
        <div className="space-y-4 py-2 text-center">
          <CheckCircle className="mx-auto h-14 w-14 text-green-500" />
          <div>
            <h3 className="text-lg font-semibold">Payment complete — thank you!</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {btc(attempt.received_sats)} BTC received for {attempt.fiat_currency}{' '}
              {attempt.fiat_amount.toFixed(2)}.
            </p>
          </div>
          {redirectUrl && (
            <Button asChild className="w-full">
              <a href={redirectUrl}>
                <Store className="mr-2 h-4 w-4" /> Return to store
              </a>
            </Button>
          )}
        </div>
      )}
      {attempt.state === 'expired' && (
        <div className="space-y-4 py-2 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-muted-foreground" />
          <div>
            <h3 className="font-semibold">This payment window has closed</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The Bitcoin price was held for 60 minutes and no payment arrived. Nothing
              was charged.
            </p>
          </div>
          <Button onClick={() => void createAttempt()} disabled={creating} className="w-full">
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Get a new quote
          </Button>
        </div>
      )}
      {attempt.state === 'partial_credited' && (
        <div className="space-y-4 py-2 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
          <div>
            <h3 className="font-semibold">The payment window closed part-paid</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              The {btc(attempt.received_sats)} BTC you sent was paid to the seller as a
              partial payment — it is not lost. Contact the seller to arrange the rest
              of the {attempt.fiat_currency} {attempt.fiat_amount.toFixed(2)}.
            </p>
          </div>
          {redirectUrl && (
            <Button asChild variant="outline" className="w-full">
              <a href={redirectUrl}>
                <Store className="mr-2 h-4 w-4" /> Return to store
              </a>
            </Button>
          )}
        </div>
      )}
      {attempt.state === 'failed' && (
        <div className="space-y-4 py-2 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
          <div>
            <h3 className="font-semibold">This payment couldn't be completed</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {attempt.failure_reason ||
                'Something stopped this payment from going through. Please start again — if any Bitcoin left your wallet, it still counts toward this purchase.'}
            </p>
          </div>
          <Button onClick={() => void createAttempt()} disabled={creating} className="w-full">
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Start again
          </Button>
        </div>
      )}

      {/* ── Payment instruments (open states only) ── */}
      {!isTerminal && (
        <Tabs value={rail} onValueChange={(v) => setRail(v as 'onchain' | 'lightning')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="onchain">
              <Bitcoin className="mr-1.5 h-4 w-4" /> On-chain
            </TabsTrigger>
            <TabsTrigger value="lightning">
              <Zap className="mr-1.5 h-4 w-4" /> Lightning
            </TabsTrigger>
          </TabsList>

          <TabsContent value="onchain" className="space-y-4 pt-4">
            {attempt.onchain_address ? (
              <>
                <div className="flex flex-col items-center rounded-lg bg-muted p-4">
                  <div className="mb-4 rounded-lg bg-white p-3">
                    <QRCode
                      value={bip21(attempt.onchain_address, attempt.required_sats)}
                      size={180}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div className="w-full">
                    <Label htmlFor="link-btc-address" className="sr-only">Bitcoin Address</Label>
                    <div className="relative">
                      <Input
                        id="link-btc-address"
                        value={attempt.onchain_address}
                        readOnly
                        className="pr-12 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => void copy(attempt.onchain_address!, 'address')}
                        aria-label="Copy Bitcoin address"
                      >
                        {copiedField === 'address'
                          ? <CheckCircle className="h-4 w-4" />
                          : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Scan the code or copy the address into any Bitcoin wallet. This address
                  belongs to this payment only. On-chain payments complete after a short
                  confirmation (2 confirmations, 3 for large amounts).
                </p>
              </>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                The on-chain option isn't available for this payment right now — the
                Lightning tab works instantly.
              </p>
            )}
          </TabsContent>

          <TabsContent value="lightning" className="space-y-4 pt-4">
            {attempt.lightning_invoice ? (
              <>
                <div className="flex flex-col items-center rounded-lg bg-muted p-4">
                  <div className="mb-4 rounded-lg bg-white p-3">
                    <QRCode
                      value={attempt.lightning_invoice}
                      size={180}
                      level="H"
                      includeMargin={true}
                    />
                  </div>
                  <div className="w-full">
                    <Label htmlFor="link-btc-invoice" className="sr-only">Lightning Invoice</Label>
                    <div className="relative">
                      <Input
                        id="link-btc-invoice"
                        value={attempt.lightning_invoice}
                        readOnly
                        className="pr-12 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => void copy(attempt.lightning_invoice!, 'invoice')}
                        aria-label="Copy Lightning invoice"
                      >
                        {copiedField === 'invoice'
                          ? <CheckCircle className="h-4 w-4" />
                          : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <Button
                    variant="link"
                    className="mt-2"
                    onClick={() => window.open(`lightning:${attempt.lightning_invoice}`, '_blank')}
                  >
                    Open in Lightning wallet
                    <ExternalLink className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Pay this invoice from any Lightning wallet — it settles in seconds for
                  exactly {attempt.required_sats.toLocaleString()} sats.
                </p>
              </>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Lightning isn't available for this payment right now — the on-chain
                option works with any Bitcoin wallet.
              </p>
            )}
          </TabsContent>
        </Tabs>
      )}

      {amountChanged && !isTerminal && (
        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="text-muted-foreground">
            The amount changed to {currency} {amount!.toFixed(2)}. This Bitcoin payment
            is locked to {attempt.fiat_currency} {attempt.fiat_amount.toFixed(2)}.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void createAttempt()}
            disabled={creating}
          >
            Start a new Bitcoin payment for {currency} {amount!.toFixed(2)}
          </Button>
        </div>
      )}
    </div>
  );
}
