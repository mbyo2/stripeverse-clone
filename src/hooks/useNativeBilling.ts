import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { usePricing, PricingTier } from '@/hooks/usePricing';

export interface NativeSubscription {
  id: string;
  subscription_tier: string;
  subscription_status: string;
  subscription_start: string | null;
  subscription_end: string | null;
  auto_renewal: boolean;
  next_billing_date: string | null;
  last_billing_date: string | null;
  failed_payment_count: number;
  dunning_status: string;
  email: string;
}

export const useNativeBilling = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: pricingTiers } = usePricing();

  // Fetch current subscription
  const { data: subscription, isLoading } = useQuery({
    queryKey: ['native-subscription', user?.id],
    queryFn: async (): Promise<NativeSubscription | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('subscribers')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data as NativeSubscription | null;
    },
    enabled: !!user?.id,
    refetchInterval: 60000,
  });

  // Fetch billing history
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ['billing-invoices', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from('subscription_invoices')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user?.id,
  });

  // Change subscription tier
  const changeTier = useMutation({
    mutationFn: async ({ tier, action }: { tier: string; action: string }) => {
      const { data, error } = await supabase.functions.invoke('manage-subscription', {
        body: { action, tier }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['native-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast({
        title: 'Subscription Updated',
        description: `Changed to ${data.new_tier} plan${data.proration_credit > 0 ? ` (credit: $${data.proration_credit})` : ''}`,
      });
    },
    onError: (error: any) => {
      if (error.message?.includes('Payment method required')) {
        toast({
          title: 'Payment Method Required',
          description: 'Please add a payment method before upgrading.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Update Failed',
          description: error.message || 'Failed to update subscription',
          variant: 'destructive',
        });
      }
    },
  });

  // Cancel subscription
  const cancelSubscription = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'cancel' }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['native-subscription'] });
      toast({
        title: 'Subscription Cancelled',
        description: 'Your subscription will remain active until the end of your billing period.',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Cancellation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Reactivate subscription
  const reactivateSubscription = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'reactivate' }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['native-subscription'] });
      toast({ title: 'Subscription Reactivated' });
    },
  });

  const getCurrentTierPrice = (): PricingTier | undefined => {
    if (!subscription || !pricingTiers) return undefined;
    return pricingTiers.find(t => t.tier_name === subscription.subscription_tier);
  };

  return {
    subscription,
    invoices,
    pricingTiers,
    isLoading,
    invoicesLoading,
    changeTier: changeTier.mutate,
    cancelSubscription: cancelSubscription.mutate,
    reactivateSubscription: reactivateSubscription.mutate,
    isChangingTier: changeTier.isPending,
    isCancelling: cancelSubscription.isPending,
    getCurrentTierPrice,
  };
};
