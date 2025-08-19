import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface MarketplacePaymentData {
  receiverUserId: string;
  amount: number;
  currency?: string;
  platformFeePercentage?: number;
  description?: string;
}

interface MarketplacePaymentResult {
  success: boolean;
  approvalUrl?: string;
  orderId?: string;
  transactionId?: string;
  error?: string;
}

export const useMarketplace = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const createMarketplacePayment = useCallback(async (paymentData: MarketplacePaymentData): Promise<MarketplacePaymentResult> => {
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
      // Validate payment data
      if (!paymentData.amount || paymentData.amount <= 0) {
        throw new Error('Invalid payment amount');
      }

      if (!paymentData.receiverUserId) {
        throw new Error('Receiver user ID is required');
      }

      if (paymentData.receiverUserId === user.id) {
        throw new Error('Cannot send payment to yourself');
      }

      // Calculate platform fee and net amount
      const platformFeePercentage = paymentData.platformFeePercentage || 2.5; // Default 2.5%
      const platformFee = (paymentData.amount * platformFeePercentage) / 100;
      const netAmount = paymentData.amount - platformFee;

      // Call marketplace payment function
      const { data, error } = await supabase.functions.invoke('paypal-marketplace', {
        body: {
          receiverUserId: paymentData.receiverUserId,
          grossAmount: paymentData.amount,
          platformFee,
          netAmount,
          currency: paymentData.currency || 'USD',
          description: paymentData.description || 'Marketplace payment'
        }
      });

      if (error) {
        console.error('Marketplace payment error:', error);
        throw new Error(error.message || 'Payment processing failed');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Payment processing failed');
      }

      toast({
        title: "Payment Initiated",
        description: "Redirecting to PayPal for payment completion...",
      });

      // Redirect to PayPal
      if (data.approvalUrl) {
        window.open(data.approvalUrl, '_blank');
      }

      return {
        success: true,
        approvalUrl: data.approvalUrl,
        orderId: data.orderId,
        transactionId: data.transactionId
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error('Marketplace payment error:', errorMessage);
      
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

  const getMarketplaceTransactions = useCallback(async () => {
    if (!user?.id) return [];

    const { data, error } = await supabase
      .from('marketplace_transactions')
      .select(`
        *,
        payer:profiles!marketplace_transactions_payer_user_id_fkey(first_name, last_name),
        receiver:profiles!marketplace_transactions_receiver_user_id_fkey(first_name, last_name)
      `)
      .or(`payer_user_id.eq.${user.id},receiver_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching marketplace transactions:', error);
      return [];
    }

    return data || [];
  }, [user?.id]);

  return {
    createMarketplacePayment,
    getMarketplaceTransactions,
    isProcessing
  };
};