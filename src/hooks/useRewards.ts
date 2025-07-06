
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface UserRewards {
  total_points: number;
  lifetime_points: number;
  tier: string;
  next_tier_threshold: number;
  points_to_next_tier: number;
  points_redeemed?: number;
}

export interface RewardTransaction {
  id: string;
  points_earned: number | null;
  points_spent: number | null;
  action_type: string;
  description: string | null;
  created_at: string;
}

export const useRewards = () => {
  const { user } = useAuth();

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

  const { data: rewardTransactions, isLoading: transactionsLoading } = useQuery({
    queryKey: ['reward-transactions', user?.id],
    queryFn: async (): Promise<RewardTransaction[]> => {
      if (!user?.id) throw new Error('User not authenticated');

      const { data, error } = await supabase
        .from('reward_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  return {
    rewards,
    rewardTransactions,
    isLoading: rewardsLoading || transactionsLoading,
  };
};
