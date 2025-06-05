
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';

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
    setIsProcessing(true);
    
    try {
      const validation = validatePayment(paymentData);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const { data, error } = await supabase.functions.invoke('process-payment', {
        body: {
          ...paymentData,
          fee: calculateFee(paymentData.amount),
          config
        }
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data.success) {
        toast({
          title: "Payment Successful",
          description: `Transaction ${data.transaction_id} completed successfully.`,
        });
      } else {
        toast({
          title: "Payment Failed", 
          description: data.error || "Payment processing failed.",
          variant: "destructive"
        });
      }

      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment processing failed';
      
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
