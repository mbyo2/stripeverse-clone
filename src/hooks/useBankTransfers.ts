import { toUserFacingError } from "@/utils/userFacingError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useBankAccounts = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['bank-accounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('user_id', user!.id)
        .order('is_primary', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useAddBankAccount = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (account: {
      bank_name: string; account_number: string; account_name: string;
      account_type?: string; currency?: string; country?: string;
      swift_code?: string; routing_number?: string; bank_code?: string;
    }) => {
      const { data, error } = await supabase.from('bank_accounts').insert({
        user_id: user!.id, ...account,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); toast.success('Bank account added'); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

export const useDeleteBankAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); toast.success('Bank account removed'); },
    onError: (e: Error) => toast.error(toUserFacingError(e)),
  });
};

