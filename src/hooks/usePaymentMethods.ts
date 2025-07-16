import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PaymentMethod {
  id: string;
  user_id: string;
  type: 'card' | 'mobile_money' | 'bank_account';
  provider: string;
  account_number?: string;
  account_name?: string;
  is_verified: boolean;
  is_primary: boolean;
  metadata?: any;
  created_at: string;
  updated_at: string;
  // Legacy props for compatibility
  name?: string;
  details?: string;
  status?: string;
  isDefault?: boolean;
}

export const usePaymentMethods = () => {
  const { user } = useAuth();

  const { data: paymentMethods = [], isLoading, error } = useQuery({
    queryKey: ['payment-methods', user?.id],
    queryFn: async (): Promise<PaymentMethod[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('payment_methods')
        .select('*')
        .eq('user_id', user.id)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []).map(pm => ({
        ...pm,
        type: pm.type as 'card' | 'mobile_money' | 'bank_account'
      }));
    },
    enabled: !!user?.id,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  });

  return {
    paymentMethods,
    isLoading,
    error,
  };
};