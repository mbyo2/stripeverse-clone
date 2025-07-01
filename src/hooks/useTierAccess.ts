
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export const useTierAccess = () => {
  const { user } = useAuth();

  const checkFeatureAccess = async (featureId: string): Promise<boolean> => {
    if (!user?.id) return false;

    try {
      const { data, error } = await supabase.rpc('user_has_feature_access', {
        p_user_id: user.id,
        p_feature_id: featureId
      });

      if (error) {
        console.error('Error checking feature access:', error);
        return false;
      }

      return data;
    } catch (error) {
      console.error('Error checking feature access:', error);
      return false;
    }
  };

  const { data: userTierFeatures, isLoading } = useQuery({
    queryKey: ['user-tier-features', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      // Get user's current tier first
      const { data: tierData, error: tierError } = await supabase.rpc('get_user_tier', {
        p_user_id: user.id
      });

      if (tierError) {
        console.error('Error getting user tier:', tierError);
        return [];
      }

      const currentTier = tierData || 'free';

      // Get features for the user's tier
      const { data, error } = await supabase.rpc('get_tier_features', {
        p_tier: currentTier
      });

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  const { data: userSubscription, isLoading: subscriptionLoading } = useQuery({
    queryKey: ['user-subscription', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;

      const { data, error } = await supabase.functions.invoke('check-subscription');
      
      if (error) {
        console.error('Error fetching subscription:', error);
        return null;
      }

      return data;
    },
    enabled: !!user?.id,
  });

  return {
    checkFeatureAccess,
    userTierFeatures,
    userSubscription,
    isLoading: isLoading || subscriptionLoading,
  };
};
