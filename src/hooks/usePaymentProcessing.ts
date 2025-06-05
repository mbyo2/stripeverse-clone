
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

export const usePaymentProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);

  const processPayment = async (paymentData: PaymentData): Promise<PaymentResult> => {
    setIsProcessing(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('process-payment', {
        body: paymentData
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
    isProcessing
  };
};
