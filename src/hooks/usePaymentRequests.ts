import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface PaymentRequest {
  id: string;
  requester_id: string;
  recipient_email: string | null;
  recipient_phone: string | null;
  amount: number;
  currency: string;
  description: string | null;
  status: string;
  payment_link_code: string;
  expires_at: string;
  paid_at: string | null;
  paid_by: string | null;
  created_at: string;
}

export const usePaymentRequests = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['payment-requests', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_requests')
        .select('*')
        .eq('requester_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as PaymentRequest[];
    },
    enabled: !!user?.id,
  });

  const createRequest = useMutation({
    mutationFn: async (params: {
      recipient_email?: string;
      recipient_phone?: string;
      amount: number;
      description?: string;
    }) => {
      const { data, error } = await supabase
        .from('payment_requests')
        .insert({
          requester_id: user!.id,
          ...params,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-requests'] });
      toast({ title: 'Payment request created', description: 'Share the link with your recipient.' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  return { requests, isLoading, createRequest };
};
