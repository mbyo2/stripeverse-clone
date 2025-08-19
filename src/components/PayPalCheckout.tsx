import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { usePayPalPayments } from '@/hooks/usePayPalPayments';
import { Check, CreditCard, Zap } from 'lucide-react';

interface PayPalCheckoutProps {
  type: 'subscription' | 'payment';
  amount: number;
  currency?: string;
  planId?: string;
  planName?: string;
  features?: string[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

export const PayPalCheckout: React.FC<PayPalCheckoutProps> = ({
  type,
  amount,
  currency = 'USD',
  planId,
  planName,
  features,
  onSuccess,
  onCancel
}) => {
  const { processPayment, isProcessing } = usePayPalPayments();
  const [paymentInitiated, setPaymentInitiated] = useState(false);

  const handlePayment = async () => {
    const result = await processPayment({
      amount,
      currency,
      planId,
      type,
      description: type === 'subscription' ? `${planName} subscription` : 'One-time payment'
    });

    if (result.success) {
      setPaymentInitiated(true);
      onSuccess?.();
    } else {
      onCancel?.();
    }
  };

  const formatPrice = (price: number, curr: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: curr,
    }).format(price);
  };

  if (paymentInitiated) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Zap className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-xl">Payment Initiated</CardTitle>
          <CardDescription>
            A new tab has opened with PayPal. Please complete your payment there.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">
          {type === 'subscription' ? planName : 'Payment'}
        </CardTitle>
        <div className="text-3xl font-bold text-primary">
          {formatPrice(amount, currency)}
          {type === 'subscription' && <span className="text-base text-muted-foreground">/month</span>}
        </div>
        {type === 'subscription' && (
          <Badge variant="secondary" className="w-fit mx-auto mt-2">
            Monthly Billing
          </Badge>
        )}
      </CardHeader>

      {features && features.length > 0 && (
        <CardContent className="space-y-4">
          <Separator />
          <div className="space-y-3">
            <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
              {type === 'subscription' ? 'Plan Features' : 'What You Get'}
            </h4>
            <ul className="space-y-2">
              {features.map((feature, index) => (
                <li key={index} className="flex items-center gap-3 text-sm">
                  <Check className="w-4 h-4 text-primary flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      )}

      <CardFooter className="flex flex-col gap-3 pt-6">
        <Button 
          onClick={handlePayment}
          disabled={isProcessing}
          className="w-full"
          size="lg"
        >
          <CreditCard className="w-4 h-4 mr-2" />
          {isProcessing 
            ? 'Processing...' 
            : `Pay with PayPal - ${formatPrice(amount, currency)}`
          }
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Secure payment powered by PayPal.
          {type === 'subscription' && ' You can cancel anytime from your account settings.'}
        </p>
      </CardFooter>
    </Card>
  );
};