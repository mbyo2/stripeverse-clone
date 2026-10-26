import { toUserFacingError } from "@/utils/userFacingError";
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

      // PayPal marketplace payments are deprecated (audit D1): the
      // legacy function's orders could never be captured or settled,
      // and its fee "split" was never sent to PayPal. Marketplace
      // sales settle through the seller's payment link or wallet —
      // refuse here, honestly, without invoking anything.
      const error = 'PayPal marketplace payments are not available — marketplace sales settle through the seller\'s payment link or wallet instead.';
      toast({
        title: "Marketplace Payment",
        description: error,
        variant: "destructive",
      });
      return { success: false, error };

    } catch (error) {
      const errorMessage = toUserFacingError(error, 'The payment could not be completed. Please try again.');
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