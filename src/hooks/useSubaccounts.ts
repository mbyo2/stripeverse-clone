import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useSubaccounts = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['subaccounts', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subaccounts')
        .select('*')
        .eq('owner_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateSubaccount = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sub: {
      account_name: string; account_email?: string;
      split_type?: string; split_value: number;
      bank_account_id?: string;
    }) => {
      const { data, error } = await supabase.from('subaccounts').insert({
        owner_id: user!.id, ...sub,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subaccounts'] }); toast.success('Subaccount created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useSplitRules = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['split-rules', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('split_rules')
        .select('*, subaccounts(account_name)')
        .eq('owner_id', user!.id);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateSplitRule = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rule: {
      name: string; subaccount_id: string;
      split_type: string; split_value: number;
    }) => {
      const { data, error } = await supabase.from('split_rules').insert({
        owner_id: user!.id, ...rule,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['split-rules'] }); toast.success('Split rule created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};
