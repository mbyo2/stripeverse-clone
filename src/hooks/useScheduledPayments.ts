import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface ScheduledPayment {
  id: string;
  user_id: string;
  recipient_name: string;
  recipient_account: string | null;
  recipient_bank: string | null;
  amount: number;
  currency: string;
  payment_method: string;
  frequency: string;
  description: string | null;
  next_run_at: string;
  last_run_at: string | null;
  end_date: string | null;
  total_runs: number;
  max_runs: number | null;
  status: string;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface CreateScheduledPaymentInput {
  recipient_name: string;
  recipient_account?: string;
  recipient_bank?: string;
  amount: number;
  currency?: string;
  payment_method?: string;
  frequency: string;
  description?: string;
  next_run_at: string;
  end_date?: string;
  max_runs?: number;
}

export const useScheduledPayments = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['scheduled-payments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_payments')
        .select('*')
        .eq('user_id', user!.id)
        .order('next_run_at', { ascending: true });
      if (error) throw error;
      return data as ScheduledPayment[];
    },
    enabled: !!user,
  });

  const createPayment = useMutation({
    mutationFn: async (input: CreateScheduledPaymentInput) => {
      const { data, error } = await supabase
        .from('scheduled_payments')
        .insert({
          user_id: user!.id,
          ...input,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-payments'] });
      toast.success('Scheduled payment created');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('scheduled_payments')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-payments'] });
      toast.success('Payment updated');
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deletePayment = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('scheduled_payments')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-payments'] });
      toast.success('Scheduled payment deleted');
    },
    onError: (err: any) => toast.error(err.message),
  });

  return {
    payments,
    isLoading,
    createPayment,
    updateStatus,
    deletePayment,
  };
};
