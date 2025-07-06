
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardStats {
  totalBalance: number;
  totalTransactions: number;
  monthlyAmount: number;
  monthlyTransactions: number;
}

interface MonthlyData {
  month: string;
  amount: number;
  transaction_count: number;
}

interface SpendingData {
  category: string;
  amount: number;
}

interface RecentTransaction {
  id: number;
  direction: string;
  recipient_name: string;
  amount: number;
  currency: string;
  created_at: string;
  status: string;
}

interface UserRewards {
  total_points: number;
  lifetime_points: number;
  tier: string;
  next_tier_threshold: number;
  points_to_next_tier: number;
}

export const useDashboardData = () => {
  const { user } = useAuth();

  // Fetch user wallet balance and transaction stats
  const { data: dashboardStats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', user?.id],
    queryFn: async (): Promise<DashboardStats> => {
      if (!user?.id) throw new Error('User not authenticated');

      // Get wallet balance
      const { data: balanceData, error: balanceError } = await supabase.rpc('get_user_wallet_balance', {
        p_user_id: user.id
      });

      if (balanceError) throw balanceError;

      // Get transaction stats
      const { data: statsData, error: statsError } = await supabase.rpc('get_user_transaction_stats', {
        p_user_id: user.id
      });

      if (statsError) throw statsError;

      return {
        totalBalance: balanceData || 0,
        totalTransactions: statsData?.[0]?.total_transactions || 0,
        monthlyAmount: statsData?.[0]?.monthly_amount || 0,
        monthlyTransactions: statsData?.[0]?.monthly_transactions || 0,
      };
    },
    enabled: !!user?.id,
  });

  // Fetch monthly transaction data for charts
  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['monthly-data', user?.id],
    queryFn: async (): Promise<MonthlyData[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('get_monthly_transaction_data', {
        p_user_id: user.id
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Fetch spending by category
  const { data: spendingData, isLoading: spendingLoading } = useQuery({
    queryKey: ['spending-data', user?.id],
    queryFn: async (): Promise<SpendingData[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('get_spending_by_category', {
        p_user_id: user.id
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Fetch recent transactions
  const { data: recentTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['recent-transactions', user?.id],
    queryFn: async (): Promise<RecentTransaction[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('get_recent_transactions', {
        p_user_id: user.id,
        p_limit: 4
      });

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Fetch user rewards
  const { data: rewards, isLoading: rewardsLoading } = useQuery({
    queryKey: ['user-rewards', user?.id],
    queryFn: async (): Promise<UserRewards> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase.rpc('get_user_rewards', {
        p_user_id: user.id
      });

      if (error) throw error;
      return data?.[0] || {
        total_points: 0,
        lifetime_points: 0,
        tier: 'bronze',
        next_tier_threshold: 1000,
        points_to_next_tier: 1000
      };
    },
    enabled: !!user?.id,
  });

  return {
    dashboardStats,
    monthlyData,
    spendingData,
    recentTransactions,
    rewards,
    isLoading: statsLoading || monthlyLoading || spendingLoading || transactionsLoading || rewardsLoading,
  };
};
