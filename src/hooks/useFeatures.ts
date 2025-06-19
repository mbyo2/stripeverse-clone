
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface Feature {
  feature_id: string;
  name: string;
  description: string;
  category: string;
}

interface TierFeature {
  tier: string;
  feature_id: string;
}

export const useFeatures = () => {
  const { data: features, isLoading: featuresLoading, error: featuresError } = useQuery({
    queryKey: ['features'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('features')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true });
      
      if (error) throw error;
      return data as Feature[];
    },
  });

  const { data: tierFeatures, isLoading: tierFeaturesLoading, error: tierFeaturesError } = useQuery({
    queryKey: ['tier-features'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_features')
        .select('*');
      
      if (error) throw error;
      return data as TierFeature[];
    },
  });

  const getTierFeatureMatrix = () => {
    if (!features || !tierFeatures) return null;

    const tiers = ['free', 'basic', 'premium', 'enterprise'];
    const categories = [...new Set(features.map(f => f.category))];
    
    const matrix: Record<string, Record<string, boolean>> = {};
    
    tiers.forEach(tier => {
      matrix[tier] = {};
      features.forEach(feature => {
        matrix[tier][feature.feature_id] = tierFeatures.some(
          tf => tf.tier === tier && tf.feature_id === feature.feature_id
        );
      });
    });

    return { features, categories, matrix, tiers };
  };

  return {
    features,
    tierFeatures,
    getTierFeatureMatrix,
    isLoading: featuresLoading || tierFeaturesLoading,
    error: featuresError || tierFeaturesError,
  };
};
