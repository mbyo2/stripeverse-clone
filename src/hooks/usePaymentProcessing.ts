
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface PaymentData {
  amount: number;
  currency: string;
  paymentMethod: string;
  provider: string;
  recipientAccount?: string;
  recipientName?: string;
  description?: string;
}

interface PaymentResult {
  success: boolean;
  transaction_id?: string;
  status?: string;
  reference?: string;
  balance?: number;
  error?: string;
}

interface PaymentConfig {
  maxAmount: number;
  minAmount: number;
  supportedCurrencies: string[];
  feePercentage: number;
  minimumFee: number;
}

export const usePaymentProcessing = () => {
  const { user } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<PaymentConfig>({
    maxAmount: 100000,
    minAmount: 1,
    supportedCurrencies: ['ZMW', 'USD', 'EUR'],
    feePercentage: 0.01,
    minimumFee: 2.00
  });

  const updateConfig = (newConfig: Partial<PaymentConfig>) => {
    setConfig(prev => ({ ...prev, ...newConfig }));
  };

  const validatePayment = (paymentData: PaymentData): { valid: boolean; error?: string } => {
    if (!user?.id) {
      return { valid: false, error: 'User must be authenticated' };
    }

    if (paymentData.amount < config.minAmount) {
      return { valid: false, error: `Minimum amount is ${config.minAmount} ${paymentData.currency}` };
    }
    
    if (paymentData.amount > config.maxAmount) {
      return { valid: false, error: `Maximum amount is ${config.maxAmount} ${paymentData.currency}` };
    }
    
    if (!config.supportedCurrencies.includes(paymentData.currency)) {
      return { valid: false, error: `Currency ${paymentData.currency} is not supported` };
    }
    
    return { valid: true };
  };

  const calculateFee = (amount: number): number => {
    return Math.max(amount * config.feePercentage, config.minimumFee);
  };

  const processPayment = async (paymentData: PaymentData): Promise<PaymentResult> => {
    if (!user?.id) {
      const error = 'User must be authenticated to process payments';
      toast({
        title: "Authentication Required",
        description: error,
        variant: "destructive"
      });
      return { success: false, error };
    }

    // Check transaction limits before processing
    const { data: canTransact, error: limitError } = await supabase.rpc('check_usage_limit', {
      p_user_id: user.id,
      p_limit_type: 'transactions',
      p_amount: 1
    });
    
    if (limitError) {
      console.error('Error checking transaction limit:', limitError);
    } else if (!canTransact) {
      const error = 'You have reached your monthly transaction limit. Please upgrade your plan to continue.';
      toast({
        title: "Transaction Limit Reached",
        description: error,
        variant: "destructive"
      });
      return { success: false, error };
    }

    // Check transaction amount limits
    const { data: canTransactAmount, error: amountLimitError } = await supabase.rpc('check_usage_limit', {
      p_user_id: user.id,
      p_limit_type: 'transaction_amount',
      p_amount: paymentData.amount
    });
    
    if (amountLimitError) {
      console.error('Error checking transaction amount limit:', amountLimitError);
    } else if (!canTransactAmount) {
      const error = 'This transaction would exceed your monthly transaction amount limit. Please upgrade your plan.';
      toast({
        title: "Transaction Amount Limit Reached",
        description: error,
        variant: "destructive"
      });
      return { success: false, error };
    }

    setIsProcessing(true);
    
    try {
      const validation = validatePayment(paymentData);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const { data, error } = await supabase.functions.invoke('process-payment', {
        body: {
          ...paymentData,
          user_id: user.id,
          fee: calculateFee(paymentData.amount),
          config
        }
      });

      if (error) {
        console.error('Payment processing error:', error);
        throw new Error(error.message || 'Payment processing failed');
      }

      if (data?.success) {
        toast({
          title: "Payment Successful",
          description: `Transaction ${data.transaction_id} completed successfully.`,
        });
      } else {
        toast({
          title: "Payment Failed", 
          description: data?.error || "Payment processing failed.",
          variant: "destructive"
        });
      }

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment processing failed';
      
      console.error('Payment processing error:', error);
      
      toast({
        title: "Payment Error",
        description: errorMessage,
        variant: "destructive"
      });

      return {
        success: false,
        error: errorMessage
      };
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    processPayment,
    isProcessing,
    config,
    updateConfig,
    validatePayment,
    calculateFee
  };
};
