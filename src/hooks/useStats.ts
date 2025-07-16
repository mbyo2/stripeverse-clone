import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AppStats {
  totalUsers: number;
  totalTransactions: number;
  totalBusinesses: number;
  totalVolume: number;
  currency: string;
}

export const useStats = () => {
  const { data: stats, isLoading, error } = useQuery({
    queryKey: ['app-stats'],
    queryFn: async (): Promise<AppStats> => {
      // Get total users count
      const { count: totalUsers } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true });

      // Get total transactions count and volume
      const { data: transactionStats } = await supabase
        .from('transactions')
        .select('amount')
        .eq('status', 'completed');

      const totalTransactions = transactionStats?.length || 0;
      const totalVolume = transactionStats?.reduce((sum, tx) => sum + tx.amount, 0) || 0;

      // Get total businesses count
      const { count: totalBusinesses } = await supabase
        .from('merchant_accounts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      return {
        totalUsers: totalUsers || 0,
        totalTransactions,
        totalBusinesses: totalBusinesses || 0,
        totalVolume,
        currency: 'ZMW'
      };
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
  });

  return {
    stats,
    isLoading,
    error,
  };
};