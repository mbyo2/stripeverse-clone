import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CreditCard, Smartphone, Building2, Lock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type PaymentMethod = 'card' | 'mobile_money' | 'bank';

interface PaymentLinkData {
  id: string;
  title: string;
  description: string | null;
  amount: number | null;
  currency: string;
  status: string;
}

const PublicCheckout = () => {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const { toast } = useToast();

  const [linkData, setLinkData] = useState<PaymentLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('card');
  const [customAmount, setCustomAmount] = useState('');
  const [email, setEmail] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!code) { setError('Invalid payment link'); setLoading(false); return; }
    (async () => {
      const { data, error: e } = await supabase
        .from('payment_links')
        .select('id, title, description, amount, currency, status')
        .eq('link_code', code)
        .eq('status', 'active')
        .single();
      if (e || !data) { setError('Payment link not found or expired'); }
      else { setLinkData(data as PaymentLinkData); }
      setLoading(false);
    })();
  }, [code]);

  const handlePay = async () => {
    if (!linkData) return;
    const amount = linkData.amount || Number(customAmount);
    if (!amount || amount <= 0) { toast({ title: 'Enter a valid amount', variant: 'destructive' }); return; }
    if (!email) { toast({ title: 'Enter your email', variant: 'destructive' }); return; }
    
    setProcessing(true);
    // Simulate payment processing
    await new Promise(r => setTimeout(r, 2000));
    setSuccess(true);
    setProcessing(false);
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

  if (success) return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center">
          <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Payment Successful!</h2>
          <p className="text-muted-foreground">Your payment has been processed. A receipt has been sent to {email}.</p>
        </CardContent>
      </Card>
    </div>
  );

  const amount = linkData?.amount || Number(customAmount) || 0;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
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
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Amount */}
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

            {/* Payment Method */}
            <div className="space-y-3">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'card' as const, icon: CreditCard, label: 'Card' },
                  { id: 'mobile_money' as const, icon: Smartphone, label: 'Mobile Money' },
                  { id: 'bank' as const, icon: Building2, label: 'Bank' },
                ] as const).map(m => (
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
            </div>

            {paymentMethod === 'card' && (
              <div className="space-y-3">
                <div>
                  <Label>Card Number</Label>
                  <Input placeholder="4242 4242 4242 4242" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Expiry</Label><Input placeholder="MM/YY" /></div>
                  <div><Label>CVC</Label><Input placeholder="123" /></div>
                </div>
              </div>
            )}

            {paymentMethod === 'mobile_money' && (
              <div>
                <Label>Phone Number</Label>
                <Input placeholder="+260 97X XXX XXX" />
              </div>
            )}

            {paymentMethod === 'bank' && (
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                You'll be redirected to complete the bank transfer after clicking Pay.
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
