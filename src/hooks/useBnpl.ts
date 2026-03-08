import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface BnplPlan {
  id: string;
  user_id: string;
  total_amount: number;
  installment_amount: number;
  installments_total: number;
  installments_paid: number;
  currency: string;
  next_payment_date: string | null;
  status: string;
  merchant_name: string | null;
  description: string | null;
  created_at: string;
}

export const useBnpl = () => {
  const { user } = useAuth();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['bnpl-plans', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bnpl_plans')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as BnplPlan[];
    },
    enabled: !!user?.id,
  });

  const activePlans = plans.filter((p) => p.status === 'active');
  const totalOwed = activePlans.reduce(
    (sum, p) => sum + (p.installments_total - p.installments_paid) * p.installment_amount,
    0
  );

  return { plans, activePlans, totalOwed, isLoading };
};
