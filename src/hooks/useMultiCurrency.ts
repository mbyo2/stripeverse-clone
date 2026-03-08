import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export const useMultiCurrencyWallets = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['multi-wallets', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wallets')
        .select('*')
        .eq('user_id', user!.id)
        .order('currency');
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};

export const useCreateWallet = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (currency: string) => {
      const { data, error } = await supabase.from('wallets').insert({
        user_id: user!.id, currency, balance: 0, status: 'active',
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['multi-wallets'] }); toast.success('Wallet created'); },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useExchangeRates = () => {
  return useQuery({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .gte('valid_until', new Date().toISOString())
        .order('from_currency');
      if (error) throw error;
      return data;
    },
  });
};

export const useConvertCurrency = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      from_currency: string; to_currency: string;
      from_amount: number; exchange_rate: number;
      from_wallet_id: string; to_wallet_id: string;
    }) => {
      const to_amount = params.from_amount * params.exchange_rate;
      const fee = params.from_amount * 0.015; // 1.5% fee
      const { data, error } = await supabase.from('currency_conversions').insert({
        user_id: user!.id,
        from_currency: params.from_currency,
        to_currency: params.to_currency,
        from_amount: params.from_amount,
        to_amount,
        exchange_rate: params.exchange_rate,
        fee_amount: fee,
        from_wallet_id: params.from_wallet_id,
        to_wallet_id: params.to_wallet_id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['multi-wallets'] });
      qc.invalidateQueries({ queryKey: ['currency-conversions'] });
      toast.success('Currency converted successfully');
    },
    onError: (e: Error) => toast.error(e.message),
  });
};

export const useConversionHistory = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['currency-conversions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('currency_conversions')
        .select('*')
        .eq('user_id', user!.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
};
