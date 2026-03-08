import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface SettlementReport {
  id: string;
  merchant_id: string;
  period_start: string;
  period_end: string;
  total_transactions: number;
  gross_amount: number;
  total_fees: number;
  net_amount: number;
  refunds_amount: number;
  chargebacks_amount: number;
  currency: string;
  status: string;
  settled_at: string | null;
  payout_reference: string | null;
  created_at: string;
}

export const useSettlements = () => {
  const { user } = useAuth();

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['settlements', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settlement_reports')
        .select('*')
        .eq('merchant_id', user!.id)
        .order('period_end', { ascending: false });
      if (error) throw error;
      return (data as unknown) as SettlementReport[];
    },
    enabled: !!user?.id,
  });

  return { settlements, isLoading };
};
