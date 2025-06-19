
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

      const { data, error } = await supabase.rpc('get_tier_features', {
        p_tier: 'free' // This would be replaced with actual user tier
      });

      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
  });

  return {
    checkFeatureAccess,
    userTierFeatures,
    isLoading,
  };
};
