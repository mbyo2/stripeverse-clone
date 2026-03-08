import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useBulkPayments = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['bulk-payments', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_payments')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useBulkPaymentItems = (bulkPaymentId?: string) => {
  return useQuery({
    queryKey: ['bulk-payment-items', bulkPaymentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bulk_payment_items')
        .select('*')
        .eq('bulk_payment_id', bulkPaymentId!)
        .order('created_at');
      if (error) throw error;
      return data;
    },
    enabled: !!bulkPaymentId,
  });
};

export const useCreateBulkPayment = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      name: string; currency?: string;
      items: Array<{
        recipient_name: string; recipient_account?: string;
        recipient_bank?: string; recipient_phone?: string;
        recipient_email?: string; amount: number;
        payment_method?: string;
      }>;
    }) => {
      const totalAmount = params.items.reduce((s, i) => s + i.amount, 0);
      const { data: batch, error: batchErr } = await supabase.from('bulk_payments').insert({
        user_id: user!.id, name: params.name,
        currency: params.currency || 'ZMW',
        total_amount: totalAmount, total_items: params.items.length,
        status: 'draft',
      }).select().single();
      if (batchErr) throw batchErr;

      const items = params.items.map(item => ({
        bulk_payment_id: batch.id, ...item,
        currency: params.currency || 'ZMW',
        payment_method: item.payment_method || 'bank_transfer',
      }));
      const { error: itemsErr } = await supabase.from('bulk_payment_items').insert(items);
      if (itemsErr) throw itemsErr;
      return batch;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bulk-payments'] }); toast.success('Bulk payment created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useProcessBulkPayment = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (bulkPaymentId: string) => {
      const { error } = await supabase.from('bulk_payments')
        .update({ status: 'processing' })
        .eq('id', bulkPaymentId);
      if (error) throw error;
      // In production, this would trigger an edge function to process each item
      toast.info('Bulk payment submitted for processing');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bulk-payments'] }),
    onError: (e: Error) => toast.error(e.message),
  });
};
