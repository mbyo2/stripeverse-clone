import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const usePaymentPlans = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const plans = useQuery({
    queryKey: ['payment-plans', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_payment_plans')
        .select('*')
        .eq('merchant_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createPlan = useMutation({
    mutationFn: async (plan: { customer_email: string; customer_name?: string; description?: string; total_amount: number; installments_total: number; currency?: string; frequency?: string }) => {
      const { data, error } = await supabase
        .from('merchant_payment_plans')
        .insert({
          merchant_id: user!.id,
          ...plan,
          installment_amount: plan.total_amount / plan.installments_total,
          next_payment_date: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Payment plan created'); queryClient.invalidateQueries({ queryKey: ['payment-plans'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { plans, createPlan };
};
