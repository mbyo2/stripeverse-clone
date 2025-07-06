import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface PricingTier {
  id: string;
  tier_name: string;
  display_name: string;
  description: string;
  price: number;
  currency: string;
  is_popular: boolean;
  transaction_fee_percentage: number;
  transaction_fee_fixed: number;
  max_transaction_amount: number | null;
  virtual_cards_limit: number | null;
  features: string[];
  is_active: boolean;
  sort_order: number;
}

export const usePricing = () => {
  return useQuery({
    queryKey: ['pricing-tiers'],
    queryFn: async (): Promise<PricingTier[]> => {
      const { data, error } = await supabase
        .from('pricing_tiers')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;
      
      return (data || []).map(tier => ({
        ...tier,
        features: Array.isArray(tier.features) ? tier.features.filter((f): f is string => typeof f === 'string') : []
      }));
    },
  });
};