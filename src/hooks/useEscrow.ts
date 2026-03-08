import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useEscrow = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const escrows = useQuery({
    queryKey: ['escrow', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('escrow_transactions')
        .select('*')
        .or(`buyer_id.eq.${user!.id},seller_id.eq.${user!.id}`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const createEscrow = useMutation({
    mutationFn: async (escrow: { seller_id: string; amount: number; description?: string; release_conditions?: string; currency?: string }) => {
      const { data, error } = await supabase
        .from('escrow_transactions')
        .insert({ buyer_id: user!.id, ...escrow })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success('Escrow created'); queryClient.invalidateQueries({ queryKey: ['escrow'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const releaseEscrow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('escrow_transactions')
        .update({ status: 'released', released_at: new Date().toISOString() })
        .eq('id', id)
        .eq('buyer_id', user!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Funds released'); queryClient.invalidateQueries({ queryKey: ['escrow'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return { escrows, createEscrow, releaseEscrow };
};
