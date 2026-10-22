import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MONEY_QUERY_STALE_TIME } from '@/utils/moneyFreshness';

export interface Transaction {
  id: number;
  uuid_id: string;
  user_id: string;
  wallet_id?: string | null;
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

export const useTransactions = (limit?: number, walletIds?: string[]) => {
  const { user } = useAuth();

  const { data: transactions = [], isLoading, error, refetch } = useQuery({
    queryKey: ['transactions', user?.id, limit, walletIds],
    queryFn: async (): Promise<Transaction[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      let query = supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id);

      // When a sub-account is selected, restrict to that account's wallets.
      if (walletIds) {
        query = query.in('wallet_id', walletIds);
      }

      const { data, error } = await query
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
    // Activity lists are money surfaces: refetch on mount/focus
    // rather than rendering rows cached by an earlier screen.
    staleTime: MONEY_QUERY_STALE_TIME,
    refetchOnWindowFocus: true,
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
    staleTime: MONEY_QUERY_STALE_TIME,
    refetchOnWindowFocus: true,
  });

  return {
    transactions,
    recentTransactions,
    isLoading,
    error,
    refetch,
  };
};