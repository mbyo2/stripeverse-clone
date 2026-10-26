import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SubscriptionData {
  subscription_tier: string;
  subscription_status: string;
  subscription_end: string | null;
  auto_renewal: boolean;
}

export interface UsageData {
  transactions_count: number;
  transactions_amount: number;
  cards_created: number;
  api_calls: number;
  month_year: string;
}

export interface TierLimits {
  tier: string;
  monthly_transactions: number;
  monthly_transaction_amount: number;
  virtual_cards_limit: number;
  api_calls_per_hour: number;
  features: string[];
}

export const useSubscription = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Fetch subscription data
  const { data: subscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['subscription', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const { data, error } = await supabase.functions.invoke('check-subscription');
      
      if (error) throw error;
      return data as SubscriptionData;
    },
    enabled: !!user?.id,
    refetchInterval: 60000, // Refetch every minute
  });

  // Fetch usage data
  const { data: usage, isLoading: usageLoading } = useQuery({
    queryKey: ['usage', user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error('User not authenticated');
      
      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format
      
      const { data, error } = await supabase
        .from('subscription_usage')
        .select('*')
        .eq('user_id', user.id)
        .eq('month_year', currentMonth)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error; // Ignore "not found" errors
      
      return data || {
        transactions_count: 0,
        transactions_amount: 0,
        cards_created: 0,
        api_calls: 0,
        month_year: currentMonth
      };
    },
    enabled: !!user?.id,
  });

  // Fetch tier limits
  const { data: tierLimits } = useQuery({
    queryKey: ['tier-limits'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_limits')
        .select('*');
      
      if (error) throw error;
      
      const limitsMap: Record<string, TierLimits> = {};
      data.forEach(limit => {
        limitsMap[limit.tier] = {
          ...limit,
          features: Array.isArray(limit.features) ? limit.features as string[] : []
        };
      });
      
      return limitsMap;
    },
  });

  // NOTE: subscription checkout + plan management no longer run
  // through Stripe. The create-checkout / customer-portal functions
  // were removed (subscription-billing migration to PayPal, CEO
  // decision 2026-10-26); subscribing happens on the Pricing page
  // through the PayPal subscription flow (paypal-checkout).

  // Check usage limits
  const checkUsageLimit = async (limitType: string, amount: number = 1): Promise<boolean> => {
    if (!user?.id) return false;
    
    try {
      const { data, error } = await supabase.rpc('check_usage_limit', {
        p_user_id: user.id,
        p_limit_type: limitType,
        p_amount: amount
      });
      
      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error checking usage limit:', error);
      return false;
    }
  };

  // Get current tier limits
  const getCurrentTierLimits = (): TierLimits | null => {
    if (!subscription || !tierLimits) return null;
    return tierLimits[subscription.subscription_tier] || null;
  };

  // Check if user has feature access
  const hasFeatureAccess = (feature: string): boolean => {
    const currentTier = getCurrentTierLimits();
    if (!currentTier) return false;
    return currentTier.features.includes(feature);
  };

  // Refresh subscription data
  const refreshSubscription = () => {
    queryClient.invalidateQueries({ queryKey: ['subscription'] });
    queryClient.invalidateQueries({ queryKey: ['usage'] });
  };

  return {
    subscription,
    usage,
    tierLimits,
    isLoading: subscriptionLoading || usageLoading,
    checkUsageLimit,
    getCurrentTierLimits,
    hasFeatureAccess,
    refreshSubscription,
  };
};
