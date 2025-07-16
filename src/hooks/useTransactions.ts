import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Transaction {
  id: number;
  uuid_id: string;
  user_id: string;
  amount: number;
  currency: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'completed' | 'failed';
  description?: string;
  reference?: string;
  recipient_name?: string;
  recipient_account?: string;
  payment_method: string;
  category?: string;
  provider?: string;
  created_at: string;
  updated_at: string;
}

export const useTransactions = (limit?: number) => {
  const { user } = useAuth();

  const { data: transactions = [], isLoading, error } = useQuery({
    queryKey: ['transactions', user?.id, limit],
    queryFn: async (): Promise<Transaction[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit || 50);

      if (error) throw error;
      return (data || []).map(tx => ({
        ...tx,
        direction: tx.direction as 'incoming' | 'outgoing',
        status: tx.status as 'pending' | 'completed' | 'failed'
      }));
    },
    enabled: !!user?.id,
  });

  const { data: recentTransactions = [] } = useQuery({
    queryKey: ['recent-transactions', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('get_recent_transactions', {
        p_user_id: user.id,
        p_limit: 10
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  return {
    transactions,
    recentTransactions,
    isLoading,
    error,
  };
};