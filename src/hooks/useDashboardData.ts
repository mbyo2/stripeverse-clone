import { useEffect, useCallback, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  const queryClient = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Realtime subscription for live updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel('dashboard-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'transactions', filter: `user_id=eq.${user.id}` },
        () => {
          // Invalidate all dashboard queries on transaction changes
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats', user.id] });
          queryClient.invalidateQueries({ queryKey: ['recent-transactions', user.id] });
          queryClient.invalidateQueries({ queryKey: ['monthly-data', user.id] });
          queryClient.invalidateQueries({ queryKey: ['spending-data', user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['dashboard-stats', user.id] });
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
        }
      )
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);

  // Fetch user wallet balance and transaction stats
  const { data: dashboardStats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats', user?.id],
    queryFn: async (): Promise<DashboardStats> => {
      if (!user?.id) throw new Error('User not authenticated');

      // The banner must report the ZMW MAIN wallet — the same figure
      // the accounts list and the Wallet page show. It previously came
      // from get_user_wallet_balance, whose definition picks ANY ONE
      // of the user's ZMW wallets (LIMIT 1, no ORDER BY, no Main
      // filter): once sub-account wallets exist it can return a
      // sub-account's K0.00 while Main holds the real balance, which
      // is exactly the contradiction QA saw on this page. Resolve the
      // Main wallet the same way the rest of the app does
      // (currency ZMW + account_id NULL).
      const { data: mainWallet, error: balanceError } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', user.id)
        .eq('currency', 'ZMW')
        .is('account_id', null)
        .maybeSingle();
      if (balanceError) throw balanceError;

      const { data: statsData, error: statsError } = await supabase.rpc('get_user_transaction_stats', {
        p_user_id: user.id
      });
      if (statsError) throw statsError;

      return {
        totalBalance: mainWallet ? Number(mainWallet.balance) : 0,
        totalTransactions: statsData?.[0]?.total_transactions || 0,
        monthlyAmount: statsData?.[0]?.monthly_amount || 0,
        monthlyTransactions: statsData?.[0]?.monthly_transactions || 0,
      };
    },
    enabled: !!user?.id,
    staleTime: 30000, // 30s stale time for realtime-backed data
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['monthly-data', user?.id],
    queryFn: async (): Promise<MonthlyData[]> => {
      if (!user?.id) throw new Error('User not authenticated');
      const { data, error } = await supabase.rpc('get_monthly_transaction_data', { p_user_id: user.id });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: spendingData, isLoading: spendingLoading } = useQuery({
    queryKey: ['spending-data', user?.id],
    queryFn: async (): Promise<SpendingData[]> => {
      if (!user?.id) throw new Error('User not authenticated');
      const { data, error } = await supabase.rpc('get_spending_by_category', { p_user_id: user.id });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: recentTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['recent-transactions', user?.id],
    queryFn: async (): Promise<RecentTransaction[]> => {
      if (!user?.id) throw new Error('User not authenticated');
      const { data, error } = await supabase.rpc('get_recent_transactions', { p_user_id: user.id, p_limit: 4 });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  const { data: rewards, isLoading: rewardsLoading } = useQuery({
    queryKey: ['user-rewards', user?.id],
    queryFn: async (): Promise<UserRewards> => {
      if (!user?.id) throw new Error('User not authenticated');
      const { data, error } = await supabase.rpc('get_user_rewards', { p_user_id: user.id });
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
    realtimeConnected,
    isLoading: statsLoading || monthlyLoading || spendingLoading || transactionsLoading || rewardsLoading,
  };
};
