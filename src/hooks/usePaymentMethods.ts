import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PaymentMethod {
  id: string;
  type: 'card' | 'mobile_money' | 'bank_account';
  name: string;
  details: string;
  status: 'active' | 'expired' | 'disabled';
  isDefault: boolean;
  provider?: string;
  last4?: string;
  expiryDate?: string;
  // Database fields
  user_id: string;
  account_number?: string;
  account_name?: string;
  is_verified: boolean;
  is_primary: boolean;
  metadata?: any;
  created_at: string;
  updated_at: string;
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
        type: pm.type as 'card' | 'mobile_money' | 'bank_account',
        name: pm.account_name || `${pm.provider} ${pm.type}`,
        details: pm.account_number || 'N/A',
        status: pm.is_verified ? 'active' as const : 'disabled' as const,
        isDefault: pm.is_primary,
        provider: pm.provider,
        last4: pm.account_number?.slice(-4),
        expiryDate: pm.metadata && typeof pm.metadata === 'object' ? (pm.metadata as any).expiry_date : undefined
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