import { toUserFacingError } from "@/utils/userFacingError";
import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface PayPalPaymentData {
  amount: number;
  currency?: string;
  planId?: string;
  type?: 'payment' | 'subscription';
  description?: string;
}

interface PayPalPaymentResult {
  success: boolean;
  approvalUrl?: string;
  orderId?: string;
  subscriptionId?: string;
  error?: string;
}

export const usePayPalPayments = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const processPayment = useCallback(async (paymentData: PayPalPaymentData): Promise<PayPalPaymentResult> => {
    if (!user) {
      const error = 'User must be authenticated to process payments';
      toast({
        title: "Authentication Required",
        description: error,
        variant: "destructive",
      });
      return { success: false, error };
    }

    setIsProcessing(true);

    try {
      // Enhanced validation
      if (!paymentData.amount || paymentData.amount <= 0) {
        throw new Error('Invalid payment amount');
      }

      if (paymentData.amount > 999999.99) {
        throw new Error('Payment amount exceeds maximum limit');
      }

      if (paymentData.type === 'subscription' && !paymentData.planId) {
        throw new Error('Plan ID is required for subscriptions');
      }

      // Validate currency code. ZMW is deliberately absent: PayPal
      // does not support kwacha at all, and the server refuses
      // anything outside its allowlist with the reason — the client
      // list only stops an obviously-wrong code before the round-trip.
      const validCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'NZD', 'SGD', 'HKD', 'MXN', 'PLN', 'CZK'];
      const currency = paymentData.currency || 'USD';
      if (!validCurrencies.includes(currency)) {
        throw new Error('PayPal payments are made in US dollars or another major currency — ZMW is not a PayPal currency.');
      }

      // One-time PayPal payments no longer run through the legacy
      // paypal-checkout function: its orders could never be captured
      // or settled (audit D1). They complete through wallet deposits
      // and payment links instead — refuse here, honestly, without
      // invoking anything.
      if ((paymentData.type || 'payment') !== 'subscription') {
        const error = 'One-time PayPal payments complete through wallet deposits and payment links — use Add Money in your wallet or a payment link instead.';
        toast({
          title: "PayPal Payment",
          description: error,
          variant: "destructive",
        });
        return { success: false, error };
      }

      // Call the PayPal subscription checkout function. The buyer
      // returns to this app (Pricing) after approving — never to a
      // server endpoint.
      const { data, error } = await supabase.functions.invoke('paypal-checkout', {
        body: {
          amount: paymentData.amount,
          currency,
          planId: paymentData.planId,
          type: 'subscription',
          description: paymentData.description,
          return_url: `${window.location.origin}/pricing`,
          cancel_url: `${window.location.origin}/pricing`
        }
      });

      if (error) {
        console.error('PayPal checkout error:', error);
        throw new Error(error.message || 'Payment processing failed');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Payment processing failed');
      }

      // Validate response
      if (!data.approvalUrl) {
        throw new Error('No approval URL received from PayPal');
      }

      toast({
        title: "Payment Initiated",
        description: "Redirecting to PayPal for payment completion...",
      });

      // Redirect to PayPal
      window.open(data.approvalUrl, '_blank');

      return {
        success: true,
        approvalUrl: data.approvalUrl,
        orderId: data.orderId,
        subscriptionId: data.subscriptionId
      };

    } catch (error) {
      const errorMessage = toUserFacingError(error, 'The payment could not be completed. Please try again.');
      console.error('Payment processing error:', errorMessage);
      
      toast({
        title: "Payment Error",
        description: errorMessage,
        variant: "destructive",
      });

      return { success: false, error: errorMessage };
    } finally {
      setIsProcessing(false);
    }
  }, [user, toast]);

  const createSubscription = useCallback(async (planId: string, amount: number, currency = 'USD'): Promise<PayPalPaymentResult> => {
    return processPayment({
      amount,
      currency,
      planId,
      type: 'subscription',
      description: `${planId} subscription`
    });
  }, [processPayment]);

  const createOneTimePayment = useCallback(async (amount: number, currency = 'USD', description?: string): Promise<PayPalPaymentResult> => {
    return processPayment({
      amount,
      currency,
      type: 'payment',
      description: description || 'One-time payment'
    });
  }, [processPayment]);

  return {
    processPayment,
    createSubscription,
    createOneTimePayment,
    isProcessing
  };
};