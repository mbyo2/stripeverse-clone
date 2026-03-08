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
    mutationFn: async (params: {
      card_number: string;
      exp_month: number;
      exp_year: number;
      cardholder_name?: string;
    }) => {
      // Generate a secure token (in production this would go through a PCI-compliant tokenization service)
      const token = `tok_${crypto.randomUUID().replace(/-/g, '')}`;
      const lastFour = params.card_number.slice(-4);
      const brand = detectCardBrand(params.card_number);
      const fingerprint = await generateFingerprint(params.card_number);

      const { data, error } = await supabase
        .from('card_tokens')
        .insert({
          user_id: user!.id,
          token,
          card_last_four: lastFour,
          card_brand: brand,
          card_exp_month: params.exp_month,
          card_exp_year: params.exp_year,
          cardholder_name: params.cardholder_name,
          fingerprint,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['card-tokens'] });
      toast({ title: 'Card tokenized securely' });
    },
    onError: (error: any) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
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

function detectCardBrand(number: string): string {
  const n = number.replace(/\s/g, '');
  if (/^4/.test(n)) return 'visa';
  if (/^5[1-5]/.test(n)) return 'mastercard';
  if (/^3[47]/.test(n)) return 'amex';
  if (/^6(?:011|5)/.test(n)) return 'discover';
  return 'unknown';
}

async function generateFingerprint(cardNumber: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(cardNumber.replace(/\s/g, ''));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
