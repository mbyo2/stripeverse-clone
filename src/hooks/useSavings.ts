import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useSavings = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const accounts = useQuery({
    queryKey: ['savings', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('savings_accounts')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createAccount = useMutation({
    mutationFn: async (account: { name: string; target_amount?: number; target_date?: string; auto_save_amount?: number; auto_save_frequency?: string }) => {
      const { data, error } = await supabase
        .from('savings_accounts')
        .insert({ user_id: user!.id, ...account })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Savings account created'); queryClient.invalidateQueries({ queryKey: ['savings'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deposit = useMutation({
    mutationFn: async ({ id, amount }: { id: string; amount: number }) => {
      const { data: account } = await supabase.from('savings_accounts').select('balance').eq('id', id).single();
      const { error } = await supabase.from('savings_accounts').update({ balance: (account?.balance || 0) + amount }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Deposit successful'); queryClient.invalidateQueries({ queryKey: ['savings'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { accounts, createAccount, deposit };
};
