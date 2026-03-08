import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useRefunds = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['refunds', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('refunds')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateRefund = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      transaction_id: string; amount: number; currency?: string;
      reason: string; refund_type?: string; notes?: string;
    }) => {
      const { data, error } = await supabase.from('refunds').insert({
        user_id: user!.id,
        transaction_id: params.transaction_id,
        amount: params.amount,
        currency: params.currency || 'ZMW',
        reason: params.reason,
        refund_type: params.refund_type || 'full',
        notes: params.notes,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['refunds'] }); toast.success('Refund request submitted'); },
    onError: (e: Error) => toast.error(e.message),
  });
};
