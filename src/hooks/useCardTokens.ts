import { toUserFacingError } from "@/utils/userFacingError";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface CardToken {
  id: string;
  user_id: string;
  token: string;
  card_last_four: string;
  card_brand: string;
  card_exp_month: number;
  card_exp_year: number;
  cardholder_name: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
}

export const useCardTokens = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ['card-tokens', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('card_tokens')
        .select('*')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as unknown) as CardToken[];
    },
    enabled: !!user?.id,
  });

  const tokenizeCard = useMutation({
    mutationFn: async (_params: {
      card_number: string;
      exp_month: number;
      exp_year: number;
      cardholder_name?: string;
    }) => {
      // DISABLED for PCI safety. The previous implementation "tokenised" in
      // the browser: it invented a tok_ id locally and stored last-4, brand,
      // expiry — plus an unsalted SHA-256 fingerprint of the full card
      // number. A PAN hash like that is brute-forceable (PANs are low
      // entropy), so it counts as stored cardholder data, and the resulting
      // "token" could never be charged by anything. Until a PCI-compliant
      // vault/tokenisation provider is connected, adding cards is refused
      // here and in the UI. Nothing is written.
      throw new Error('Card storage is disabled until a PCI-compliant vault is connected');
    },
    onError: (error: any) => {
      toast({ title: 'Card storage disabled', description: toUserFacingError(error), variant: 'destructive' });
    },
  });

  const setDefault = useMutation({
    mutationFn: async (tokenId: string) => {
      // Unset all defaults first
      await supabase.from('card_tokens').update({ is_default: false }).eq('user_id', user!.id);
      const { error } = await supabase.from('card_tokens').update({ is_default: true }).eq('id', tokenId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['card-tokens'] });
      toast({ title: 'Default card updated' });
    },
  });

  const removeToken = useMutation({
    mutationFn: async (tokenId: string) => {
      const { error } = await supabase.from('card_tokens').update({ is_active: false }).eq('id', tokenId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['card-tokens'] });
      toast({ title: 'Card removed' });
    },
  });

  return { tokens, isLoading, tokenizeCard, setDefault, removeToken };
};
