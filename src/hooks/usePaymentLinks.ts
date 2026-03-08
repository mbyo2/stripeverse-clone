import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const usePaymentLinks = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['payment-links', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_links')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreatePaymentLink = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (link: {
      title: string; description?: string; amount?: number;
      currency?: string; max_payments?: number; expires_at?: string;
    }) => {
      const { data, error } = await supabase.from('payment_links').insert({
        user_id: user!.id, ...link,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-links'] }); toast.success('Payment link created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useDeactivatePaymentLink = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payment_links').update({ status: 'inactive' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payment-links'] }); toast.success('Link deactivated'); },
    onError: (e: Error) => toast.error(e.message),
  });
};
