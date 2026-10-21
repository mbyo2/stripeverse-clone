import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Smartphone, Building2, Lock, CheckCircle, AlertCircle, Loader2, Receipt, Wallet } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  resolveLinkAmount,
  validateLinkPayment,
  type LinkPaymentMethod,
} from '@/utils/paymentLinkSettlement';

interface PaymentLinkData {
  id: string;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string;
  status: string;
  user_id: string;
  account_id: string | null;
}

const PublicCheckout = () => {
  const { code } = useParams<{ code: string }>();
  const { toast } = useToast();

  const [linkData, setLinkData] = useState<PaymentLinkData | null>(null);
  const [settlementAccountName, setSettlementAccountName] = useState<string | null>(null);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<LinkPaymentMethod>('card');
  const [customAmount, setCustomAmount] = useState('');
  const [email, setEmail] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [receiptRef, setReceiptRef] = useState('');
  const [payErrorMsg, setPayErrorMsg] = useState<string | null>(null);

  // One idempotency key per page session: if a pay attempt's response is
  // lost (network drop, timeout), retrying with the same key replays the
  // original settlement server-side instead of charging twice.
  const idempotencyKeyRef = useRef<string | null>(null);
  const getIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  };

  useEffect(() => {
    if (!code) { setError('Invalid payment link'); setLoading(false); return; }
    (async () => {
      // Load the link through the checkout function (service-role
      // side), NOT a direct payment_links select: under table RLS a
      // signed-in non-owner could not read the link at all (anon had
      // the public read; authenticated policies were owner-scoped), so
      // exactly the people wallet payment exists for — signed-in
      // third parties — were told "not found". The function also
      // serves the settlement account's name, which is owner-only
      // data under RLS.
      const { data: described, error: fnError } = await supabase.functions.invoke('payment-link-checkout', {
        body: { action: 'describe', link_code: code },
      });

      let failure: string | null = null;
      if (fnError) {
        // FunctionsHttpError carries the function's JSON on `context`;
        // its 404 message is the truthful one ("not found or no
        // longer active") — surface it instead of guessing.
        failure = 'Payment link not found or expired';
        const context = (fnError as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === 'string') failure = payload.error;
          } catch { /* keep the fallback message */ }
        }
      } else if (!described?.success || !described?.link) {
        failure = (typeof described?.error === 'string' && described.error) || 'Payment link not found or expired';
      }

      if (failure) {
        setError(failure);
      } else {
        setLinkData(described.link as PaymentLinkData);
        if (described.settlement_account_name) {
          setSettlementAccountName(described.settlement_account_name as string);
        }
      }
      setLoading(false);
    })();
  }, [code]);

  // Wallet payment is offered when the visitor is signed in. Guests can
  // still open the page and read it; the external methods answer
  // truthfully from the server until a gateway is connected.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setPayerId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setPayerId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (payerId) setPaymentMethod('wallet');
  }, [payerId]);

  const handlePay = async () => {
    if (!linkData || !code) return;
    const amount = resolveLinkAmount(linkData, customAmount);
    const validationError = validateLinkPayment({
      link: linkData, amount, method: paymentMethod, payerId,
    });
    if (validationError) { toast({ title: validationError, variant: 'destructive' }); return; }
    if (!email) { toast({ title: 'Enter your email for your receipt', variant: 'destructive' }); return; }

    setProcessing(true);

    try {
      // Settle via the payment-link-checkout edge function: the money
      // lands in the LINK OWNER's wallet for this link's settlement
      // account (execute_payment_link_settlement, service-role side).
      // This page never writes balances or link counters itself.
      const { data: payResult, error: payError } = await supabase.functions.invoke('payment-link-checkout', {
        body: {
          link_code: code,
          amount,
          payment_method: paymentMethod,
          idempotency_key: getIdempotencyKey(),
          email,
        }
      });

      if (payError) {
        // FunctionsHttpError carries the function's JSON on `context`;
        // surface its real message (e.g. insufficient balance).
        let message = payError.message;
        const context = (payError as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === 'string') message = payload.error;
          } catch { /* keep the generic message */ }
        }
        throw new Error(message);
      }
      if (!payResult?.success) {
        throw new Error(payResult?.error || 'Payment could not be processed. No money was charged.');
      }

      // Send receipt (best effort — the payment is already settled).
      const txId = payResult?.transaction_id;
      if (txId) {
        await supabase.functions.invoke('send-receipt', {
          body: { transaction_id: txId, recipient_email: email, type: 'payment' }
        }).catch(() => { /* receipt failure never unmakes a payment */ });
        setReceiptRef(`RCP-${txId.slice(0, 8).toUpperCase()}`);
      }

      setSuccess(true);
    } catch (err: any) {
      // NEVER fake a successful payment. Show the error and let the user retry.
      console.error('PublicCheckout payment failed:', err);
      setPayErrorMsg(err?.message || 'Payment could not be processed. No money was charged.');
      toast({ title: 'Payment failed', description: 'No money was charged. Please try again.', variant: 'destructive' });
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-4" />
          <h2 className="text-lg font-semibold mb-2">Payment Unavailable</h2>
          <p className="text-muted-foreground">{error}</p>
        </CardContent>
      </Card>
    </div>
  );

  if (payErrorMsg) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <AlertCircle className="h-14 w-14 mx-auto text-destructive" />
          <h2 className="text-xl font-semibold">Payment Failed</h2>
          <p className="text-sm text-muted-foreground">{payErrorMsg}</p>
          <p className="text-sm font-medium text-foreground">No money was charged.</p>
          <Button onClick={() => setPayErrorMsg(null)} className="w-full">
            Try Again
          </Button>
        </CardContent>
      </Card>
    </div>
  );

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <CheckCircle className="h-14 w-14 mx-auto text-green-500" />
          <h2 className="text-xl font-semibold">Payment Successful!</h2>
          <div className="bg-muted rounded-lg p-4 space-y-2">
            <p className="text-2xl font-bold">{linkData?.currency} {(linkData?.amount || Number(customAmount)).toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">to {linkData?.title}</p>
          </div>
          {receiptRef && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Receipt className="h-4 w-4" />
              <span>Receipt: {receiptRef}</span>
            </div>
          )}
          <p className="text-sm text-muted-foreground">A receipt has been sent to {email}</p>
        </CardContent>
      </Card>
    </div>
  );

  const amount = linkData?.amount || Number(customAmount) || 0;
  const methods = [
    ...(payerId ? [{ id: 'wallet' as const, icon: Wallet, label: 'BMaGlass Wallet' }] : []),
    { id: 'card' as const, icon: CreditCard, label: 'Card' },
    { id: 'mobile_money' as const, icon: Smartphone, label: 'Mobile Money' },
    { id: 'bank' as const, icon: Building2, label: 'Bank' },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <CreditCard className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">BMaGlass<span className="text-primary">Pay</span></h1>
          <p className="text-sm text-muted-foreground mt-1">Secure Checkout</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{linkData?.title}</CardTitle>
            {linkData?.description && <p className="text-sm text-muted-foreground">{linkData.description}</p>}
            {settlementAccountName && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 pt-1">
                <Wallet className="h-3.5 w-3.5" />
                Payments settle to: {settlementAccountName}
              </p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {linkData?.amount ? (
              <div className="text-center p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Amount Due</p>
                <p className="text-3xl font-bold text-foreground">{linkData.currency} {linkData.amount.toFixed(2)}</p>
              </div>
            ) : (
              <div>
                <Label>Amount ({linkData?.currency})</Label>
                <Input type="number" placeholder="0.00" value={customAmount} onChange={e => setCustomAmount(e.target.value)} />
              </div>
            )}

            <div>
              <Label>Email Address</Label>
              <Input type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} />
            </div>

            <Separator />

            <div className="space-y-3">
              <Label>Payment Method</Label>
              <div className={`grid gap-2 ${methods.length > 3 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                {methods.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setPaymentMethod(m.id)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors ${
                      paymentMethod === m.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'
                    }`}
                  >
                    <m.icon className={`h-5 w-5 ${paymentMethod === m.id ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="text-xs font-medium">{m.label}</span>
                  </button>
                ))}
              </div>
              {!payerId && (
                <p className="text-xs text-muted-foreground">
                  Have a BMaGlass account?{' '}
                  <Link to="/login" className="text-primary underline underline-offset-2">Sign in</Link>{' '}
                  to pay instantly from your wallet balance.
                </p>
              )}
            </div>

            {paymentMethod === 'wallet' && (
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                The amount will be taken from your BMaGlass wallet balance ({linkData?.currency}) and paid to the seller immediately.
              </div>
            )}

            {paymentMethod === 'card' && (
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                Pay by debit or credit card. Availability is confirmed when you click Pay — nothing is charged unless the payment completes. We never see or store your card number on this page.
              </div>
            )}

            {paymentMethod === 'mobile_money' && (
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                Pay by mobile money. Availability is confirmed when you click Pay — nothing is charged unless the payment completes.
              </div>
            )}

            {paymentMethod === 'bank' && (
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                Pay by bank transfer. Availability is confirmed when you click Pay — nothing is charged unless the payment completes.
              </div>
            )}

            <Button onClick={handlePay} disabled={processing} className="w-full h-12 text-base">
              {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
              {processing ? 'Processing...' : `Pay ${linkData?.currency} ${amount.toFixed(2)}`}
            </Button>

            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" />
              <span>Secured by BMaGlassPay · 256-bit SSL encryption</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PublicCheckout;
