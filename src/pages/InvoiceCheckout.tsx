import { toUserFacingError } from "@/utils/userFacingError";
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Lock, CheckCircle, AlertCircle, Loader2, Receipt, Wallet, FileText } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateMoneyState } from '@/utils/moneyFreshness';

// Public invoice page (/invoice/:code) — Final-QA FIX-2. Before this
// page existed the invoice UI copied exactly this URL, but no route
// matched it and nothing could settle an invoice. The payload comes
// from the invoice-checkout function's describe action (service-role
// side, like /pay/:code); payment settles through the same function
// into execute_invoice_settlement — full total, no platform fee, and
// the invoice flips to paid exactly once.

interface InvoiceData {
  id: string;
  invoice_number: string;
  issuer_email: string | null;
  customer_name: string | null;
  items: { description: string; quantity: number; unit_price: number; total: number }[];
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  due_date: string | null;
  notes: string | null;
  status: string;
  paid_at: string | null;
}

const InvoiceCheckout = () => {
  const { code } = useParams<{ code: string }>();
  const { toast } = useToast();
  const invalidateMoney = useInvalidateMoneyState();

  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [receiptRef, setReceiptRef] = useState('');
  const [payErrorMsg, setPayErrorMsg] = useState<string | null>(null);

  // One idempotency key per page session (PublicCheckout pattern).
  const idempotencyKeyRef = useRef<string | null>(null);
  const getIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  };

  useEffect(() => {
    if (!code) { setError('Invalid invoice link'); setLoading(false); return; }
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke('invoice-checkout', {
        body: { action: 'describe', kind: 'invoice', code },
      });
      let failure: string | null = null;
      if (fnError) {
        failure = 'Invoice not found';
        const context = (fnError as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === 'string') failure = payload.error;
          } catch { /* keep the fallback message */ }
        }
      } else if (!data?.success || !data?.invoice) {
        failure = (typeof data?.error === 'string' && data.error) || 'Invoice not found';
      }
      if (failure) setError(failure);
      else setInvoice(data.invoice as InvoiceData);
      setLoading(false);
    })();
  }, [code]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setPayerId(data.session?.user.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setPayerId(session?.user.id ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handlePay = async () => {
    if (!invoice || !code) return;
    setProcessing(true);
    try {
      const { data: payResult, error: payError } = await supabase.functions.invoke('invoice-checkout', {
        body: { action: 'pay', kind: 'invoice', code, idempotency_key: getIdempotencyKey() },
      });
      if (payError) {
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
        throw new Error(payResult?.error || 'This invoice could not be paid. No money was charged.');
      }
      invalidateMoney();
      const txId = payResult?.transaction_id;
      if (txId) setReceiptRef(`RCP-${txId.slice(0, 8).toUpperCase()}`);
      setSuccess(true);
    } catch (err: any) {
      console.error('InvoiceCheckout payment failed:', err);
      setPayErrorMsg(toUserFacingError(err, 'This invoice could not be paid. No money was charged.'));
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
          <h2 className="text-lg font-semibold mb-2">Invoice Unavailable</h2>
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
          <Button onClick={() => setPayErrorMsg(null)} className="w-full">Try Again</Button>
        </CardContent>
      </Card>
    </div>
  );

  if (success || invoice?.status === 'paid') return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <CheckCircle className="h-14 w-14 mx-auto text-green-500" />
          <h2 className="text-xl font-semibold">{success ? 'Invoice Paid!' : 'Invoice Already Paid'}</h2>
          <div className="bg-muted rounded-lg p-4 space-y-2">
            <p className="text-2xl font-bold">{invoice?.currency} {invoice?.total_amount.toFixed(2)}</p>
            <p className="text-sm text-muted-foreground">Invoice {invoice?.invoice_number}</p>
          </div>
          {receiptRef && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Receipt className="h-4 w-4" />
              <span>Receipt: {receiptRef}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  const payable = invoice && ['draft', 'sent', 'pending'].includes(invoice.status);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">BMaGlass<span className="text-primary">Pay</span></h1>
          <p className="text-sm text-muted-foreground mt-1">Invoice Payment</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Invoice {invoice?.invoice_number}</CardTitle>
            {invoice?.issuer_email && (
              <p className="text-sm text-muted-foreground">Issued by {invoice.issuer_email}</p>
            )}
            {invoice?.due_date && (
              <p className="text-xs text-muted-foreground">Due {new Date(invoice.due_date).toLocaleDateString()}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {invoice && invoice.items.length > 0 && (
              <div className="space-y-2">
                {invoice.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span>{item.description} × {item.quantity}</span>
                    <span className="tabular-nums font-medium">{invoice.currency} {Number(item.total).toFixed(2)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{invoice.currency} {invoice.subtotal.toFixed(2)}</span>
                </div>
                {invoice.tax_amount > 0 && (
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>Tax</span>
                    <span className="tabular-nums">{invoice.currency} {invoice.tax_amount.toFixed(2)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Amount Due</p>
              <p className="text-3xl font-bold text-foreground">{invoice?.currency} {invoice?.total_amount.toFixed(2)}</p>
            </div>

            {invoice?.notes && <p className="text-sm text-muted-foreground">{invoice.notes}</p>}

            {!payable ? (
              <p className="text-sm text-muted-foreground text-center">
                This invoice is {invoice?.status} and cannot be paid.
              </p>
            ) : !payerId ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  Sign in with your BMaGlass account to pay this invoice from your wallet balance.
                </p>
                <Button asChild className="w-full h-12 text-base">
                  <Link to="/login">Sign in to Pay</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground flex items-start gap-2">
                  <Wallet className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>The full amount will be taken from your BMaGlass wallet balance ({invoice?.currency}) and paid to the issuer immediately. No fee is charged on invoice payments.</span>
                </div>
                <Button onClick={handlePay} disabled={processing} className="w-full h-12 text-base">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                  {processing ? 'Processing...' : `Pay ${invoice?.currency} ${invoice?.total_amount.toFixed(2)}`}
                </Button>
              </>
            )}

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

export default InvoiceCheckout;
