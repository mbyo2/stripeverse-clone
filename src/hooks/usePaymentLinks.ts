import { toUserFacingError } from "@/utils/userFacingError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { FeePayer } from '@/utils/splitPayments';

/**
 * The merchant's account-level fee-bearer default (Settings →
 * Payment). The dashboard create form starts each new link from this
 * value; the link's own stored fee_payer is what settlement enforces.
 */
export const useFeePayerDefault = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['fee-payer-default', user?.id],
    queryFn: async (): Promise<FeePayer> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('payment_link_fee_payer')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.payment_link_fee_payer === 'buyer' ? 'buyer' : 'seller';
    },
    enabled: !!user,
  });
};

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
      /** Settlement target account (Phase 1.5); null/omitted = Main. */
      account_id?: string | null;
      /** Who funds the platform fee; omitted = the merchant's
       *  account default applies (the column default keeps it
       *  seller-pays for anything that doesn't say). */
      fee_payer?: FeePayer;
    }) => {
      const { data, error } = await supabase.from('payment_links').insert({
        user_id: user!.id, ...link,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-links'] });
      // Force the visible list to refetch now: with the app's
      // 5-minute staleTime, QA saw a newly created link missing from
      // the list until a manual reload.
      qc.refetchQueries({ queryKey: ['payment-links'], type: 'active' });
      toast.success('Payment link created');
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

export const useUpdatePaymentLink = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: {
      id: string;
      title?: string; description?: string; amount?: number | null;
      max_payments?: number | null;
      /** Settlement target account (Phase 1.5); null = Main. */
      account_id?: string | null;
      /** Who funds the platform fee for this link. */
      fee_payer?: FeePayer;
    }) => {
      const { data, error } = await supabase.from('payment_links').update(updates).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-links'] });
      qc.refetchQueries({ queryKey: ['payment-links'], type: 'active' });
      toast.success('Payment link updated');
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

export const useDeactivatePaymentLink = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('payment_links').update({ status: 'inactive' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-links'] });
      qc.refetchQueries({ queryKey: ['payment-links'], type: 'active' });
      toast.success('Link deactivated');
    },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};
