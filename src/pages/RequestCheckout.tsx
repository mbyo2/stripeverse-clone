import { toUserFacingError } from "@/utils/userFacingError";
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, CheckCircle, AlertCircle, Loader2, Receipt, Wallet, HandCoins } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useInvalidateMoneyState } from '@/utils/moneyFreshness';

// Public payment-request page (/request/:code) — Final-QA FIX-2.
// RequestMoney used to copy a /pay/:code URL for a code that is NOT a
// payment_links row, so recipients landed on a "not found" checkout.
// It now copies this URL. The payload comes from the invoice-checkout
// function's describe action (kind 'request', service-role side);
// payment settles through the same function into
// execute_payment_request_settlement — full amount, no platform fee,
// and the request flips to paid exactly once.

interface RequestData {
  id: string;
  requester_email: string | null;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  expires_at: string | null;
  paid_at: string | null;
}

const RequestCheckout = () => {
  const { code } = useParams<{ code: string }>();
  const { toast } = useToast();
  const invalidateMoney = useInvalidateMoneyState();

  const [request, setRequest] = useState<RequestData | null>(null);
  const [payerId, setPayerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [receiptRef, setReceiptRef] = useState('');
  const [payErrorMsg, setPayErrorMsg] = useState<string | null>(null);

  const idempotencyKeyRef = useRef<string | null>(null);
  const getIdempotencyKey = () => {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    return idempotencyKeyRef.current;
  };

  useEffect(() => {
    if (!code) { setError('Invalid payment request link'); setLoading(false); return; }
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke('invoice-checkout', {
        body: { action: 'describe', kind: 'request', code },
      });
      let failure: string | null = null;
      if (fnError) {
        failure = 'Payment request not found';
        const context = (fnError as { context?: Response }).context;
        if (context) {
          try {
            const payload = await context.clone().json();
            if (payload && typeof payload.error === 'string') failure = payload.error;
          } catch { /* keep the fallback message */ }
        }
      } else if (!data?.success || !data?.request) {
        failure = (typeof data?.error === 'string' && data.error) || 'Payment request not found';
      }
      if (failure) setError(failure);
      else setRequest(data.request as RequestData);
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
    if (!request || !code) return;
    setProcessing(true);
    try {
      const { data: payResult, error: payError } = await supabase.functions.invoke('invoice-checkout', {
        body: { action: 'pay', kind: 'request', code, idempotency_key: getIdempotencyKey() },
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
        throw new Error(payResult?.error || 'This payment request could not be paid. No money was charged.');
      }
      invalidateMoney();
      const txId = payResult?.transaction_id;
      if (txId) setReceiptRef(`RCP-${txId.slice(0, 8).toUpperCase()}`);
      setSuccess(true);
    } catch (err: any) {
      console.error('RequestCheckout payment failed:', err);
      setPayErrorMsg(toUserFacingError(err, 'This payment request could not be paid. No money was charged.'));
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
          <h2 className="text-lg font-semibold mb-2">Payment Request Unavailable</h2>
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

  if (success || request?.status === 'paid') return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <CheckCircle className="h-14 w-14 mx-auto text-green-500" />
          <h2 className="text-xl font-semibold">{success ? 'Payment Sent!' : 'Request Already Paid'}</h2>
          <div className="bg-muted rounded-lg p-4 space-y-2">
            <p className="text-2xl font-bold">{request?.currency} {request?.amount.toFixed(2)}</p>
            {request?.requester_email && <p className="text-sm text-muted-foreground">to {request.requester_email}</p>}
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

  const expired = request?.expires_at ? new Date(request.expires_at) <= new Date() : false;
  const payable = request?.status === 'pending' && !expired;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        <div className="text-center">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mx-auto mb-3">
            <HandCoins className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">BMaGlass<span className="text-primary">Pay</span></h1>
          <p className="text-sm text-muted-foreground mt-1">Payment Request</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment Request</CardTitle>
            {request?.requester_email && (
              <p className="text-sm text-muted-foreground">Requested by {request.requester_email}</p>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="text-center p-4 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground">Amount Requested</p>
              <p className="text-3xl font-bold text-foreground">{request?.currency} {request?.amount.toFixed(2)}</p>
            </div>

            {request?.description && <p className="text-sm text-muted-foreground">{request.description}</p>}
            {request?.expires_at && (
              <p className="text-xs text-muted-foreground">
                {expired ? 'Expired' : 'Expires'} {new Date(request.expires_at).toLocaleDateString()}
              </p>
            )}

            {!payable ? (
              <p className="text-sm text-muted-foreground text-center">
                This payment request {expired ? 'has expired' : `is ${request?.status}`} and cannot be paid.
              </p>
            ) : !payerId ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  Sign in with your BMaGlass account to pay this request from your wallet balance.
                </p>
                <Button asChild className="w-full h-12 text-base">
                  <Link to="/login">Sign in to Pay</Link>
                </Button>
              </div>
            ) : (
              <>
                <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground flex items-start gap-2">
                  <Wallet className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>The full amount will be taken from your BMaGlass wallet balance ({request?.currency}) and paid to the requester immediately. No fee is charged on payment requests.</span>
                </div>
                <Button onClick={handlePay} disabled={processing} className="w-full h-12 text-base">
                  {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                  {processing ? 'Processing...' : `Pay ${request?.currency} ${request?.amount.toFixed(2)}`}
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

export default RequestCheckout;
